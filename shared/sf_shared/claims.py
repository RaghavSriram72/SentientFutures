"""The Claim type, plus the small helpers every model uses to report problems.

Every sentence shown on the site is a Claim, so its provenance travels with it:
  source  -> needs source_ids and an exact quote (max 300 characters)
  team    -> the team's own interpretation
  ai      -> AI-suggested; needs reviewed_by. Claim alone can't enforce this,
             because records with sample: true are allowed to skip it. The
             record models (Milestone, Source, TechnologyPage) check it instead,
             using ai_review_problems() below.
  unclear -> genuinely uncertain; needs unclear_reason (and unclear_note when
             the reason is "other")

Mirrors `Claim` in frontend/lib/types.ts. Change both together.
"""

from enum import Enum
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from sf_shared.enums import Provenance, UnclearReason

MAX_QUOTE_LENGTH = 300

# A model validator can only raise one error, but a record can break several
# rules at once. So each validator collects (path, message) pairs and raises
# them together under this error type. validate.py prints one line per pair.
RULES_ERROR_TYPE = "content_rules"

# (path relative to the model that found it, message). An empty path means
# the model itself, e.g. ("", "needs earliest, latest or both").
RuleProblem = tuple[str, str]


def join_path(base: str, child: str) -> str:
    """Join two path pieces: join_path("forecasts", "[0]") -> "forecasts[0]"."""
    if base == "":
        return child
    if child == "":
        return base
    if child.startswith("["):
        return base + child
    return base + "." + child


def is_blank(value: str | None) -> bool:
    return value is None or value.strip() == ""


def raise_problems(problems: list[RuleProblem]) -> None:
    """Raise one validation error carrying every problem, or do nothing if there are none."""
    if len(problems) == 0:
        return
    parts = []
    for path, message in problems:
        if path == "":
            parts.append(message)
        else:
            parts.append(f"{path}: {message}")
    raise PydanticCustomError(
        RULES_ERROR_TYPE,
        "{summary}",
        {"summary": "; ".join(parts), "problems": problems},
    )


def _check_not_blank(value: str) -> str:
    if value.strip() == "":
        raise PydanticCustomError("empty_text", "must not be empty")
    return value


# A string that must contain something other than spaces.
NonEmptyStr = Annotated[str, AfterValidator(_check_not_blank)]


def quote_problems(quote: str | None, path: str, why_required: str) -> list[RuleProblem]:
    """An exact quote must exist and stay short enough to be fair use."""
    if quote is None or quote.strip() == "":
        return [(path, f"required ({why_required}). Paste the exact words from the source.")]
    if len(quote) > MAX_QUOTE_LENGTH:
        return [
            (
                path,
                f"is {len(quote)} characters; the limit is {MAX_QUOTE_LENGTH}. "
                "Quote the shortest passage that supports the claim.",
            )
        ]
    return []


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: NonEmptyStr
    provenance: Provenance
    source_ids: list[str] = Field(default_factory=list)
    quote: str | None = None
    quote_location: str | None = None
    unclear_reason: UnclearReason | None = None
    unclear_note: str | None = None
    reviewed_by: str | None = None

    @model_validator(mode="after")
    def check_provenance_rules(self) -> "Claim":
        problems: list[RuleProblem] = []

        if self.provenance == Provenance.SOURCE:
            if len(self.source_ids) == 0:
                problems.append(
                    ("source_ids", "needs at least one source id when provenance is source")
                )
            problems.extend(quote_problems(self.quote, "quote", "provenance is source"))

        if self.provenance == Provenance.UNCLEAR:
            if self.unclear_reason is None:
                problems.append(
                    (
                        "unclear_reason",
                        "required when provenance is unclear. Say why: no_relevant_evidence, "
                        "conflicting_evidence, underspecified_proposal, search_incomplete or other",
                    )
                )
            elif self.unclear_reason == UnclearReason.OTHER and is_blank(self.unclear_note):
                problems.append(("unclear_note", 'required when unclear_reason is "other"'))

        # The site only shows the note next to an "other" reason, so a note
        # anywhere else would be dropped without a word.
        note_is_shown = self.provenance == Provenance.UNCLEAR and self.unclear_reason == UnclearReason.OTHER
        if not is_blank(self.unclear_note) and not note_is_shown:
            problems.append(
                (
                    "unclear_note",
                    'only used when provenance is unclear and unclear_reason is "other". '
                    "Remove it, or put the explanation in the text",
                )
            )

        raise_problems(problems)
        return self


def find_claims(value: object, path: str = "") -> list[tuple[str, Claim]]:
    """Every Claim inside a model, list or Claim, each with its path.

    For a milestone this returns pairs like ("summary", claim) and
    ("would_move_later[1]", claim).
    """
    found: list[tuple[str, Claim]] = []
    if isinstance(value, Claim):
        found.append((path, value))
    elif isinstance(value, BaseModel):
        for field_name in type(value).model_fields:
            child = getattr(value, field_name)
            found.extend(find_claims(child, join_path(path, field_name)))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(find_claims(item, join_path(path, f"[{index}]")))
    return found


def compact_dump(value: object) -> object:
    """A model as plain JSON values, with each Claim's empty optional keys left out.

    That's how content/milestones.json is written by hand ({"text": ..., "provenance": "team"}),
    so a milestone exported from the database reads like one from the file.
    """
    if isinstance(value, Claim):
        return value.model_dump(mode="json", exclude_defaults=True)
    if isinstance(value, BaseModel):
        result = {}
        for field_name in type(value).model_fields:
            result[field_name] = compact_dump(getattr(value, field_name))
        return result
    if isinstance(value, list):
        items = []
        for item in value:
            items.append(compact_dump(item))
        return items
    if isinstance(value, Enum):
        return value.value
    return value


def ai_review_problems(record: BaseModel, is_sample: bool) -> list[RuleProblem]:
    """AI-suggested claims need a named human reviewer before they go public.

    Sample records (sample: true) are exempt: the fictional worked examples and
    the AI-drafted outlines on the technology pages. The public site leaves
    sample milestones and sources out, and puts an "AI draft" banner on a draft
    technology page. validate.py prints a warning with the count, so these
    claims can't be forgotten when the sample flag comes off.
    """
    if is_sample:
        return []
    problems: list[RuleProblem] = []
    for path, claim in find_claims(record):
        if claim.provenance == Provenance.AI and is_blank(claim.reviewed_by):
            problems.append(
                (
                    join_path(path, "reviewed_by"),
                    "required when provenance is ai. A person has to check an AI suggestion "
                    "before it goes public (only records with sample: true may skip this)",
                )
            )
    return problems
