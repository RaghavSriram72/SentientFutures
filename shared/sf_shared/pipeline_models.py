"""The documents the source-finding pipeline and the admin API share.

These live in MongoDB (see docs/pipeline-architecture.md):

    sources          candidates from the pipeline and approved sources, one doc per paper
    ai_assessments   one doc per AI triage call. Insert-only: never edited.
    reviews          one doc per human decision. Insert-only: never edited.
    pipeline_runs    one doc per run, with counts, tokens, cost and errors
    search_config    one doc ("default"): search terms and limits, edited from admin
    users            the allowlist of team members who can sign in
    revoked_tokens   sign-in tokens ended by signing out, kept until they expire

The milestone and blog post editors keep their own collections; their
documents are in editor_models.py.

The public site never reads these directly. Approved sources reach it through
the publish step (shared/sf_shared/export_site.py), in the public Source shape
from models.py.
"""

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from sf_shared.claims import MAX_QUOTE_LENGTH
from sf_shared.enums import (
    ClaimDirection,
    Confidence,
    Credibility,
    Directness,
    EvidenceType,
    Independence,
    Problem,
    Relevance,
    SourceKind,
    SourceType,
    Technology,
    UnclearReason,
)


class ReviewStatus(StrEnum):
    """Each pipeline run moves a candidate one step along this path.

    new -> triaged_out              (the AI said not relevant)
    new -> pending_review           (relevant, unsure, a spot check, a quote mismatch, or the AI call failed)
    pending_review -> approved      (a person approved it)
    pending_review -> rejected      (a person rejected it)

    People can also decide on a paper the AI hasn't triaged yet (new) or one it
    dropped (triaged_out), and can change an earlier decision by naming the
    review it replaces. Every decision is a new review; none is ever edited.
    """

    NEW = "new"
    TRIAGED_OUT = "triaged_out"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class Relevant(StrEnum):
    YES = "yes"
    NO = "no"
    UNSURE = "unsure"  # routed to a person, because a missed paper costs more than an extra one


CandidateFlag = Literal[
    "ai_failed",  # the model refused, timed out or returned something unusable
    "spot_check",  # the AI said no, but it was sampled for a human to check anyway
    "quote_mismatch",  # the AI said no, but its quote for that isn't in the paper, so a human checks it
    "no_abstract",  # no abstract was found, so it's triaged (and reviewed) on the title alone
    "possible_duplicate",  # the title matches another source closely
]

Collector = Literal["arxiv", "semantic_scholar", "manual"]


class Candidate(BaseModel):
    """A document in the sources collection that came from the pipeline (or was added by hand)."""

    model_config = ConfigDict(extra="forbid")

    id: str  # e.g. "arxiv-2411.18526" or "s2-<paperId>"
    origin: Literal["pipeline", "manual"]
    collector: Collector
    title: str
    authors: list[str]
    year: int | None
    url: str
    doi: str | None = None
    arxiv_id: str | None = None
    s2_id: str | None = None
    venue: str | None = None
    source_type: SourceType | None = None
    # Kept only while the candidate is new or pending. Cleared after a decision,
    # because journal abstracts are copyrighted.
    abstract: str | None = None
    title_key: str  # normalized title, used to spot duplicates
    review_status: ReviewStatus
    flags: list[CandidateFlag] = []
    query_labels: list[str] = []  # which searches found it
    found_at: datetime
    updated_at: datetime
    current_assessment_id: str | None = None
    current_review_id: str | None = None
    # Only for sources added by hand (origin "manual"): who added it, and
    # their note for the reviewer. The email never leaves the API.
    added_by: str | None = None
    added_by_name: str | None = None
    note: str | None = None


class FieldEvidence(BaseModel):
    """Why the AI chose a value, with an exact quote from the title or abstract."""

    model_config = ConfigDict(extra="forbid")

    field: Literal["relevant", "kind", "technology", "problem", "claim_directions"]
    reason: str = Field(description="One or two plain sentences.")
    # The length cap is only in the description, so the model sees it. The
    # pipeline enforces it (sf_pipeline.triage.CheckedTriageResult); a
    # max_length here would also reject assessments already stored.
    quote: str = Field(
        description=(
            "An exact, unaltered excerpt from the title or abstract that supports the choice, "
            f"at most {MAX_QUOTE_LENGTH} characters."
        )
    )


class TriageResult(BaseModel):
    """What the triage model must return. Validated before anything is stored.

    No numeric scores: every field is a named category.
    """

    model_config = ConfigDict(extra="forbid")

    relevant: Relevant
    kind: SourceKind | None
    technology: list[Technology]
    problem: Problem | None
    claim_directions: list[ClaimDirection]
    milestone_ids: list[str] = Field(description="Ids of existing milestones this paper is evidence for. Empty if none.")
    evidence: list[FieldEvidence]


class TokenUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


class AiAssessment(BaseModel):
    """One triage call, stored exactly as it happened. Insert-only."""

    model_config = ConfigDict(extra="forbid")

    id: str
    source_id: str
    run_id: str | None
    model: str
    effort: str
    prompt_version: str  # "triage_v1-" + 8 characters of the sha256 of the system prompt (milestones filled in) and output schema
    rubric_version: str
    created_at: datetime
    stop_reason: str | None
    refusal_category: str | None = None
    raw_output: str  # the model's text, kept for the audit trail
    parsed: TriageResult | None  # None when the output didn't validate
    quote_checks: dict[str, bool] = {}  # field name -> did its quote appear in the title or abstract
    error: str | None = None
    usage: TokenUsage
    cost_usd: float


class ReviewFinal(BaseModel):
    """The values a person settled on. These become the public source."""

    model_config = ConfigDict(extra="forbid")

    kind: SourceKind | None = None
    technology: list[Technology] = []
    problem: Problem | None = None
    claim_directions: list[ClaimDirection] = []
    summary: str | None = None  # required to approve: public summaries are always written by the team
    source_type: SourceType | None = None
    # The rubric is optional at review time; null means "not rated yet".
    evidence_type: EvidenceType | None = None
    directness: Directness | None = None
    independence: Independence | None = None
    relevance: Relevance | None = None
    credibility: Credibility | None = None
    # Required when credibility is "unclear", because the public source shows
    # the reason next to it. "other" isn't allowed: sources have no note field.
    credibility_unclear_reason: UnclearReason | None = None
    # Approving needs at least one technology, or this set to true for a
    # source that is background for the whole project (the Intelligence Curse
    # essay, say). Such a source goes public with an empty technology list.
    general_background: bool = False


RejectReason = Literal["not_relevant", "duplicate", "out_of_scope", "low_quality", "other"]


class Review(BaseModel):
    """One human decision. Insert-only, so the AI's original assessment and the
    person's final version always sit side by side."""

    model_config = ConfigDict(extra="forbid")

    id: str
    source_id: str
    assessment_id: str | None  # None for sources added by hand
    reviewer: str  # email (never exported)
    reviewer_name: str  # display name (what the public site shows)
    decision: Literal["approve", "reject"]
    reject_reason: RejectReason | None = None
    final: ReviewFinal
    compared_fields: list[str]  # fields where an AI value existed to compare against
    changed_fields: list[str]  # of those, where the person chose something different
    ai_values_used: list[str]  # where the person kept the AI's value (shown as AI-suggested in public)
    notes: str = ""
    prompt_version: str | None
    rubric_version: str
    created_at: datetime


class StageCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fetched: int = 0
    new: int = 0
    duplicates: int = 0
    triaged: int = 0
    relevant: int = 0
    unsure: int = 0
    triaged_out: int = 0
    spot_checks: int = 0
    quote_mismatches: int = 0  # the AI said no with a quote that isn't in the paper, so a person checks it
    failed: int = 0
    skipped: int = 0  # e.g. triage skipped because no API key or the cost cap was hit


class PipelineRun(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    trigger: Literal["schedule", "admin", "cli"]
    runner: Literal["local", "github"]
    requested_by: str | None = None
    status: Literal["queued", "running", "succeeded", "failed", "partial"]
    stages: list[Literal["collect", "triage"]]
    options: dict = {}  # limit, dry_run, lookback_days
    started_at: datetime
    finished_at: datetime | None = None
    heartbeat_at: datetime | None = None  # updated while running, so a crashed run can be detected
    counts: StageCounts = StageCounts()
    usage: TokenUsage = TokenUsage()
    cost_usd: float = 0.0
    log: list[str] = []  # short human-readable lines, newest last
    errors: list[str] = []


class SearchQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str  # shown in admin and stored on candidates, e.g. "BCI and alignment"
    text: str  # the search terms
    collectors: list[Literal["arxiv", "semantic_scholar"]] = ["arxiv", "semantic_scholar"]
    enabled: bool = True


class SearchConfig(BaseModel):
    """Everything about a run that the team can tune from the admin page."""

    model_config = ConfigDict(extra="forbid")

    id: Literal["default"] = "default"
    queries: list[SearchQuery]
    lookback_days: int = Field(default=14, ge=1, le=365)
    max_items_per_run: int = Field(default=600, ge=1, le=5000)
    max_cost_usd_per_run: float = Field(default=3.0, gt=0, le=50)
    spot_check_rate: float = Field(default=0.03, ge=0, le=1)
    model: str = "claude-haiku-5-5"
    effort: Literal["low", "medium", "high"] = "low"
    updated_by: str | None = None
    updated_at: datetime | None = None


class User(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str  # lowercased email
    display_name: str
    role: Literal["admin"] = "admin"
    active: bool = True


# The default searches, used to seed search_config the first time.
DEFAULT_QUERIES = [
    SearchQuery(label="Brain computer interfaces and alignment", text='"brain-computer interface" AND (alignment OR "AI safety")'),
    SearchQuery(label="Whole brain emulation", text='"whole brain emulation" OR "brain emulation" OR "mind uploading"'),
    # Bare "safety" and "governance" pulled in materials and robotics papers
    # (safe device operation, say), so this search asks for the AI senses and
    # leaves out device-physics papers.
    SearchQuery(label="Neuromorphic AI and safety", text='neuromorphic AND ("AI safety" OR alignment OR "AI governance") NOT ferroelectric NOT supercapacitor'),
    SearchQuery(label="NeuroAI for AI safety", text='NeuroAI AND ("AI safety" OR alignment)'),
    SearchQuery(label="Neural feedback for reinforcement learning", text='("neural feedback" OR EEG OR fNIRS) AND "reinforcement learning" AND (alignment OR "human feedback")'),
    SearchQuery(label="Neurotechnology and human agency", text='neurotechnology AND (agency OR "mental privacy" OR disempowerment)'),
]

__all__ = [
    "AiAssessment",
    "Candidate",
    "CandidateFlag",
    "Collector",
    "Confidence",
    "DEFAULT_QUERIES",
    "FieldEvidence",
    "PipelineRun",
    "RejectReason",
    "Relevant",
    "Review",
    "ReviewFinal",
    "ReviewStatus",
    "SearchConfig",
    "SearchQuery",
    "StageCounts",
    "TokenUsage",
    "TriageResult",
    "User",
]
