"""Triage: one Claude call per new candidate, on its title and abstract.

For each candidate the model returns a TriageResult (structured output, so the
reply follows the schema). This module then:

  1. checks the result in code: the fields agree with each other, every field
     with a value has evidence, milestone ids exist, and every quote really
     appears in the title or abstract
  2. stores every call in ai_assessments, insert-only, with tokens and cost
  3. moves the candidate one step:
        relevant or unsure            -> pending_review
        not relevant                  -> triaged_out (and the abstract is deleted),
                                         except a fixed sample that goes to
                                         pending_review flagged spot_check
        not relevant, but the quote   -> pending_review flagged quote_mismatch
        for it isn't in the paper
        refused, cut off, invalid,    -> pending_review flagged ai_failed
        or the request failed

The model only sorts. It never publishes, and a person checks everything it
passes on. Without ANTHROPIC_API_KEY nothing is sent anywhere and triage is
skipped: the pipeline never makes up an answer.
"""

import hashlib
import json
import re
import unicodedata
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol, Self

import anthropic
import httpx2  # the HTTP client the anthropic SDK is built on, for errors raised while a reply streams
from anthropic.types import Message
from pydantic import ValidationError, ValidationInfo, model_validator
from pymongo.errors import PyMongoError
from sf_shared.claims import MAX_QUOTE_LENGTH
from sf_shared.db import now
from sf_shared.enums import RUBRIC_VERSION
from sf_shared.pipeline_models import (
    AiAssessment,
    CandidateFlag,
    Relevant,
    ReviewStatus,
    SearchConfig,
    TokenUsage,
    TriageResult,
)

from sf_pipeline.config import Settings
from sf_pipeline.pricing import UnknownModelPrice, cost_usd, price_table
from sf_pipeline.store import to_doc
from sf_pipeline.text import plural

PROMPT_NAME = "triage_v1"
PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
MILESTONES_PLACEHOLDER = "{{MILESTONES}}"
EDITOR_NOTES = re.compile(r"\A\s*<!--.*?-->\s*", re.DOTALL)

# Thinking counts toward max_tokens, so the cap leaves room for it. A reply
# that still gets cut off is retried once with the larger cap.
FIRST_MAX_TOKENS = 4_000
RETRY_MAX_TOKENS = 12_000

# The SDK retries connection errors, timeouts, 429 and 5xx itself, with
# exponential backoff that respects Retry-After. Replies are streamed, so the
# timeout is how long to wait for the next part of a reply, not for all of it.
# A 12,000-token reply can take more than a minute, and without streaming it
# would time out on every attempt. Five attempts of a minute each keep one
# call (about five minutes at worst) well inside the 10 minutes after which a
# quiet run counts as crashed, and the stage sends a heartbeat after each call.
ANTHROPIC_TIMEOUT_SECONDS = 60.0
ANTHROPIC_MAX_RETRIES = 4

# A request that fails for one paper (a 400, a timeout that outlasts the
# SDK's retries, or a reply that breaks off) sends that paper to a person
# flagged ai_failed, so one paper can't block the queue for every later run.
# Several in a row point at a setting or an outage rather than at the papers,
# so triage stops.
FAILED_REQUESTS_BEFORE_STOPPING = 3

Effort = Literal["low", "medium", "high"]  # the levels search_config allows

ENUM_FIELDS = ("relevant", "kind", "problem")
ENUM_LIST_FIELDS = ("technology", "claim_directions")


# ---------------------------------------------------------------------------
# The prompt


@dataclass(frozen=True)
class Milestone:
    id: str
    name: str


@dataclass(frozen=True)
class TriagePrompt:
    version: str  # "triage_v1-" + 8 characters of the sha256 of system_text and schema
    system_text: str
    milestone_ids: frozenset[str]
    schema: dict  # the JSON schema sent as output_config.format


def prompt_path() -> Path:
    return PROMPT_DIR / f"{PROMPT_NAME}.md"


def prompt_version(system_text: str, schema: dict, name: str = PROMPT_NAME) -> str:
    """The prompt's name plus a hash of exactly what the model is sent.

    That's the system prompt with the milestones filled in, and the output
    schema (which lists the milestone ids too). So editing the prompt file or
    content/milestones.json gives a new version, and the review stats never
    mix two different prompts. The team notes at the top of the file aren't
    sent, so editing only those keeps the version.
    """
    digest = hashlib.sha256()
    digest.update(system_text.encode("utf-8"))
    digest.update(b"\n")
    digest.update(json.dumps(schema, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    return f"{name}-{digest.hexdigest()[:8]}"


def load_milestones(content_dir: Path, db=None) -> list[Milestone]:
    """Id and name of every real milestone, in list order. Samples are left out
    because they're made up, and papers shouldn't be linked to them.

    Once milestones have been imported into the database, it holds the real
    list (the team edits them in admin), so the published ones are read from
    there. Until then, or when the pipeline's database user can't read the
    milestones collection, they come from content/milestones.json.
    """
    if db is not None:
        from_database = load_database_milestones(db)
        if from_database is not None:
            return from_database
    path = content_dir / "milestones.json"
    if not path.exists():
        return []
    milestones: list[Milestone] = []
    for entry in json.loads(path.read_text(encoding="utf-8")):
        if entry.get("sample"):
            continue
        milestones.append(Milestone(id=entry["id"], name=entry["name"]))
    return milestones


def load_database_milestones(db) -> list[Milestone] | None:
    """The published, non-sample milestones in the database, or None when it has none (or can't be read)."""
    try:
        collection = db["milestones"]
        if collection.find_one({}, projection={"_id": 1}) is None:
            return None
        rows = list(
            collection.find({"published": True}, projection={"name": 1, "sample": 1}).sort([("position", 1), ("_id", 1)])
        )
    except PyMongoError:
        return None
    milestones: list[Milestone] = []
    for row in rows:
        if row.get("sample"):
            continue
        milestones.append(Milestone(id=row["_id"], name=row["name"]))
    return milestones


def render_milestones(milestones: list[Milestone]) -> str:
    if not milestones:
        return "(There are no milestones on the site yet, so leave this empty.)"
    lines: list[str] = []
    for milestone in milestones:
        lines.append(f"- `{milestone.id}`: {milestone.name}")
    return "\n".join(lines)


def output_schema(milestone_ids: list[str]) -> dict:
    """TriageResult's JSON schema, with milestone ids limited to the real ones."""
    schema = anthropic.transform_schema(TriageResult)
    if milestone_ids:
        schema["properties"]["milestone_ids"]["items"] = {"type": "string", "enum": milestone_ids}
    return schema


def load_prompt(content_dir: Path, path: Path | None = None, db=None) -> TriagePrompt:
    """Read the prompt file and fill in the milestones (from db when it has them, see load_milestones).

    Built once per run and sent unchanged with every call, so the prompt cache
    keeps hitting.
    """
    path = path or prompt_path()
    template = EDITOR_NOTES.sub("", path.read_text(encoding="utf-8"), count=1)
    if MILESTONES_PLACEHOLDER not in template:
        raise ValueError(f"{path.name} has no {MILESTONES_PLACEHOLDER} placeholder")

    milestones = load_milestones(content_dir, db)
    ids = [milestone.id for milestone in milestones]
    system_text = template.replace(MILESTONES_PLACEHOLDER, render_milestones(milestones)).strip()
    schema = output_schema(ids)
    return TriagePrompt(
        version=prompt_version(system_text, schema, name=path.stem),
        system_text=system_text,
        milestone_ids=frozenset(ids),
        schema=schema,
    )


def neutralize_tags(text: str) -> str:
    """Stop a title or abstract from closing the <paper> block early."""
    return re.sub(r"<(/?)(paper|title|abstract)\b", r"&lt;\1\2", text, flags=re.IGNORECASE)


def paper_message(title: str, abstract: str | None) -> str:
    """The user message: the paper inside <paper> tags, kept apart from the instructions."""
    lines = [
        "Triage this paper. Everything inside <paper> is the paper's own text.",
        "",
        "<paper>",
        f"<title>{neutralize_tags(title)}</title>",
    ]
    if abstract:
        lines.append(f"<abstract>{neutralize_tags(abstract)}</abstract>")
    lines.append("</paper>")
    if not abstract:
        lines.append("")
        lines.append("This paper has no abstract, so decide from the title alone.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Checking the model's answer


def fields_with_values(result: TriageResult) -> list[str]:
    """The fields that need an evidence entry: "relevant" always, and every
    other field the model gave a value (not null and not an empty list)."""
    names = ["relevant"]
    if result.kind is not None:
        names.append("kind")
    if result.technology:
        names.append("technology")
    if result.problem is not None:
        names.append("problem")
    if result.claim_directions:
        names.append("claim_directions")
    return names


class CheckedTriageResult(TriageResult):
    """TriageResult plus the rules the JSON schema can't express.

    A "no" can leave every other field empty. A "yes" needs a kind and at
    least one technology. Every field with a value needs one evidence entry,
    so a reviewer always sees why the AI chose it ("relevant" always needs
    one). Quotes are capped at MAX_QUOTE_LENGTH, the same cap as public
    quotes, because assessments are kept for good and a long quote would keep
    a copyrighted abstract after the paper's own copy is deleted. Milestone
    ids must be real ones (passed in the validation context).
    """

    @model_validator(mode="after")
    def check_fields_agree(self, info: ValidationInfo) -> Self:
        problems: list[str] = []
        if self.relevant == Relevant.YES:
            if self.kind is None:
                problems.append('kind is required when relevant is "yes"')
            if not self.technology:
                problems.append('technology needs at least one value when relevant is "yes"')

        evidence_fields = [evidence.field for evidence in self.evidence]
        for name in fields_with_values(self):
            if name not in evidence_fields:
                problems.append(f'evidence needs an entry for "{name}"')
        for name in set(evidence_fields):
            if evidence_fields.count(name) > 1:
                problems.append(f'evidence has more than one entry for "{name}"')
        for evidence in self.evidence:
            if not evidence.quote.strip():
                problems.append(f'the quote for "{evidence.field}" is empty')
            elif len(evidence.quote) > MAX_QUOTE_LENGTH:
                problems.append(f'the quote for "{evidence.field}" is longer than {MAX_QUOTE_LENGTH} characters')

        context = info.context or {}
        known_ids = context.get("milestone_ids")
        if known_ids is not None:
            unknown = [milestone_id for milestone_id in self.milestone_ids if milestone_id not in known_ids]
            if unknown:
                problems.append(f"unknown milestone ids: {', '.join(unknown)}")

        if problems:
            raise ValueError("; ".join(problems))
        return self


def lowercase_enum_values(data: object) -> object:
    """Structured output doesn't guarantee the case of enum values, so compare
    them in lowercase. The raw output is stored unchanged."""
    if not isinstance(data, dict):
        return data
    fixed = dict(data)
    for name in ENUM_FIELDS:
        if isinstance(fixed.get(name), str):
            fixed[name] = fixed[name].lower()
    for name in ENUM_LIST_FIELDS:
        if isinstance(fixed.get(name), list):
            fixed[name] = [value.lower() if isinstance(value, str) else value for value in fixed[name]]
    if isinstance(fixed.get("evidence"), list):
        evidence = []
        for entry in fixed["evidence"]:
            if isinstance(entry, dict) and isinstance(entry.get("field"), str):
                entry = {**entry, "field": entry["field"].lower()}
            evidence.append(entry)
        fixed["evidence"] = evidence
    return fixed


def summarize_validation_error(error: ValidationError, limit: int = 5) -> str:
    parts: list[str] = []
    for detail in error.errors()[:limit]:
        location = ".".join(str(part) for part in detail["loc"]) or "result"
        parts.append(f"{location}: {detail['msg']}")
    return "; ".join(parts)


def parse_result(text: str, milestone_ids: frozenset[str]) -> tuple[TriageResult | None, str | None]:
    """The validated result, or None and a short reason it was rejected."""
    if not text.strip():
        return None, "The model returned no text."
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        return None, f"The output isn't valid JSON ({error.msg} at character {error.pos})."
    try:
        checked = CheckedTriageResult.model_validate(lowercase_enum_values(data), context={"milestone_ids": milestone_ids})
    except ValidationError as error:
        return None, "The output doesn't fit the schema: " + summarize_validation_error(error)
    return TriageResult.model_validate(checked.model_dump()), None


def normalize_for_match(text: str) -> str:
    """NFKC, case folded, whitespace collapsed: the form quotes are compared in."""
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def quote_found(quote: str, title: str, abstract: str | None) -> bool:
    """Does the quote appear in the title or the abstract?

    Surrounding quote marks, trailing punctuation and leading or trailing
    ellipses are ignored, since models often add or drop them.
    """
    needle = normalize_for_match(quote).strip("\"'“”‘’ ")
    needle = needle.strip(".").strip()
    needle = needle.rstrip(",;:").strip()
    if not needle:
        return False
    for text in (title, abstract or ""):
        if needle in normalize_for_match(text):
            return True
    return False


def check_quotes(result: TriageResult, title: str, abstract: str | None) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    for evidence in result.evidence:
        found = quote_found(evidence.quote, title, abstract)
        checks[evidence.field] = checks.get(evidence.field, True) and found
    return checks


# ---------------------------------------------------------------------------
# Calling the model


@dataclass
class TriageOutcome:
    """Every call made for one paper, and what came of them."""

    assessments: list[AiAssessment]
    result: TriageResult | None
    refused: bool = False
    request_failed: bool = False  # the last call got no reply (a 400, a timeout, or a reply that broke off)

    @property
    def failed(self) -> bool:
        return self.result is None

    @property
    def final(self) -> AiAssessment:
        return self.assessments[-1]

    @property
    def first_attempt_valid(self) -> bool:
        return self.assessments[0].parsed is not None

    @property
    def cost_usd(self) -> float:
        return sum(assessment.cost_usd for assessment in self.assessments)


def make_client(settings: Settings) -> anthropic.Anthropic | None:
    """The Anthropic client, or None when no API key is set (triage is then skipped)."""
    if not settings.anthropic_api_key:
        return None
    return anthropic.Anthropic(
        api_key=settings.anthropic_api_key,
        timeout=ANTHROPIC_TIMEOUT_SECONDS,
        max_retries=ANTHROPIC_MAX_RETRIES,
    )


class ReplyInterrupted(Exception):
    """The reply broke off while it was streaming.

    The SDK retries a request that fails before the reply starts, but not one
    that stops partway, so this is handled like a timeout: the paper goes to
    a person flagged ai_failed.
    """

    def __init__(self, cause: Exception) -> None:
        super().__init__(f"The reply broke off partway ({type(cause).__name__}: {cause})")
        self.cause = cause


def request_triage(
    client: anthropic.Anthropic, prompt: TriagePrompt, *, model: str, effort: Effort, max_tokens: int, user_message: str
) -> Message:
    """One Messages API call, streamed and read to the end.

    Streaming keeps a long reply from hitting the client timeout (see
    ANTHROPIC_TIMEOUT_SECONDS). output_config.format rather than
    messages.parse: parse raises when the reply doesn't validate, and the raw
    text and token usage would be lost with it. We keep both for every call.
    """
    # Entering the block sends the request; errors there are retried by the SDK.
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        # The prompt is identical for every paper in a run, so it's cached.
        system=[{"type": "text", "text": prompt.system_text, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_message}],
        thinking={"type": "adaptive"},
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": prompt.schema}},
    ) as stream:
        try:
            return stream.get_final_message()
        except (httpx2.TransportError, anthropic.APIStatusError) as error:
            # A dropped connection, a read timeout, or an error event (such
            # as overloaded) after the reply had started.
            raise ReplyInterrupted(error) from error


def token_usage(usage: object) -> TokenUsage:
    return TokenUsage(
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        cache_read_input_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cache_creation_input_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
    )


def new_assessment_id() -> str:
    return "asmt-" + uuid.uuid4().hex[:16]


@dataclass(frozen=True)
class PaperToTriage:
    source_id: str
    title: str
    abstract: str | None


@dataclass(frozen=True)
class TriageSettings:
    model: str
    effort: Effort
    run_id: str | None = None


def read_response(
    response: Message, prompt: TriagePrompt, paper: PaperToTriage, settings: TriageSettings, max_tokens: int
) -> tuple[AiAssessment, TriageResult | None]:
    """Turn one API response into an assessment record, checking whatever it returned."""
    text = "".join(block.text for block in response.content if block.type == "text")
    usage = token_usage(response.usage)
    result: TriageResult | None = None
    error: str | None = None
    refusal_category: str | None = None
    quote_checks: dict[str, bool] = {}

    if response.stop_reason == "refusal":
        details = response.stop_details
        refusal_category = details.category if details else None
        explanation = details.explanation if details else None
        error = "The model declined to answer" + (f": {explanation}" if explanation else ".")
    elif response.stop_reason == "max_tokens":
        error = f"The answer was cut off at the {max_tokens} token limit."
    else:
        result, error = parse_result(text, prompt.milestone_ids)
        if result is not None:
            quote_checks = check_quotes(result, paper.title, paper.abstract)

    assessment = AiAssessment(
        id=new_assessment_id(),
        source_id=paper.source_id,
        run_id=settings.run_id,
        model=response.model or settings.model,
        effort=settings.effort,
        prompt_version=prompt.version,
        rubric_version=RUBRIC_VERSION,
        created_at=now(),
        stop_reason=response.stop_reason,
        refusal_category=refusal_category,
        raw_output=text,
        parsed=result,
        quote_checks=quote_checks,
        error=error,
        usage=usage,
        cost_usd=cost_usd(settings.model, usage),
    )
    return assessment, result


# API errors that belong to one paper rather than to the run. See
# FAILED_REQUESTS_BEFORE_STOPPING.
PER_PAPER_ERRORS = (anthropic.BadRequestError, anthropic.APITimeoutError, ReplyInterrupted)


def assess_paper(
    client: anthropic.Anthropic,
    prompt: TriagePrompt,
    paper: PaperToTriage,
    settings: TriageSettings,
    heartbeat: Callable[[], None] | None = None,
) -> TriageOutcome:
    """Ask the model about one paper, retrying the way the design asks.

    A refusal is final (asking again gets the same answer) and goes to a
    person flagged ai_failed. A reply cut off at max_tokens is retried once
    with a larger cap. A reply that doesn't validate is retried once. After
    that the paper goes to a person flagged ai_failed.

    A 400, a timeout or a reply that breaks off ends the paper's attempts
    with request_failed set, keeping the calls made before it. Other API
    errors (a bad key, an outage that outlasts the SDK's retries) are raised
    for the caller to handle.

    `heartbeat` is called after each call, because one paper can take up to
    three calls and the run counts as crashed after 10 quiet minutes.
    """
    user_message = paper_message(paper.title, paper.abstract)
    assessments: list[AiAssessment] = []
    max_tokens = FIRST_MAX_TOKENS
    retried_cut_off = False
    retried_invalid = False

    while True:
        try:
            response = request_triage(
                client, prompt, model=settings.model, effort=settings.effort, max_tokens=max_tokens, user_message=user_message
            )
        except PER_PAPER_ERRORS as error:
            assessments.append(failed_request_assessment(error, prompt, paper, settings))
            return TriageOutcome(assessments=assessments, result=None, request_failed=True)
        assessment, result = read_response(response, prompt, paper, settings, max_tokens)
        assessments.append(assessment)
        if heartbeat is not None:
            heartbeat()

        if response.stop_reason == "refusal":
            return TriageOutcome(assessments=assessments, result=None, refused=True)
        if result is not None:
            return TriageOutcome(assessments=assessments, result=result)
        if response.stop_reason == "max_tokens":
            if retried_cut_off:
                return TriageOutcome(assessments=assessments, result=None)
            retried_cut_off = True
            max_tokens = RETRY_MAX_TOKENS
            continue
        if retried_invalid:
            return TriageOutcome(assessments=assessments, result=None)
        retried_invalid = True


NO_USAGE_NOTE = "Any tokens it used weren't reported, so they aren't in the cost."


def request_error_message(error: Exception) -> str:
    if isinstance(error, anthropic.APITimeoutError):
        return f"The request timed out, even after the SDK's retries. {NO_USAGE_NOTE}"
    if isinstance(error, ReplyInterrupted):
        return f"{error}. {NO_USAGE_NOTE}"
    if isinstance(error, anthropic.APIStatusError):
        return f"The API rejected the request (HTTP {error.status_code}): {error.message}"
    return f"The request failed: {type(error).__name__}: {error}"


def failed_request_assessment(
    error: Exception, prompt: TriagePrompt, paper: PaperToTriage, settings: TriageSettings
) -> AiAssessment:
    """An assessment for a request that got no reply, so the record shows what happened."""
    return AiAssessment(
        id=new_assessment_id(),
        source_id=paper.source_id,
        run_id=settings.run_id,
        model=settings.model,
        effort=settings.effort,
        prompt_version=prompt.version,
        rubric_version=RUBRIC_VERSION,
        created_at=now(),
        stop_reason=None,
        raw_output="",
        parsed=None,
        error=request_error_message(error),
        usage=TokenUsage(),
        cost_usd=0.0,
    )


# ---------------------------------------------------------------------------
# Routing


Counter = Literal["relevant", "unsure", "triaged_out", "spot_checks", "quote_mismatches", "failed"]


@dataclass(frozen=True)
class Route:
    status: ReviewStatus
    flags: list[CandidateFlag] = field(default_factory=list)
    counter: Counter = "failed"


def in_spot_check_sample(source_id: str, rate: float) -> bool:
    """A fixed share of ids, chosen by hash, so the same paper always gets the
    same answer and a rerun doesn't change who was sampled."""
    if rate <= 0:
        return False
    bucket = int(hashlib.sha256(source_id.encode("utf-8")).hexdigest()[:8], 16) / 0x1_0000_0000
    return bucket < rate


def route_candidate(
    result: TriageResult | None,
    *,
    source_id: str,
    has_abstract: bool,
    spot_check_rate: float,
    quote_checks: dict[str, bool] | None = None,
) -> Route:
    """Where the candidate goes next. `quote_checks` is the assessment's
    record of which quotes were found in the paper."""
    flags: list[CandidateFlag] = [] if has_abstract else ["no_abstract"]
    if result is None:
        return Route(ReviewStatus.PENDING_REVIEW, flags + ["ai_failed"], "failed")
    if result.relevant == Relevant.YES:
        return Route(ReviewStatus.PENDING_REVIEW, flags, "relevant")
    if result.relevant == Relevant.UNSURE:
        return Route(ReviewStatus.PENDING_REVIEW, flags, "unsure")
    # A "no" backed by a quote that isn't in the paper can't be trusted, and a
    # triaged-out paper is rarely seen again, so a person checks it.
    if (quote_checks or {}).get("relevant") is False:
        return Route(ReviewStatus.PENDING_REVIEW, flags + ["quote_mismatch"], "quote_mismatches")
    if in_spot_check_sample(source_id, spot_check_rate):
        return Route(ReviewStatus.PENDING_REVIEW, flags + ["spot_check"], "spot_checks")
    return Route(ReviewStatus.TRIAGED_OUT, flags, "triaged_out")


# ---------------------------------------------------------------------------
# The stage


class RunReporter(Protocol):
    """What a stage needs from the run record (RunRecorder in runs.py)."""

    @property
    def cost_usd(self) -> float: ...

    def log(self, message: str) -> None: ...

    def error(self, message: str) -> None: ...

    def add_counts(self, **counts: int) -> None: ...

    def add_usage(self, usage: TokenUsage, cost: float) -> None: ...

    def heartbeat(self) -> None: ...


class TriageAborted(Exception):
    """Stop triaging for this run. Candidates not reached yet stay "new" for the next run."""


CANDIDATE_FIELDS = {"_id": 1, "id": 1, "title": 1, "abstract": 1}


def latest_assessments(db, source_ids: list[str], version: str) -> dict[str, dict]:
    """The newest assessment per source made with this prompt version, in one query.

    A source that's still "new" but already has one was assessed by a run that
    stopped before moving it on. Its assessment is reused instead of paying
    for the same call twice.
    """
    latest: dict[str, dict] = {}
    if not source_ids:
        return latest
    query = {"source_id": {"$in": source_ids}, "prompt_version": version}
    for doc in db["ai_assessments"].find(query).sort("created_at", 1):
        latest[doc["source_id"]] = doc
    return latest


def stored_result(assessment_doc: dict) -> TriageResult | None:
    parsed = assessment_doc.get("parsed")
    return TriageResult.model_validate(parsed) if parsed else None


def save_outcome(db, outcome: TriageOutcome) -> None:
    db["ai_assessments"].insert_many([to_doc(assessment) for assessment in outcome.assessments])


def apply_route(db, candidate: dict, route: Route, assessment_id: str) -> bool:
    """Move the candidate on, and say whether it moved.

    The filter on "new" means a candidate a person has already handled is
    never moved by the pipeline. It returns False for one a reviewer decided
    from the New tab while its call was running.
    """
    update: dict = {
        "$set": {"review_status": route.status.value, "current_assessment_id": assessment_id, "updated_at": now()}
    }
    if route.status == ReviewStatus.TRIAGED_OUT:
        # Abstracts are kept only while a candidate is new or pending review,
        # because journal abstracts are copyrighted. The title and link stay.
        update["$set"]["abstract"] = None
    if route.flags:
        update["$addToSet"] = {"flags": {"$each": list(route.flags)}}
    result = db["sources"].update_one({"_id": candidate["_id"], "review_status": ReviewStatus.NEW.value}, update)
    return result.matched_count == 1


def still_new(db, candidate: dict) -> bool:
    """Is the candidate still waiting for triage? The batch is loaded once at
    the start, and a reviewer can decide a "new" paper while the run goes."""
    return db["sources"].find_one({"_id": candidate["_id"], "review_status": ReviewStatus.NEW.value}, {"_id": 1}) is not None


def triage_one(
    db, client: anthropic.Anthropic, prompt: TriagePrompt, candidate: dict, settings: TriageSettings, reporter: RunReporter
) -> TriageOutcome:
    """Assess one candidate and save every call, including one that got no reply."""
    paper = PaperToTriage(source_id=candidate["id"], title=candidate["title"], abstract=candidate.get("abstract"))
    try:
        outcome = assess_paper(client, prompt, paper, settings, heartbeat=reporter.heartbeat)
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError, anthropic.NotFoundError) as error:
        raise TriageAborted(
            f"The Anthropic API refused the key or the model {settings.model} (HTTP {error.status_code}). "
            "Check ANTHROPIC_API_KEY and the model in the search config."
        ) from error
    except (anthropic.APIConnectionError, anthropic.APIStatusError) as error:
        raise TriageAborted(f"The Anthropic API kept failing after several retries ({type(error).__name__}).") from error

    save_outcome(db, outcome)
    for assessment in outcome.assessments:
        reporter.add_usage(assessment.usage, assessment.cost_usd)
    return outcome


def run_triage_stage(
    db,
    client: anthropic.Anthropic | None,
    config: SearchConfig,
    reporter: RunReporter,
    *,
    prompt: TriagePrompt,
    run_id: str | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    would_be_new: int = 0,
) -> bool:
    """Triage new candidates, oldest first, until none are left or a limit is hit.

    Returns False when the stage had to stop because of an error.
    `would_be_new` is how many candidates a dry-run collect would have added.
    """
    sources = db["sources"]
    waiting = sources.count_documents({"review_status": ReviewStatus.NEW.value})
    cap = config.max_items_per_run if limit is None else min(limit, config.max_items_per_run)

    if dry_run:
        total = waiting + would_be_new
        would_triage = min(total, cap)
        reporter.add_counts(triaged=would_triage, skipped=total - would_triage)
        reporter.log(
            f"Dry run: would triage {would_triage} of {plural(total, 'candidate')} with {config.model} "
            f"at {config.effort} effort. No model was called."
        )
        return True

    if client is None:
        reporter.add_counts(skipped=waiting)
        reporter.log(
            f"Triage skipped: ANTHROPIC_API_KEY isn't set, so no model was called. "
            f"{plural(waiting, 'new candidate')} {'is' if waiting == 1 else 'are'} waiting for a run that has a key."
        )
        return True

    try:
        price_table(config.model)
    except UnknownModelPrice as error:
        # Without a price the cost limit can't work, so nothing is sent.
        reporter.add_counts(skipped=waiting)
        reporter.error(f"Triage didn't start: {error}")
        return False
    if waiting == 0:
        reporter.log("Nothing to triage: there are no new candidates.")
        return True

    candidates = list(
        sources.find({"review_status": ReviewStatus.NEW.value}, CANDIDATE_FIELDS).sort([("found_at", 1), ("_id", 1)]).limit(cap)
    )
    earlier = latest_assessments(db, [candidate["id"] for candidate in candidates], prompt.version)
    settings = TriageSettings(model=config.model, effort=config.effort, run_id=run_id)
    reporter.log(
        f"Triaging {len(candidates)} of {plural(waiting, 'new candidate')} with {config.model} "
        f"at {config.effort} effort, prompt {prompt.version}."
    )

    stopped_by: str | None = None
    finished_cleanly = True
    failed_in_a_row = 0
    reused = 0
    decided_meanwhile = 0
    try:
        for candidate in candidates:
            if reporter.cost_usd >= config.max_cost_usd_per_run:
                stopped_by = f"this run reached its ${config.max_cost_usd_per_run:.2f} cost limit"
                break

            if candidate["id"] in earlier:
                assessment_doc = earlier[candidate["id"]]
                result = stored_result(assessment_doc)
                assessment_id = assessment_doc["id"]
                quote_checks = assessment_doc.get("quote_checks") or {}
                request_failed = False
                reused += 1
            elif not still_new(db, candidate):
                # A person decided it after the batch was loaded, so don't pay for a call.
                decided_meanwhile += 1
                continue
            else:
                outcome = triage_one(db, client, prompt, candidate, settings, reporter)
                result = outcome.result
                assessment_id = outcome.final.id
                quote_checks = outcome.final.quote_checks
                request_failed = outcome.request_failed

            route = route_candidate(
                result,
                source_id=candidate["id"],
                has_abstract=bool(candidate.get("abstract")),
                spot_check_rate=config.spot_check_rate,
                quote_checks=quote_checks,
            )
            if apply_route(db, candidate, route, assessment_id):
                reporter.add_counts(triaged=1, **{route.counter: 1})
            else:
                decided_meanwhile += 1
            reporter.heartbeat()

            failed_in_a_row = failed_in_a_row + 1 if request_failed else 0
            if failed_in_a_row >= FAILED_REQUESTS_BEFORE_STOPPING:
                raise TriageAborted(
                    f"The Anthropic API failed {failed_in_a_row} requests in a row (a 400, a timeout or a reply that "
                    "broke off). That usually means a setting is wrong or the API is having trouble, rather than "
                    "a problem with the papers. See the error on the latest assessments."
                )
    except TriageAborted as error:
        reporter.error(f"Triage stopped: {error}")
        finished_cleanly = False

    if reused:
        reporter.log(f"Reused {plural(reused, 'assessment')} that an earlier, interrupted run had already paid for.")
    if decided_meanwhile:
        were = "was" if decided_meanwhile == 1 else "were"
        reporter.log(
            f"{plural(decided_meanwhile, 'candidate')} {were} decided by a person during this run, so triage left them alone."
        )
    remaining = sources.count_documents({"review_status": ReviewStatus.NEW.value})
    if remaining:
        reporter.add_counts(skipped=remaining)
        reason = stopped_by or ("of the error above" if not finished_cleanly else f"this run triages at most {cap}")
        waits = "waits" if remaining == 1 else "wait"
        reporter.log(f"{plural(remaining, 'new candidate')} {waits} for the next run, because {reason}.")
    return finished_cleanly
