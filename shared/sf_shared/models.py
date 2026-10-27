"""Pydantic models for everything in content/ (and, later, the API export).

These mirror frontend/lib/types.ts field for field. If you change a field here,
change it there too. A TypeScript `x: T | null` is a required key that may be
null (no default here); `x?: T | null` is an optional key (default None).

Rules that only need one record live here as validators. Rules that compare
records (ids, references, dependency cycles) live in validate.py.

Numbers and booleans are strict on purpose: "2030" in quotes would pass a
lenient check, but the site reads the raw JSON and would get a string.
"""

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
    CaseRating,
    Confidence,
    Credibility,
    Directness,
    EvidenceType,
    Independence,
    MilestoneCategory,
    MilestoneStatus,
    Problem,
    Provenance,
    Relevance,
    RiskRating,
    SourceKind,
    SourceType,
    Stage,
    Technology,
    UnclearReason,
)

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
    """The team's own range. Drawn as a solid bar, but forecasts stay visible."""

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
    main_bottleneck: Claim
    depends_on: list[str]
    source_ids: list[str]
    estimate: Estimate | None
    forecasts: list[Forecast]
    disagreement_override: DisagreementOverride | None
    disagreement_note: Claim | None
    would_move_earlier: list[Claim]
    would_move_later: list[Claim]
    artificial_minds_questions: list[Claim]
    sample: StrictBool = False  # true for the worked examples; shown with a SAMPLE tag

    @model_validator(mode="after")
    def check_milestone_rules(self) -> "Milestone":
        problems: list[RuleProblem] = []

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


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Slug
    title: NonEmptyStr
    authors: list[NonEmptyStr]
    year: PublicationYear
    url: NonEmptyStr
    doi: str | None = None
    arxiv_id: str | None = None
    venue: str | None = None
    source_type: SourceType
    kind: SourceKind
    technology: list[Technology]
    problem: Problem | None
    evidence_type: EvidenceType
    directness: Directness
    independence: Independence
    relevance: Relevance
    credibility: Credibility
    credibility_unclear_reason: UnclearReason | None = None
    summary: Claim
    ai_suggested_fields: list[str]  # source field names an AI filled in, e.g. ["evidence_type"]
    reviewed_by: str | None = None
    reviewed_on: IsoDate | None = None
    sample: StrictBool = False

    @model_validator(mode="after")
    def check_source_rules(self) -> "Source":
        problems: list[RuleProblem] = []

        if not (self.url.startswith("https://") or self.url.startswith("http://")):
            problems.append(("url", "must start with https:// or http://"))

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
RISK_RATING_VALUES = [member.value for member in RiskRating]


class ScorecardRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension: NonEmptyStr
    problem: Problem | None
    scale: Literal["case", "risk"]
    # A CaseRating when scale is "case", a RiskRating when scale is "risk".
    # Typed as a plain string so the check below can say which list to use.
    rating: str = Field(json_schema_extra={"enum": sorted(set(CASE_RATING_VALUES + RISK_RATING_VALUES))})
    confidence: Confidence
    unclear_reason: UnclearReason | None = None
    basis: Claim

    @model_validator(mode="after")
    def check_rating(self) -> "ScorecardRow":
        problems: list[RuleProblem] = []

        if self.scale == "case" and self.rating not in CASE_RATING_VALUES:
            problems.append(
                ("rating", f'"{self.rating}" is not a case rating. Use one of: {", ".join(CASE_RATING_VALUES)}')
            )
        if self.scale == "risk" and self.rating not in RISK_RATING_VALUES:
            problems.append(
                ("rating", f'"{self.rating}" is not a risk rating. Use one of: {", ".join(RISK_RATING_VALUES)}')
            )

        if self.rating == "unclear" and self.unclear_reason is None:
            problems.append(("unclear_reason", 'required when rating is "unclear"'))
        if self.unclear_reason == UnclearReason.OTHER:
            problems.append(
                (
                    "unclear_reason",
                    '"other" needs a note to explain it, and scorecard rows have no note field. '
                    f"Use the closest of: {SPECIFIC_UNCLEAR_REASONS}, and explain the rest in the basis",
                )
            )

        # Never infer Low risk from an absence of studies: it needs a source.
        if self.scale == "risk" and self.rating == RiskRating.LOW and self.basis.provenance != Provenance.SOURCE:
            problems.append(
                (
                    "basis.provenance",
                    'must be "source" for a low risk rating. Low is never assumed from a lack of studies',
                )
            )

        raise_problems(problems)
        return self


class TechnologyPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Literal["wbe", "bci", "neuromorphic"]
    name: NonEmptyStr
    short_name: NonEmptyStr
    headline: NonEmptyStr  # *asterisks* around the one italic word or phrase
    intro: Claim
    claims_to_solve: list[Claim]
    mechanism: list[Claim]
    strongest_case: list[Claim]
    strongest_objections: list[Claim]
    scorecard: list[ScorecardRow]
    artificial_minds_questions: list[Claim]
    sample: StrictBool = False

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

        problems.extend(ai_review_problems(self, self.sample))
        raise_problems(problems)
        return self


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
    Source,
    ScorecardRow,
    TechnologyPage,
    PostFrontmatter,
]
