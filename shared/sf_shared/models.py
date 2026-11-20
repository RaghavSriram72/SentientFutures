"""Pydantic models for everything in content/ and in the data folder the publish step exports.

These mirror frontend/lib/types.ts field for field. If you change a field here,
change it there too. A TypeScript `x: T | null` is a required key that may be
null (no default here); `x?: T | null` is an optional key (default None).

Rules that only need one record live here as validators. Rules that compare
records (ids, references, dependency cycles) live in validate.py.

Numbers and booleans are strict on purpose: "2030" in quotes would pass a
lenient check, but the site reads the raw JSON and would get a string.
"""

import difflib
import re
from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, Strict, model_validator
from pydantic_core import PydanticCustomError

from sf_shared.claims import (
    Claim,
    NonEmptyStr,
    RuleProblem,
    ai_review_problems,
    is_blank,
    quote_problems,
    raise_problems,
)
from sf_shared.enums import (
    ENUM_INFO,
    AgencyEffect,
    CaseRating,
    ClaimDirection,
    Confidence,
    Credibility,
    Directness,
    EvidenceBasis,
    EvidenceDirectness,
    EvidenceRole,
    EvidenceStatus,
    EvidenceType,
    GovernanceStatus,
    Independence,
    Likelihood,
    MilestoneCategory,
    MilestoneStatus,
    Problem,
    Provenance,
    Relevance,
    RiskDomain,
    RiskLevel,
    Severity,
    SourceKind,
    SourceType,
    Stage,
    Technology,
    UnclearReason,
)
from sf_shared.normalize import is_web_link

SLUG_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")


def _check_slug(value: str) -> str:
    if not SLUG_PATTERN.fullmatch(value):
        raise PydanticCustomError(
            "slug",
            "must be lowercase letters, numbers and single hyphens, like bci-medical-approval",
        )
    return value


def _check_date(value: str) -> str:
    if not DATE_PATTERN.fullmatch(value):
        raise PydanticCustomError("date_format", "must be a date written YYYY-MM-DD, like 2026-10-26")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise PydanticCustomError("date_value", "is not a real calendar date") from None
    return value


# Ids end up in URLs and anchors, so they are slugs.
Slug = Annotated[str, AfterValidator(_check_slug)]
# Dates stay strings (as in types.ts) but must be real YYYY-MM-DD dates.
IsoDate = Annotated[str, AfterValidator(_check_date)]
StrictBool = Annotated[bool, Strict()]
# Forecast windows can run past 2100 (the timeline clamps them), so the bounds
# here only catch typos like 203 or 20300.
WindowYear = Annotated[int, Strict(), Field(ge=1900, le=3000)]
# The year a forecast was made, or a milestone was achieved.
EventYear = Annotated[int, Strict(), Field(ge=1950, le=2100)]
PublicationYear = Annotated[int, Strict(), Field(ge=1800, le=2100)]


# ---------- The workbook's ids (scorecard v0.4) ----------
# The workbook names things by code: evidence entries E001, causal links
# WBE-O-L1, risks R01, governance items G01, milestone rows M1 (or BCI-M1 when
# the family is part of the code). The family prefix in a code maps to a page.
FAMILY_BY_PREFIX = {"WBE": "wbe", "BCI": "bci", "NM": "neuromorphic"}
_PREFIXES = "|".join(FAMILY_BY_PREFIX)

ENTRY_ID_PATTERN = re.compile(r"E\d{3,}")
LINK_ID_PATTERN = re.compile(rf"(?P<scenario>(?P<prefix>{_PREFIXES})-[A-Z])-L\d+")
RISK_ID_PATTERN = re.compile(r"R\d{2,}")
GOVERNANCE_ID_PATTERN = re.compile(r"G\d{2,}")
FRAMEWORK_ID_PATTERN = re.compile(r"RF\d+")
MILESTONE_CODE_PATTERN = re.compile(r"M\d+")
# A milestone row named with its family, as the register's column E does: "BCI-M1".
FAMILY_MILESTONE_PATTERN = re.compile(rf"(?P<prefix>{_PREFIXES})-(?P<milestone>M\d+)")
SCENARIO_CODE_PATTERN = re.compile(rf"(?P<prefix>{_PREFIXES})-[A-Z]")
REGISTER_ID_PATTERN = re.compile(r"S\d{2,}")
STAGE_CODE_PATTERN = re.compile(r"S\d+")
ALIGNMENT_PROBLEM_PATTERN = re.compile(r"A-[A-Z]+")
WORKBOOK_VERSION_PATTERN = re.compile(r"\d+\.\d+")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


def _pattern_checker(pattern: re.Pattern[str], error_type: str, message: str, also_allowed: tuple[str, ...] = ()):
    """An AfterValidator that accepts a string matching the pattern (or one of also_allowed)."""

    def check(value: str) -> str:
        if value in also_allowed or pattern.fullmatch(value):
            return value
        raise PydanticCustomError(error_type, message)

    return check


EntryId = Annotated[str, AfterValidator(_pattern_checker(ENTRY_ID_PATTERN, "entry_id", 'must be an evidence entry id like "E001"'))]
LinkId = Annotated[
    str, AfterValidator(_pattern_checker(LINK_ID_PATTERN, "link_id", 'must be a causal link id like "WBE-O-L1"'))
]
RiskId = Annotated[str, AfterValidator(_pattern_checker(RISK_ID_PATTERN, "risk_id", 'must be a risk id like "R01"'))]
GovernanceId = Annotated[
    str, AfterValidator(_pattern_checker(GOVERNANCE_ID_PATTERN, "governance_id", 'must be a checklist id like "G01"'))
]
FrameworkId = Annotated[
    str, AfterValidator(_pattern_checker(FRAMEWORK_ID_PATTERN, "framework_id", 'must be a framework id like "RF1"'))
]
MilestoneCode = Annotated[
    str, AfterValidator(_pattern_checker(MILESTONE_CODE_PATTERN, "milestone_code", 'must be a milestone code like "M1"'))
]
ScenarioCode = Annotated[
    str,
    AfterValidator(
        _pattern_checker(SCENARIO_CODE_PATTERN, "scenario_code", 'must be a scenario code like "WBE-O", "BCI-D" or "NM-A"')
    ),
]
RegisterId = Annotated[
    str,
    AfterValidator(
        _pattern_checker(REGISTER_ID_PATTERN, "register_id", 'must look like "S02": a capital S and at least two digits')
    ),
]
StageCode = Annotated[
    str,
    AfterValidator(_pattern_checker(STAGE_CODE_PATTERN, "stage_code", 'must be a stage like "S1", or "N/A"', ("N/A",))),
]
AlignmentProblemCode = Annotated[
    str,
    AfterValidator(
        _pattern_checker(
            ALIGNMENT_PROBLEM_PATTERN, "alignment_problem", 'must be an alignment problem code like "A-VS", or "N/A"', ("N/A",)
        )
    ),
]

# The technology pages a workbook row can belong to.
Family = Literal["wbe", "bci", "neuromorphic"]
# Evidence entries can also span families (the register's "Cross-family").
EntryFamily = Literal["wbe", "bci", "neuromorphic", "cross_family"]
# The register's "Outcome addressed" and the links' "Outcome", word for word.
Outcome = Literal["AI Alignment", "Intelligence Curse", "Both", "Neither"]
# What a register entry feeds: a headline rating or a milestone row (M1 to M9).
FEED_RATING_TARGETS = ("alignment", "intelligence_curse")
FeedTarget = Annotated[
    str,
    AfterValidator(
        _pattern_checker(
            MILESTONE_CODE_PATTERN,
            "feed_target",
            'must be "alignment", "intelligence_curse" or a milestone code like "M1"',
            FEED_RATING_TARGETS,
        )
    ),
]


def repeated_problems(values: list, path: str) -> list["RuleProblem"]:
    """A problem for each value already listed earlier in the same list."""
    problems: list[RuleProblem] = []
    first_index: dict[object, int] = {}
    for index, value in enumerate(values):
        if value in first_index:
            problems.append((f"{path}[{index}]", f'"{value}" is listed twice'))
        else:
            first_index[value] = index
    return problems


class Forecast(BaseModel):
    """One forecast from one forecaster, stored as stated. Never averaged.

    point "in 2045"    -> earliest 2045, latest 2045
    "by 2045"          -> earliest null, latest 2045
    "not before 2045"  -> earliest 2045, latest null
    "never"            -> never true, earliest and latest null
    """

    model_config = ConfigDict(extra="forbid")

    id: Slug
    source_id: NonEmptyStr
    forecaster: NonEmptyStr
    claim: NonEmptyStr
    quote: str  # checked below, so the message can explain the limit
    quote_location: str | None = None
    made_in: EventYear
    earliest: WindowYear | None
    latest: WindowYear | None
    never: StrictBool

    @model_validator(mode="after")
    def check_shape(self) -> "Forecast":
        problems: list[RuleProblem] = []

        if self.never:
            if self.earliest is not None:
                problems.append(("earliest", 'must be null when never is true (a "never" forecast has no years)'))
            if self.latest is not None:
                problems.append(("latest", 'must be null when never is true (a "never" forecast has no years)'))
        else:
            if self.earliest is None and self.latest is None:
                problems.append(
                    ("", "earliest and latest are both null. Give at least one year, or set never to true")
                )

        if self.earliest is not None and self.latest is not None and self.earliest > self.latest:
            problems.append(("latest", f"{self.latest} is before earliest ({self.earliest})"))

        problems.extend(quote_problems(self.quote, "quote", "every forecast needs its exact quote"))
        raise_problems(problems)
        return self


class Estimate(BaseModel):
    """The team's own range. Drawn on the timeline as a solid ribbon, and every forecast stays visible next to it."""

    model_config = ConfigDict(extra="forbid")

    earliest: WindowYear
    latest: WindowYear | None
    basis: Claim
    set_by: NonEmptyStr
    set_on: IsoDate

    @model_validator(mode="after")
    def check_range(self) -> "Estimate":
        problems: list[RuleProblem] = []
        if self.latest is not None and self.earliest > self.latest:
            problems.append(("latest", f"{self.latest} is before earliest ({self.earliest})"))
        raise_problems(problems)
        return self


class DisagreementOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flagged: StrictBool
    basis: Claim


class Milestone(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Slug  # never changes once public
    name: NonEmptyStr
    technology: Technology
    stage: Stage
    category: MilestoneCategory
    status: MilestoneStatus
    status_basis: Claim
    achieved_in: EventYear | None
    achieved_in_basis: Claim | None
    confidence: Confidence | None  # required when estimate is set
    summary: Claim
    success_criterion: Claim
    main_bottleneck: Claim | None  # null when the workbook's cell is empty
    depends_on: list[str]
    source_ids: list[str]
    estimate: Estimate | None
    forecasts: list[Forecast]
    disagreement_override: DisagreementOverride | None
    disagreement_note: Claim | None
    would_move_earlier: list[Claim]
    would_move_later: list[Claim]
    artificial_minds_questions: list[Claim]
    # From the workbook's milestone tab (1a), all optional so documents stored
    # before they existed still validate. assessment_confidence is the tab's
    # "Confidence" in the status; `confidence` above stays the team range's.
    assessment_confidence: Confidence | None = None
    applies_to: NonEmptyStr | None = None
    criterion_met: NonEmptyStr | None = None  # the "Criterion met?" cell, word for word
    evidence_entries: list[EntryId] = []  # the E-ids the evidence cell cites, for counts and filters
    timing: NonEmptyStr | None = None
    note: NonEmptyStr | None = None
    sample: StrictBool = False  # true for the worked examples, which the public site leaves out

    @model_validator(mode="after")
    def check_milestone_rules(self) -> "Milestone":
        problems: list[RuleProblem] = []
        problems.extend(repeated_problems(self.evidence_entries, "evidence_entries"))

        if self.estimate is not None and self.confidence is None:
            problems.append(("confidence", "required when there is an estimate (high, medium or low)"))

        if self.achieved_in is not None:
            if self.achieved_in_basis is None:
                problems.append(
                    ("achieved_in_basis", "required when achieved_in is set. Cite the source that shows it happened")
                )
            elif self.achieved_in_basis.provenance != Provenance.SOURCE:
                problems.append(
                    (
                        "achieved_in_basis.provenance",
                        'must be "source" when achieved_in is set. Saying it happened needs a quote',
                    )
                )
        elif self.achieved_in_basis is not None:
            problems.append(("achieved_in_basis", "should be null when achieved_in is null"))

        if len(self.would_move_earlier) == 0:
            problems.append(
                ("would_move_earlier", 'needs at least one entry (use provenance "unclear" if nothing is known)')
            )
        if len(self.would_move_later) == 0:
            problems.append(
                ("would_move_later", 'needs at least one entry (use provenance "unclear" if nothing is known)')
            )

        first_index_of_id: dict[str, int] = {}
        for index, forecast in enumerate(self.forecasts):
            if forecast.id in first_index_of_id:
                earlier = first_index_of_id[forecast.id]
                problems.append(
                    (f"forecasts[{index}].id", f'"{forecast.id}" is already used by forecasts[{earlier}]')
                )
            else:
                first_index_of_id[forecast.id] = index

        problems.extend(ai_review_problems(self, self.sample))
        raise_problems(problems)
        return self


# The source fields an AI may fill in. Each one is shown with an AI mark on the
# source card (frontend/components/sources/CatalogCard.tsx), so add a field
# here only once the card marks it too. The summary isn't here because it's a
# Claim and carries its own provenance.
AI_SUGGESTABLE_SOURCE_FIELDS = (
    "source_type",
    "kind",
    "technology",
    "problem",
    "claim_directions",
    "evidence_type",
    "directness",
    "independence",
    "relevance",
    "credibility",
    "credibility_unclear_reason",
)

# Reasons that can stand on their own. "other" needs a written note, so it's
# only allowed where there's a field for one (Claim.unclear_note).
SPECIFIC_UNCLEAR_REASONS = ", ".join(
    [member.value for member in UnclearReason if member != UnclearReason.OTHER]
)


class SourceQuality(BaseModel):
    """One row of the workbook's "3a Source Quality" tab, each cell word for word."""

    model_config = ConfigDict(extra="forbid")

    source_type: NonEmptyStr | None = None  # "Source type"
    empirical_theoretical: NonEmptyStr | None = None  # "Empirical / theoretical"
    original_secondary: NonEmptyStr | None = None  # "Original / secondary"
    peer_review: NonEmptyStr | None = None  # "Peer-review status"
    affiliation: NonEmptyStr | None = None  # "Affiliation / independence"


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Slug
    register_id: str | None = None  # the team's evidence register id, e.g. "S02"
    title: NonEmptyStr
    authors: list[NonEmptyStr]  # empty when the authors aren't known
    year: PublicationYear
    url: NonEmptyStr
    other_urls: list[NonEmptyStr] = []  # mirrors, write-ups, or the primary source behind a secondary one
    doi: str | None = None
    arxiv_id: str | None = None
    venue: str | None = None
    source_type: SourceType
    kind: SourceKind | None = None  # null = not classified yet
    technology: list[Technology]  # empty for general background, like the Intelligence Curse essay
    problem: Problem | None
    claim_directions: list[ClaimDirection] = []
    # The rubric ratings. null = not rated yet (the scouting database has no ratings).
    evidence_type: EvidenceType | None = None
    directness: Directness | None = None
    independence: Independence | None = None
    relevance: Relevance | None = None
    credibility: Credibility | None = None
    credibility_unclear_reason: UnclearReason | None = None
    summary: Claim
    ai_suggested_fields: list[str]  # source field names an AI filled in, e.g. ["evidence_type"]
    added_by: str | None = None
    reviewed_by: str | None = None
    reviewed_on: IsoDate | None = None
    # The workbook's source quality tab (3a), word for word. null = not coded.
    quality: SourceQuality | None = None
    # True while the workbook marks the source "screening pending".
    screening_pending: StrictBool = False
    sample: StrictBool = False

    @model_validator(mode="after")
    def check_source_rules(self) -> "Source":
        problems: list[RuleProblem] = []

        if not (self.url.startswith("https://") or self.url.startswith("http://")):
            problems.append(("url", "must start with https:// or http://"))
        elif not is_web_link(self.url):
            # "https://", a missing slash ("https://doi.org10.1234") or a space.
            problems.append(("url", "looks incomplete. Copy it from the browser's address bar"))
        for index, other_url in enumerate(self.other_urls):
            if not (other_url.startswith("https://") or other_url.startswith("http://")):
                problems.append((f"other_urls[{index}]", "must start with https:// or http://"))
            elif not is_web_link(other_url):
                problems.append((f"other_urls[{index}]", "looks incomplete. Copy it from the browser's address bar"))

        if self.register_id is not None and re.fullmatch(r"S\d{2,}", self.register_id) is None:
            problems.append(("register_id", 'must look like "S02": a capital S and at least two digits'))

        if self.credibility == Credibility.UNCLEAR and self.credibility_unclear_reason is None:
            problems.append(("credibility_unclear_reason", 'required when credibility is "unclear"'))
        if self.credibility_unclear_reason == UnclearReason.OTHER:
            problems.append(
                (
                    "credibility_unclear_reason",
                    '"other" needs a note to explain it, and sources have no note field. '
                    f"Use the closest of: {SPECIFIC_UNCLEAR_REASONS}",
                )
            )

        for index, field_name in enumerate(self.ai_suggested_fields):
            if field_name == "summary":
                problems.append(
                    (
                        f"ai_suggested_fields[{index}]",
                        'the summary is a claim, so it carries its own label. Remove "summary" from this list '
                        'and set summary.provenance to "ai" and summary.reviewed_by instead',
                    )
                )
            elif field_name not in AI_SUGGESTABLE_SOURCE_FIELDS:
                problems.append(
                    (
                        f"ai_suggested_fields[{index}]",
                        f'"{field_name}" isn\'t a field the site can mark as AI-suggested. '
                        f"Use any of: {', '.join(AI_SUGGESTABLE_SOURCE_FIELDS)}",
                    )
                )
        if len(self.ai_suggested_fields) > 0 and is_blank(self.reviewed_by) and not self.sample:
            problems.append(
                ("reviewed_by", "required when ai_suggested_fields is not empty. Who checked the AI's values?")
            )

        problems.extend(ai_review_problems(self, self.sample))
        raise_problems(problems)
        return self


CASE_RATING_VALUES = [member.value for member in CaseRating]


def rating_problems(value: str, path: str) -> list[RuleProblem]:
    """A rating has to be on the case scale. Shared by a row's rating and the
    ratings in its history, so both get the same message."""
    if value not in CASE_RATING_VALUES:
        return [(path, f'"{value}" is not a case rating. Use one of: {", ".join(CASE_RATING_VALUES)}')]
    return []


class RatingChange(BaseModel):
    """One change to a scorecard rating. The previous assessment stays visible.

    An entry where nothing changed is allowed: a re-review after new evidence
    that leaves both values as they were is a real record too.
    """

    model_config = ConfigDict(extra="forbid")

    date: IsoDate
    # Case ratings, checked by the row so the message matches the row's own.
    rating_before: str = Field(json_schema_extra={"enum": CASE_RATING_VALUES})
    rating_after: str = Field(json_schema_extra={"enum": CASE_RATING_VALUES})
    confidence_before: Confidence
    confidence_after: Confidence
    note: Claim  # what changed and why; note.source_ids names the sources that caused it

    @model_validator(mode="after")
    def check_note(self) -> "RatingChange":
        problems: list[RuleProblem] = []
        if len(self.note.source_ids) == 0:
            problems.append(("note.source_ids", "name the source or sources that caused this change"))
        if self.note.provenance == Provenance.UNCLEAR:
            problems.append(("note.provenance", 'can\'t be "unclear". Say what changed'))
        raise_problems(problems)
        return self


class RatingTracker(BaseModel):
    """What a rating card adds to its scorecard row. Every field is optional,
    and the card says which ones aren't assessed yet."""

    model_config = ConfigDict(extra="forbid")

    # A claim with provenance "unclear" and unclear_reason "search_incomplete"
    # counts as not assessed yet (is_not_assessed below), as it does on a milestone.
    what_would_change: Claim | None = None
    last_updated: IsoDate | None = None
    history: list[RatingChange] = []  # oldest first; new changes go at the end
    # The milestones this rating informs, in the team's order. Written by the
    # team, never inferred.
    milestone_ids: list[Slug] = []
    # True while this tracker (its what_would_change, milestone_ids and
    # last_updated) is an example the team hasn't checked. It isn't `sample`:
    # a placeholder is shown, with a mark.
    placeholder: StrictBool = False


class ScorecardRow(BaseModel):
    """One headline judgment. Case rows carry a rating; risk rows never do.

    The workbook keeps a risk's severity, likelihood and confidence apart and
    never combines them into one rating (its core principle 6), so a risk row
    has severity and likelihood instead.
    """

    model_config = ConfigDict(extra="forbid")

    # Stable and the same on every page. Never changes once public: the row's
    # anchor (#scorecard-<id>) and the compare address use it.
    id: Slug
    dimension: NonEmptyStr
    problem: Problem | None
    scale: Literal["case", "risk"]
    # A CaseRating on a case row, null on a risk row. A plain string so the
    # check below can say which values to use.
    rating: str | None = Field(default=None, json_schema_extra={"enum": CASE_RATING_VALUES})
    confidence: Confidence
    unclear_reason: UnclearReason | None = None  # optional: the workbook states none
    # Risk rows only. null until the workbook gives them, or when not applicable.
    severity: Severity | None = None
    likelihood: Likelihood | None = None
    # Risk rows only: false when the workbook says the risk doesn't apply to
    # this family ("Not applicable"), as for BCI and artificial minds.
    applicable: StrictBool = True
    basis: Claim | None = None  # required on case rows; optional on risk rows
    tracker: RatingTracker | None = None

    @model_validator(mode="after")
    def check_rating(self) -> "ScorecardRow":
        problems: list[RuleProblem] = []

        if self.scale == "case":
            if self.rating is None:
                problems.append(
                    ("rating", f'required on a case row. Use one of: {", ".join(CASE_RATING_VALUES)}')
                )
            else:
                problems.extend(rating_problems(self.rating, "rating"))
            if self.basis is None:
                problems.append(("basis", "required on a case row: the reason for the rating"))
            for field_name in ("severity", "likelihood"):
                if getattr(self, field_name) is not None:
                    problems.append((field_name, 'only risk rows (scale "risk") have one'))
            if not self.applicable:
                problems.append(("applicable", 'only a risk row (scale "risk") can be not applicable'))
        else:
            if self.rating is not None:
                problems.append(
                    (
                        "rating",
                        "must be null on a risk row. The workbook keeps severity, likelihood and confidence "
                        "apart, so a risk row has severity and likelihood instead",
                    )
                )
            if self.unclear_reason is not None:
                problems.append(("unclear_reason", "must be null on a risk row, which has no rating"))
            if not self.applicable:
                for field_name in ("severity", "likelihood"):
                    if getattr(self, field_name) is not None:
                        problems.append((field_name, "must be null when applicable is false"))

        if self.unclear_reason == UnclearReason.OTHER:
            problems.append(
                (
                    "unclear_reason",
                    '"other" needs a note to explain it, and scorecard rows have no note field. '
                    f"Use the closest of: {SPECIFIC_UNCLEAR_REASONS}, and explain the rest in the basis",
                )
            )

        if self.tracker is not None:
            problems.extend(self.tracker_problems(self.tracker))

        raise_problems(problems)
        return self

    def tracker_problems(self, tracker: RatingTracker) -> list[RuleProblem]:
        """The history has to be a chain: oldest first, each change starting where
        the one before it ended, and the newest ending at the row's current values.
        A risk row has no rating, so it can't have a history."""
        problems: list[RuleProblem] = []
        history = tracker.history

        if self.scale == "risk" and len(history) > 0:
            problems.append(("tracker.history", "must be empty on a risk row, which has no rating to change"))
            history = []

        for index, change in enumerate(history):
            path = f"tracker.history[{index}]"
            problems.extend(rating_problems(change.rating_before, f"{path}.rating_before"))
            problems.extend(rating_problems(change.rating_after, f"{path}.rating_after"))
            if index == 0:
                continue

            before = history[index - 1]
            before_path = f"tracker.history[{index - 1}]"
            if change.date < before.date:
                problems.append(
                    (
                        f"{path}.date",
                        f"{change.date} is before {before_path}.date ({before.date}). "
                        "Keep the history oldest first and add new changes at the end",
                    )
                )
            if change.rating_before != before.rating_after:
                problems.append(
                    (
                        f"{path}.rating_before",
                        f'"{change.rating_before}" doesn\'t match {before_path}.rating_after '
                        f'("{before.rating_after}"). Each change starts where the one before it ended',
                    )
                )
            if change.confidence_before != before.confidence_after:
                problems.append(
                    (
                        f"{path}.confidence_before",
                        f'"{change.confidence_before}" doesn\'t match {before_path}.confidence_after '
                        f'("{before.confidence_after}"). Each change starts where the one before it ended',
                    )
                )

        if len(history) > 0:
            newest = history[-1]
            newest_path = f"tracker.history[{len(history) - 1}]"
            if newest.rating_after != self.rating:
                problems.append(
                    (
                        f"{newest_path}.rating_after",
                        f'"{newest.rating_after}", but the row\'s rating is {quoted_or_null(self.rating)}. '
                        "The newest change has to end at the current rating",
                    )
                )
            if newest.confidence_after != self.confidence:
                problems.append(
                    (
                        f"{newest_path}.confidence_after",
                        f'"{newest.confidence_after}", but the row\'s confidence is "{self.confidence}". '
                        "The newest change has to end at the current confidence",
                    )
                )
            if tracker.last_updated is None:
                problems.append(("tracker.last_updated", "required when there is a history"))
            elif tracker.last_updated < newest.date:
                problems.append(
                    ("tracker.last_updated", f"{tracker.last_updated} is before the newest change ({newest.date})")
                )
            if tracker.placeholder:
                problems.append(
                    (
                        "tracker.history",
                        "must be empty while placeholder is true. A placeholder can't record real changes",
                    )
                )

        problems.extend(repeated_problems(tracker.milestone_ids, "tracker.milestone_ids"))
        return problems


# ---------- The technology page's workbook sections (scorecard v0.4) ----------
# Written by python -m sf_shared.import_workbook from the team's workbook, word
# for word. Each section is optional, so a page can start as an outline. Codes
# (E001, S13, WBE-O-L1) stay in the text as written; source_ids and entries
# lists are parsed from the cells for links and counts.


class Scope(BaseModel):
    """The workbook's "1 Scope" row for the family. Descriptive, not rated."""

    model_config = ConfigDict(extra="forbid")

    intervention: Claim  # "Technology family definition"
    deployment_scenario: Claim  # "Deployment scenarios considered (codes -> Codebook)"
    affected_groups: Claim  # "Target population and affected groups (...)"
    time_horizon: Claim
    comparator: Claim
    problems_claimed: Claim  # "Problem(s) claimed to address", without its trailing arrow and problem
    problem: Problem  # the problem named after that arrow
    source_ids: list[str] = []  # site source ids parsed from "Source IDs / basis"
    # The "Source IDs / basis" cell word for word ("S01, S08, S24-S29"). Pages show
    # this; source_ids (ranges expanded) is only for counts and links.
    source_ids_text: NonEmptyStr | None = None


class AssessmentQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: NonEmptyStr
    answer: Claim


def assessment_reason_problems(unclear_reason: UnclearReason | None) -> list[RuleProblem]:
    """An assessment's unclear_reason is optional (the workbook states none), but never "other"."""
    if unclear_reason == UnclearReason.OTHER:
        return [("unclear_reason", f'"other" needs a note. Use the closest of: {SPECIFIC_UNCLEAR_REASONS}')]
    return []


class AlignmentScenario(BaseModel):
    """One scenario row of the workbook's "4 Alignment Judgment" tab, word for word."""

    model_config = ConfigDict(extra="forbid")

    scenario: NonEmptyStr
    problem: NonEmptyStr  # "Problem addressed"
    mechanism: NonEmptyStr | None = None  # "Mechanism, or effect on the problem"
    supporting: list[EntryId] = []  # "Supporting entries"
    contrary_or_qualifying: list[EntryId] = []  # "Contrary or qualifying entries"
    gap: NonEmptyStr | None = None  # "Main gap, or reason for rating"


class AlignmentAssessment(BaseModel):
    """The family row of "4 Alignment Judgment", plus its scenario rows."""

    model_config = ConfigDict(extra="forbid")

    problem_addressed: NonEmptyStr
    mechanism: Claim  # "Mechanism, or effect on the problem"
    questions: list[AssessmentQuestion] = []
    rating: CaseRating
    confidence: Confidence
    unclear_reason: UnclearReason | None = None
    reason: Claim  # "Main gap, or reason for rating"
    decisive_question: Claim
    scenarios: list[AlignmentScenario] = []

    @model_validator(mode="after")
    def check_assessment(self) -> "AlignmentAssessment":
        raise_problems(assessment_reason_problems(self.unclear_reason))
        return self


class AgencyRow(BaseModel):
    """One row of the workbook's "6 Agency and Ownership" tab for the family."""

    model_config = ConfigDict(extra="forbid")

    group: NonEmptyStr  # "Group or dimension"
    effect: AgencyEffect
    mechanism: NonEmptyStr | None = None
    ownership_questions: NonEmptyStr | None = None  # "Ownership questions (answered in database?)"
    entries: list[EntryId] = []  # "Evidence entries"


class IntelligenceCurseAssessment(BaseModel):
    """The family's row of "5 Intelligence Curse Judgment", plus its agency rows (tab 6)."""

    model_config = ConfigDict(extra="forbid")

    mechanism: Claim  # "Mechanism claimed"
    # The tab's four middle columns, each question being the column header word for word.
    questions: list[AssessmentQuestion] = []
    rating: CaseRating
    confidence: Confidence
    unclear_reason: UnclearReason | None = None
    reason: Claim  # "Reason for rating"
    decisive_question: Claim | None = None  # the tab has no such column
    agency: list[AgencyRow] = []
    ownership_gate: NonEmptyStr | None = None  # the tab 6 "Ownership gate" row

    @model_validator(mode="after")
    def check_assessment(self) -> "IntelligenceCurseAssessment":
        raise_problems(assessment_reason_problems(self.unclear_reason))
        return self


class ArtificialMindsStage(BaseModel):
    """One row of the workbook's "4.1 Artificial Minds" tab for the family. Every
    row is kept, empty ones too, so the list of stages is complete."""

    model_config = ConfigDict(extra="forbid")

    stage: StageCode | None = None  # "S3", from the Stage cell's leading number; null when it has none
    stage_label: NonEmptyStr  # the Stage cell word for word, e.g. "3 Whole brain emulation (one instance)"
    stage_number: Annotated[int, Strict()] | None = None
    consciousness: NonEmptyStr | None = None
    moral_status: NonEmptyStr | None = None  # "Moral status grounded in"
    identity: NonEmptyStr | None = None  # "Identity, copying and modification"
    welfare: NonEmptyStr | None = None  # "Welfare harms or benefits named"
    protections: NonEmptyStr | None = None  # "Protections proposed"
    source_ids: list[str] = []  # site source ids from "Sources"
    entries: list[EntryId] = []  # "Evidence entries"


class WelfareGovernance(BaseModel):
    """The family's row of "9 Welfare and Governance Judgment". Severity,
    likelihood and confidence per domain live on the scorecard's risk rows."""

    model_config = ConfigDict(extra="forbid")

    exposed: Claim  # "Who is exposed"
    harms: Claim  # "Main harms (risk IDs)"
    rationale: Claim


# The compare page (/compare/?dimension=<key>) uses each scorecard row's id as
# its key, next to keys of its own for artificial minds and each milestone
# category, so no row may take one of those. Keep in step with
# frontend/lib/dimensions.ts.
COMPARE_MINDS_ID = "artificial-minds"


def compare_category_id(category: MilestoneCategory) -> str:
    """A milestone category's compare key: economic_viability -> "economic-viability"."""
    return category.value.replace("_", "-")


def reserved_id_problem(row_id: str) -> str | None:
    """Why a scorecard row can't use this id, or None when it can."""
    if row_id == COMPARE_MINDS_ID:
        return f'"{row_id}" is taken by the compare page\'s artificial minds view. Pick another id'
    for category in MilestoneCategory:
        if row_id == compare_category_id(category):
            label = ENUM_INFO["MilestoneCategory"]["values"][category.value][0]
            return f'"{row_id}" is taken by the compare page\'s "{label}" milestone category. Pick another id'
    return None


def quoted_or_null(value: object) -> str:
    """A value as the JSON file writes it: "weak" in quotes, or null. validate.py uses it too."""
    if value is None:
        return "null"
    return f'"{value}"'


def is_not_assessed(claim: Claim) -> bool:
    """The claim that stands for "not assessed yet": unclear, because the search isn't finished.
    The rating card lists it in its "Not added yet" line instead of showing it."""
    return claim.provenance == Provenance.UNCLEAR and claim.unclear_reason == UnclearReason.SEARCH_INCOMPLETE


class TechnologyPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Family
    name: NonEmptyStr
    short_name: NonEmptyStr
    headline: NonEmptyStr  # *asterisks* around the one italic word or phrase
    intro: Claim
    # The outline sections, written on the site (BCI and NM: drafted by AI).
    claims_to_solve: list[Claim] = []
    mechanism: list[Claim] = []
    strongest_case: list[Claim] = []
    strongest_objections: list[Claim] = []
    scorecard: list[ScorecardRow]
    artificial_minds_questions: list[Claim] = []
    alternatives: list[Claim] = []  # the most credible alternatives and counterarguments (site text)
    # The workbook's sections (python -m sf_shared.import_workbook writes these).
    scope: Scope | None = None
    alignment_assessment: AlignmentAssessment | None = None
    intelligence_curse_assessment: IntelligenceCurseAssessment | None = None
    artificial_minds_by_stage: list[ArtificialMindsStage] = []
    welfare_governance: WelfareGovernance | None = None
    # The central tension in two or three sentences, written by the team. Only
    # shown when set; nobody else writes it.
    tension: Claim | None = None
    # True while the page has AI-drafted outline sections nobody has reviewed
    # (intro, claims_to_solve and the like). Their AI claims may skip
    # reviewed_by; validate.py counts them in a warning.
    unreviewed_ai_sections: StrictBool = False

    @model_validator(mode="after")
    def check_page_rules(self) -> "TechnologyPage":
        problems: list[RuleProblem] = []

        if self.headline.count("*") != 2:
            problems.append(
                (
                    "headline",
                    "needs exactly one *italic* word or phrase in asterisks, "
                    'like "Could brain tech *keep humans* in the loop?"',
                )
            )

        problems.extend(self.scorecard_id_problems())
        problems.extend(self.placeholder_problems())
        problems.extend(self.assessment_match_problems())
        problems.extend(ai_review_problems(self, self.unreviewed_ai_sections))
        raise_problems(problems)
        return self

    def scorecard_id_problems(self) -> list[RuleProblem]:
        """Row ids and dimension names are unique on a page, and no id is one the compare page keeps for itself."""
        problems: list[RuleProblem] = []
        first_index_of_id: dict[str, int] = {}
        first_index_of_dimension: dict[str, int] = {}
        for index, row in enumerate(self.scorecard):
            if row.id in first_index_of_id:
                earlier = first_index_of_id[row.id]
                problems.append((f"scorecard[{index}].id", f'"{row.id}" is already used by scorecard[{earlier}]'))
            else:
                first_index_of_id[row.id] = index

            if row.dimension in first_index_of_dimension:
                earlier = first_index_of_dimension[row.dimension]
                problems.append(
                    (f"scorecard[{index}].dimension", f'"{row.dimension}" is already used by scorecard[{earlier}]')
                )
            else:
                first_index_of_dimension[row.dimension] = index

            reserved = reserved_id_problem(row.id)
            if reserved is not None:
                problems.append((f"scorecard[{index}].id", reserved))
        return problems

    def placeholder_problems(self) -> list[RuleProblem]:
        """A placeholder flag has to cover at least one example field, or it marks nothing on the site."""
        problems: list[RuleProblem] = []
        for index, row in enumerate(self.scorecard):
            tracker = row.tracker
            if tracker is None or not tracker.placeholder:
                continue
            # A what_would_change that is itself "not assessed" leaves the box empty, so it doesn't count.
            has_example = (
                (tracker.what_would_change is not None and not is_not_assessed(tracker.what_would_change))
                or tracker.last_updated is not None
                or len(tracker.milestone_ids) > 0
            )
            if not has_example:
                problems.append(
                    (
                        f"scorecard[{index}].tracker.placeholder",
                        "true, but the row has nothing to mark. Add the example fields, or remove the flag",
                    )
                )
        return problems

    def assessment_match_problems(self) -> list[RuleProblem]:
        """The alignment and Intelligence Curse assessments repeat their scorecard
        row's rating, so the two copies have to agree. Skipped when the row is missing."""
        problems: list[RuleProblem] = []
        pairs: list[tuple[str, AlignmentAssessment | IntelligenceCurseAssessment | None, Problem]] = [
            ("alignment_assessment", self.alignment_assessment, Problem.ALIGNMENT),
            ("intelligence_curse_assessment", self.intelligence_curse_assessment, Problem.INTELLIGENCE_CURSE),
        ]
        for field_name, assessment, problem in pairs:
            if assessment is None:
                continue
            case_row = None
            for row in self.scorecard:
                if row.scale == "case" and row.problem == problem:
                    case_row = row
                    break
            if case_row is None:
                continue
            for key in ("rating", "confidence", "unclear_reason"):
                assessment_value = getattr(assessment, key)
                row_value = getattr(case_row, key)
                if assessment_value != row_value:
                    problems.append(
                        (
                            f"{field_name}.{key}",
                            f"{quoted_or_null(assessment_value)} doesn't match the scorecard row "
                            f'"{case_row.id}" ({quoted_or_null(row_value)}). Change both together',
                        )
                    )
        return problems


# ---------- content/scorecard.json: the workbook's shared tables ----------
# Generated by python -m sf_shared.import_workbook, never edited by hand. Text
# is the workbook's word for word (after the importer's listed glitch fixes).
# Cross-record and cross-file checks (ids exist, ids unique) live in validate.py.


class WorkbookInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: NonEmptyStr  # the Overview tab's first cell, word for word
    version: str  # e.g. "0.4": from the importer's --version, or the file name
    source_sha256: str | None = None  # of the imported .xlsx; null only in a placeholder file

    @model_validator(mode="after")
    def check_workbook(self) -> "WorkbookInfo":
        problems: list[RuleProblem] = []
        if WORKBOOK_VERSION_PATTERN.fullmatch(self.version) is None:
            problems.append(("version", 'must look like "0.4": numbers with one dot'))
        if self.source_sha256 is not None and SHA256_PATTERN.fullmatch(self.source_sha256) is None:
            problems.append(("source_sha256", "must be 64 lowercase hexadecimal characters"))
        raise_problems(problems)
        return self


class Overview(BaseModel):
    """The Overview tab's purpose, core principles and update protocol, word for word."""

    model_config = ConfigDict(extra="forbid")

    purpose: NonEmptyStr
    principles: list[NonEmptyStr] = []
    update_protocol: list[NonEmptyStr] = []


class CrossFamilyScope(BaseModel):
    """The "1 Scope" tab's Cross-family row. Named like Scope's fields."""

    model_config = ConfigDict(extra="forbid")

    intervention: NonEmptyStr  # "Technology family definition"
    deployment_scenario: NonEmptyStr | None = None  # "Deployment scenarios considered (codes -> Codebook)"
    source_ids: list[str] = []  # site source ids from "Source IDs / basis"
    source_ids_text: NonEmptyStr | None = None  # that cell word for word, as on Scope


class CodebookRow(BaseModel):
    """One Codebook row, in sheet order. Family is the sheet's own word ("WBE", "All")."""

    model_config = ConfigDict(extra="forbid")

    type: NonEmptyStr
    code: NonEmptyStr
    family: NonEmptyStr
    definition: NonEmptyStr


class Framework(BaseModel):
    """One row of the "9 Reference Frameworks" tab."""

    model_config = ConfigDict(extra="forbid")

    id: FrameworkId
    reference: NonEmptyStr
    url: NonEmptyStr
    contributes: NonEmptyStr  # "What it contributes"
    applied: NonEmptyStr  # "Applied in workbook"

    @model_validator(mode="after")
    def check_url(self) -> "Framework":
        problems: list[RuleProblem] = []
        if not (self.url.startswith("https://") or self.url.startswith("http://")) or not is_web_link(self.url):
            problems.append(("url", "must be a full web address starting with https:// or http://"))
        raise_problems(problems)
        return self


class MilestoneCategoryInfo(BaseModel):
    """One of tab 1a's category header rows: "M1 Technical capability" and its question."""

    model_config = ConfigDict(extra="forbid")

    id: MilestoneCode  # "M1"
    category: MilestoneCategory
    label: NonEmptyStr  # the header without its code, e.g. "Technical capability"
    question: NonEmptyStr  # the header's question, with its "Counts as evidence" and "Does not count" text


class MilestoneAssessment(BaseModel):
    """One family row of tab 1a. BCI M1 and NM M1 have two rows each, told apart by applies_to."""

    model_config = ConfigDict(extra="forbid")

    family: Family
    milestone: MilestoneCode  # "M1"
    category: MilestoneCategory
    applies_to: NonEmptyStr
    success_criterion: NonEmptyStr
    status: MilestoneStatus
    criterion_met: NonEmptyStr  # "Criterion met?", word for word
    evidence: NonEmptyStr  # "Evidence (entries and basis)", word for word
    # The E-ids that cell cites, for counts and filters, leaving out any marked
    # "not admissible".
    evidence_entries: list[EntryId] = []
    bottleneck: NonEmptyStr | None = None  # "Main bottleneck"
    timing: NonEmptyStr | None = None  # "Timing (dated sources only)"
    confidence: Confidence
    note: NonEmptyStr | None = None


class EntryFeed(BaseModel):
    """One headline rating or milestone row an entry feeds, parsed from the
    register's "Ratings it feeds (direction)" column."""

    model_config = ConfigDict(extra="forbid")

    family: Family
    target: FeedTarget  # "alignment", "intelligence_curse" or "M1" to "M9"
    direction: Literal["supports", "against_or_qualifies"]
    note: NonEmptyStr | None = None  # e.g. "efficiency prerequisite only"


class EvidenceEntry(BaseModel):
    """One row of the "0 Evidence Register" tab."""

    model_config = ConfigDict(extra="forbid")

    id: EntryId
    source_id: NonEmptyStr  # the site's source id, e.g. "s01"
    register_id: RegisterId  # the sheet's "Source ID", e.g. "S01"
    locator: NonEmptyStr
    claim: NonEmptyStr  # "Exact claim"
    codes: list[NonEmptyStr] = []  # "Link / milestone / risk ID", split on ";"
    family: EntryFamily
    feeds: list[EntryFeed] = []
    feeds_text: NonEmptyStr  # "Ratings it feeds (direction)", word for word
    source_type_independence: NonEmptyStr  # "Source type and independence"
    outcome: Outcome  # "Outcome addressed"
    alignment_problem: AlignmentProblemCode
    scenarios: list[ScenarioCode] = []  # "Scenario code 1" to "3", empty cells left out
    stage: StageCode
    directness: EvidenceDirectness
    role: EvidenceRole  # "Evidence role"
    basis: EvidenceBasis  # "Evidence basis"


class CausalLink(BaseModel):
    """One row of the "2 Theory of Change" tab."""

    model_config = ConfigDict(extra="forbid")

    id: LinkId
    family: Family
    scenario_code: ScenarioCode
    scenario: NonEmptyStr  # the tab's Scenario name
    step: NonEmptyStr  # "Step in causal chain", word for word
    outcome: Outcome
    claim: NonEmptyStr
    status: EvidenceStatus
    supporting: list[EntryId] = []
    contrary: list[EntryId] = []
    qualifying: list[EntryId] = []
    best_directness: EvidenceDirectness | None = None  # "Directness of best evidence"
    assumption: NonEmptyStr | None = None  # "Assumption still required"
    objection: NonEmptyStr | None = None  # "Strongest objection (and whether answered)"

    @model_validator(mode="after")
    def check_link(self) -> "CausalLink":
        problems: list[RuleProblem] = []
        match = LINK_ID_PATTERN.fullmatch(self.id)
        if match is not None:
            prefix_family = FAMILY_BY_PREFIX[match.group("prefix")]
            if self.family != prefix_family:
                problems.append(
                    ("family", f'"{self.family}" doesn\'t match the id "{self.id}", which names {prefix_family}')
                )
            if self.scenario_code != match.group("scenario"):
                problems.append(
                    ("scenario_code", f'"{self.scenario_code}" doesn\'t match the id "{self.id}"')
                )
        raise_problems(problems)
        return self


class Risk(BaseModel):
    """One row of the "7 Overall Risks" tab."""

    model_config = ConfigDict(extra="forbid")

    id: RiskId
    risk: NonEmptyStr
    families: list[Family]  # "WBE; Neuromorphic AI; BCI" -> three families, in the cell's order
    domain: RiskDomain
    category: NonEmptyStr
    exposed: NonEmptyStr  # "Who is exposed (scale)"
    severity: Severity  # "Potential severity"
    likelihood: Likelihood
    reversibility: RiskLevel
    detectability: RiskLevel
    remedies: NonEmptyStr  # "Remedies and safeguards"
    control: NonEmptyStr  # "Who controls / route to exit"
    confidence: Confidence
    entries: list[EntryId] = []  # "Evidence entries"

    @model_validator(mode="after")
    def check_families(self) -> "Risk":
        problems: list[RuleProblem] = []
        if len(self.families) == 0:
            problems.append(("families", "needs at least one family"))
        problems.extend(repeated_problems(self.families, "families"))
        raise_problems(problems)
        return self


class GovernanceItem(BaseModel):
    """One row of the "8 Governance Checklist" tab."""

    model_config = ConfigDict(extra="forbid")

    id: GovernanceId
    family: Family
    question: NonEmptyStr  # "Governance question"
    status: GovernanceStatus
    entries: list[EntryId] = []  # "Evidence entries"
    summary: NonEmptyStr | None = None


class ScorecardFile(BaseModel):
    """content/scorecard.json as a whole."""

    model_config = ConfigDict(extra="forbid")

    generated: NonEmptyStr  # says the file is written by the importer
    workbook: WorkbookInfo
    overview: Overview | None = None  # null only in a placeholder file
    codebook: list[CodebookRow] = []
    frameworks: list[Framework] = []
    milestone_categories: list[MilestoneCategoryInfo] = []
    milestone_assessments: list[MilestoneAssessment] = []
    entries: list[EvidenceEntry] = []
    links: list[CausalLink] = []
    risks: list[Risk] = []
    governance: list[GovernanceItem] = []
    scope_notes: list[NonEmptyStr] = []  # the "1 Scope" lines above its header (title, key question, time horizon bands)
    cross_family_scope: CrossFamilyScope | None = None


class PostFrontmatter(BaseModel):
    """The block between the --- lines at the top of content/posts/*.md."""

    model_config = ConfigDict(extra="forbid")

    title: NonEmptyStr
    slug: Slug
    date: IsoDate
    author: NonEmptyStr
    summary: NonEmptyStr


# Every field name in the schema. validate.py uses it to suggest a fix for a
# misspelled key ("forcasts" -> "forecasts").
ALL_MODELS: list[type[BaseModel]] = [
    Claim,
    Forecast,
    Estimate,
    DisagreementOverride,
    Milestone,
    SourceQuality,
    Source,
    RatingChange,
    RatingTracker,
    ScorecardRow,
    Scope,
    AssessmentQuestion,
    AlignmentScenario,
    AlignmentAssessment,
    AgencyRow,
    IntelligenceCurseAssessment,
    ArtificialMindsStage,
    WelfareGovernance,
    TechnologyPage,
    WorkbookInfo,
    Overview,
    CrossFamilyScope,
    CodebookRow,
    Framework,
    MilestoneCategoryInfo,
    MilestoneAssessment,
    EntryFeed,
    EvidenceEntry,
    CausalLink,
    Risk,
    GovernanceItem,
    ScorecardFile,
    PostFrontmatter,
]
