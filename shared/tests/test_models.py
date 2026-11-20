"""Per-record rules in claims.py and models.py, checked one model at a time."""

import pytest
from helpers import model_errors, sample_milestone, sample_source, team_claim, technology_page

from sf_shared.claims import Claim, compact_dump
from sf_shared.enums import ENUM_INFO, MilestoneCategory
from sf_shared.models import (
    COMPARE_MINDS_ID,
    ArtificialMindsStage,
    CausalLink,
    EvidenceEntry,
    Estimate,
    Forecast,
    Framework,
    Milestone,
    PostFrontmatter,
    Risk,
    ScorecardRow,
    Source,
    TechnologyPage,
    WorkbookInfo,
    compare_category_id,
)

# ---------------------------------------------------------------------------
# Claim


def test_team_claim_is_valid():
    assert model_errors(Claim, team_claim("Our read of the evidence.")) == []


def test_claim_text_must_not_be_blank():
    assert model_errors(Claim, {"text": "   ", "provenance": "team"}) == [
        'record.text: must not be empty (got "   ")'
    ]


def test_source_claim_needs_source_ids_and_quote():
    errors = model_errors(Claim, {"text": "Shown in a trial.", "provenance": "source"})
    assert errors == [
        "record.source_ids: needs at least one source id when provenance is source",
        "record.quote: required (provenance is source). Paste the exact words from the source.",
    ]


def test_source_claim_quote_has_a_length_limit():
    claim = {"text": "Shown in a trial.", "provenance": "source", "source_ids": ["a"], "quote": "x" * 301}
    errors = model_errors(Claim, claim)
    assert len(errors) == 1
    assert errors[0].startswith("record.quote: is 301 characters; the limit is 300.")

    claim["quote"] = "x" * 300
    assert model_errors(Claim, claim) == []


def test_unclear_claim_needs_a_reason():
    errors = model_errors(Claim, {"text": "We can't tell.", "provenance": "unclear"})
    assert errors == [
        "record.unclear_reason: required when provenance is unclear. Say why: no_relevant_evidence, "
        "conflicting_evidence, underspecified_proposal, search_incomplete, indirect_evidence_only, "
        "outcome_not_operationalized, information_inaccessible or other"
    ]


def test_unclear_reason_other_needs_a_note():
    claim = {"text": "We can't tell.", "provenance": "unclear", "unclear_reason": "other"}
    assert model_errors(Claim, claim) == ['record.unclear_note: required when unclear_reason is "other"']

    claim["unclear_note"] = "The two papers define success differently."
    assert model_errors(Claim, claim) == []


def test_unclear_note_only_goes_with_other():
    # The site only shows the note next to "other", so anywhere else it would vanish.
    message = (
        'record.unclear_note: only used when provenance is unclear and unclear_reason is "other". '
        "Remove it, or put the explanation in the text"
    )
    claim = {
        "text": "We can't tell.",
        "provenance": "unclear",
        "unclear_reason": "conflicting_evidence",
        "unclear_note": "The two papers define success differently.",
    }
    assert model_errors(Claim, claim) == [message]

    claim = {"text": "Our read.", "provenance": "team", "unclear_note": "A stray note."}
    assert model_errors(Claim, claim) == [message]


def test_unknown_provenance_is_rejected():
    errors = model_errors(Claim, {"text": "Hmm.", "provenance": "guess"})
    assert errors == ["record.provenance: Input should be 'source', 'team', 'ai' or 'unclear' (got \"guess\")"]


# ---------------------------------------------------------------------------
# Forecast shapes


def forecast(earliest: int | None, latest: int | None, never: bool) -> dict:
    return {
        "id": "f1",
        "source_id": "sample-roadmap-report",
        "forecaster": "Example Author",
        "claim": "Some time",
        "quote": "Sample quote.",
        "quote_location": None,
        "made_in": 2021,
        "earliest": earliest,
        "latest": latest,
        "never": never,
    }


@pytest.mark.parametrize(
    "earliest, latest, never",
    [
        (2045, 2045, False),  # point: "in 2045"
        (None, 2045, False),  # "by 2045"
        (2045, None, False),  # "not before 2045"
        (2040, 2060, False),  # a range
        (None, None, True),  # "never"
    ],
)
def test_valid_forecast_shapes(earliest, latest, never):
    assert model_errors(Forecast, forecast(earliest, latest, never)) == []


def test_never_forecast_cannot_have_years():
    errors = model_errors(Forecast, forecast(2045, 2050, True))
    assert errors == [
        'record.earliest: must be null when never is true (a "never" forecast has no years)',
        'record.latest: must be null when never is true (a "never" forecast has no years)',
    ]


def test_dated_forecast_needs_at_least_one_year():
    errors = model_errors(Forecast, forecast(None, None, False))
    assert errors == ["record: earliest and latest are both null. Give at least one year, or set never to true"]


def test_forecast_window_must_be_in_order():
    errors = model_errors(Forecast, forecast(2060, 2040, False))
    assert errors == ["record.latest: 2040 is before earliest (2060)"]


def test_forecast_needs_a_quote_and_plausible_made_in():
    data = forecast(2040, 2050, False)
    data["quote"] = ""
    data["made_in"] = 1921
    errors = model_errors(Forecast, data)
    assert errors == ["record.made_in: Input should be greater than or equal to 1950 (got 1921)"]

    data["made_in"] = 2021
    errors = model_errors(Forecast, data)
    assert errors == [
        "record.quote: required (every forecast needs its exact quote). Paste the exact words from the source."
    ]


def test_years_in_quotes_are_rejected():
    # The site reads the raw JSON, so "2045" in quotes would arrive as text.
    data = forecast(2040, 2050, False)
    data["latest"] = "2050"
    assert model_errors(Forecast, data) == ['record.latest: Input should be a valid integer (got "2050")']


# ---------------------------------------------------------------------------
# Estimate


def test_estimate_rules():
    estimate = {
        "earliest": 2040,
        "latest": 2030,
        "basis": team_claim("Our range."),
        "set_by": "Vilija",
        "set_on": "26/10/2026",
    }
    errors = model_errors(Estimate, estimate)
    assert errors == ['record.set_on: must be a date written YYYY-MM-DD, like 2026-10-26 (got "26/10/2026")']

    estimate["set_on"] = "2026-10-26"
    assert model_errors(Estimate, estimate) == ["record.latest: 2030 is before earliest (2040)"]

    estimate["latest"] = None  # open-ended: "not before 2040"
    assert model_errors(Estimate, estimate) == []


# ---------------------------------------------------------------------------
# Milestone


def test_sample_milestones_are_valid():
    assert model_errors(Milestone, sample_milestone()) == []


def test_confidence_required_with_an_estimate():
    milestone = sample_milestone()
    milestone["confidence"] = None
    assert model_errors(Milestone, milestone) == [
        "record.confidence: required when there is an estimate (high, medium or low)"
    ]


def test_achieved_in_needs_a_sourced_basis():
    milestone = sample_milestone()
    milestone["achieved_in"] = 2025
    assert model_errors(Milestone, milestone) == [
        "record.achieved_in_basis: required when achieved_in is set. Cite the source that shows it happened"
    ]

    milestone["achieved_in_basis"] = team_claim("We think it happened.")
    assert model_errors(Milestone, milestone) == [
        'record.achieved_in_basis.provenance: must be "source" when achieved_in is set. Saying it happened needs a quote'
    ]


def test_would_move_lists_need_an_entry():
    milestone = sample_milestone()
    milestone["would_move_earlier"] = []
    milestone["would_move_later"] = []
    errors = model_errors(Milestone, milestone)
    assert len(errors) == 2
    assert errors[0].startswith("record.would_move_earlier: needs at least one entry")
    assert errors[1].startswith("record.would_move_later: needs at least one entry")


def test_forecast_ids_unique_within_a_milestone():
    milestone = sample_milestone()
    milestone["forecasts"][1]["id"] = "f1"
    assert model_errors(Milestone, milestone) == ['record.forecasts[1].id: "f1" is already used by forecasts[0]']


def test_disagreement_override_needs_a_basis():
    milestone = sample_milestone()
    milestone["disagreement_override"] = {"flagged": True}
    assert model_errors(Milestone, milestone) == ["record.disagreement_override.basis: required"]


def test_ai_claim_needs_reviewer_unless_sample():
    milestone = sample_milestone()
    milestone["summary"] = {"text": "Suggested by a model.", "provenance": "ai"}
    assert milestone["sample"] is True
    assert model_errors(Milestone, milestone) == []

    milestone["sample"] = False
    errors = model_errors(Milestone, milestone)
    assert len(errors) == 1
    assert errors[0].startswith("record.summary.reviewed_by: required when provenance is ai.")

    milestone["summary"]["reviewed_by"] = "Vilija"
    assert model_errors(Milestone, milestone) == []


def test_ai_claim_inside_a_list_reports_its_index():
    milestone = sample_milestone()
    milestone["sample"] = False
    milestone["would_move_later"].append({"text": "Suggested by a model.", "provenance": "ai"})
    errors = model_errors(Milestone, milestone)
    assert len(errors) == 1
    assert errors[0].startswith("record.would_move_later[1].reviewed_by: required")


def test_high_level_fidelity_is_a_milestone_category():
    milestone = sample_milestone()
    milestone["category"] = "high_level_fidelity"
    assert model_errors(Milestone, milestone) == []

    milestone["category"] = "high_fidelity"
    errors = model_errors(Milestone, milestone)
    assert len(errors) == 1
    assert errors[0].startswith("record.category: Input should be 'technical_capability', 'high_level_fidelity',")


def test_the_workbooks_milestone_fields_are_optional():
    milestone = sample_milestone()
    for key in ("assessment_confidence", "applies_to", "criterion_met", "evidence_entries", "timing", "note"):
        assert key not in milestone
    assert model_errors(Milestone, milestone) == []

    milestone["assessment_confidence"] = "medium"
    milestone["applies_to"] = "All WBE uses"
    milestone["criterion_met"] = "Unclear (search incomplete)"
    milestone["evidence_entries"] = ["E037", "E043"]
    milestone["timing"] = "Not sourced"
    milestone["note"] = "Single source."
    milestone["status"] = "unclear"
    assert model_errors(Milestone, milestone) == []


def test_a_milestone_may_have_no_bottleneck():
    # The workbook leaves some bottleneck cells empty (WBE M7, M9).
    milestone = sample_milestone()
    milestone["main_bottleneck"] = None
    assert model_errors(Milestone, milestone) == []
    del milestone["main_bottleneck"]
    assert model_errors(Milestone, milestone) == ["record.main_bottleneck: required"]


def test_milestone_evidence_entries_are_entry_ids_listed_once():
    milestone = sample_milestone()
    milestone["evidence_entries"] = ["E037", "e043", "E037"]
    milestone["applies_to"] = "  "
    assert model_errors(Milestone, milestone) == [
        'record.applies_to: must not be empty (got "  ")',
        'record.evidence_entries[1]: must be an evidence entry id like "E001" (got "e043")',
    ]
    milestone["evidence_entries"] = ["E037", "E037"]
    milestone["applies_to"] = None
    assert model_errors(Milestone, milestone) == ['record.evidence_entries[1]: "E037" is listed twice']


# ---------------------------------------------------------------------------
# Source


def test_sample_sources_are_valid():
    assert model_errors(Source, sample_source()) == []


def test_source_links_must_be_complete():
    source = sample_source()
    source["url"] = "https://doi.org10.1234/abc"
    source["other_urls"] = ["https://"]
    assert model_errors(Source, source) == [
        "record.url: looks incomplete. Copy it from the browser's address bar",
        "record.other_urls[0]: looks incomplete. Copy it from the browser's address bar",
    ]


def test_unclear_credibility_needs_a_reason():
    source = sample_source()
    source["credibility"] = "unclear"
    assert model_errors(Source, source) == [
        'record.credibility_unclear_reason: required when credibility is "unclear"'
    ]


def test_unclear_credibility_cannot_be_other():
    # "other" needs a note, and sources have nowhere to put one.
    source = sample_source()
    source["credibility"] = "unclear"
    source["credibility_unclear_reason"] = "other"
    assert model_errors(Source, source) == [
        'record.credibility_unclear_reason: "other" needs a note to explain it, and sources have no note field. '
        "Use the closest of: no_relevant_evidence, conflicting_evidence, underspecified_proposal, search_incomplete, "
        "indirect_evidence_only, outcome_not_operationalized, information_inaccessible"
    ]


ALLOWED_FIELDS_MESSAGE = (
    "Use any of: source_type, kind, technology, problem, claim_directions, evidence_type, directness, independence, "
    "relevance, credibility, credibility_unclear_reason"
)


def test_ai_suggested_fields_must_be_markable_and_reviewed():
    source = sample_source()
    source["ai_suggested_fields"] = ["evidence_typ", "year", "id"]
    source["reviewed_by"] = None
    source["sample"] = False
    errors = model_errors(Source, source)
    assert errors == [
        f'record.ai_suggested_fields[0]: "evidence_typ" isn\'t a field the site can mark as AI-suggested. '
        f"{ALLOWED_FIELDS_MESSAGE}",
        f'record.ai_suggested_fields[1]: "year" isn\'t a field the site can mark as AI-suggested. '
        f"{ALLOWED_FIELDS_MESSAGE}",
        f'record.ai_suggested_fields[2]: "id" isn\'t a field the site can mark as AI-suggested. '
        f"{ALLOWED_FIELDS_MESSAGE}",
        "record.reviewed_by: required when ai_suggested_fields is not empty. Who checked the AI's values?",
    ]


def test_ai_suggested_summary_uses_the_claim_instead():
    source = sample_source()
    source["ai_suggested_fields"] = ["summary"]
    errors = model_errors(Source, source)
    assert errors == [
        "record.ai_suggested_fields[0]: the summary is a claim, so it carries its own label. "
        'Remove "summary" from this list and set summary.provenance to "ai" and summary.reviewed_by instead'
    ]


def test_the_workbooks_quality_block_and_screening_flag():
    source = sample_source()
    source["quality"] = {
        "source_type": "Wiki / reference page",
        "empirical_theoretical": "Theoretical",
        "original_secondary": "Summarizes other work",
        "peer_review": "Not peer-reviewed",
        "affiliation": "Independent",
    }
    source["screening_pending"] = True
    assert model_errors(Source, source) == []

    source["quality"]["peer_reveiw"] = "Unclear"
    source["screening_pending"] = "yes"
    assert model_errors(Source, source) == [
        "record.quality.peer_reveiw: unknown field. Did you mean \"peer_review\"?",
        'record.screening_pending: Input should be a valid boolean (got "yes")',
    ]


def test_every_markable_field_is_accepted():
    source = sample_source()
    source["ai_suggested_fields"] = [
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
    ]
    assert model_errors(Source, source) == []


# ---------------------------------------------------------------------------
# Technology pages and scorecards


def scorecard_row(scale: str, rating: str | None) -> dict:
    """A case row with a team basis, or a risk row with severity and likelihood."""
    if scale == "risk":
        return {
            "id": "welfare-risk",
            "dimension": "Welfare risk",
            "problem": None,
            "scale": "risk",
            "rating": rating,
            "confidence": "low",
            "severity": "very_high",
            "likelihood": "not_assessable",
        }
    return {
        "id": "welfare-case",
        "dimension": "Welfare case",
        "problem": None,
        "scale": scale,
        "rating": rating,
        "confidence": "low",
        "basis": {"text": "Basis.", "provenance": "team"},
    }


def test_a_case_row_needs_a_case_rating_and_a_basis():
    assert model_errors(ScorecardRow, scorecard_row("case", "high")) == [
        'record.rating: "high" is not a case rating. Use one of: strong, moderate, weak, unclear, not_claimed'
    ]
    assert model_errors(ScorecardRow, scorecard_row("case", "not_claimed")) == []

    row = scorecard_row("case", None)
    del row["basis"]
    assert model_errors(ScorecardRow, row) == [
        "record.rating: required on a case row. Use one of: strong, moderate, weak, unclear, not_claimed",
        "record.basis: required on a case row: the reason for the rating",
    ]


def test_a_risk_row_has_severity_and_likelihood_instead_of_a_rating():
    # The workbook never combines severity, likelihood and confidence (core principle 6).
    assert model_errors(ScorecardRow, scorecard_row("risk", None)) == []

    row = scorecard_row("risk", "unclear")
    row["unclear_reason"] = "search_incomplete"
    assert model_errors(ScorecardRow, row) == [
        "record.rating: must be null on a risk row. The workbook keeps severity, likelihood and confidence apart, "
        "so a risk row has severity and likelihood instead",
        "record.unclear_reason: must be null on a risk row, which has no rating",
    ]

    # Until the workbook gives them, both may be null, and the basis is optional.
    row = scorecard_row("risk", None)
    row["severity"] = None
    row["likelihood"] = None
    assert model_errors(ScorecardRow, row) == []


def test_severity_and_likelihood_use_the_workbooks_scales():
    row = scorecard_row("risk", None)
    row["severity"] = "Very high"
    row["likelihood"] = "unclear"
    errors = model_errors(ScorecardRow, row)
    assert len(errors) == 2
    assert errors[0].startswith("record.severity: Input should be 'very_high', 'high', 'medium', 'low' or 'unclear'")
    assert errors[1].startswith("record.likelihood: Input should be 'high', 'medium', 'low' or 'not_assessable'")


def test_a_risk_that_doesnt_apply_has_no_severity_or_likelihood():
    # BCI and artificial minds: "Not applicable" in the workbook.
    row = scorecard_row("risk", None)
    row["applicable"] = False
    assert model_errors(ScorecardRow, row) == [
        "record.severity: must be null when applicable is false",
        "record.likelihood: must be null when applicable is false",
    ]
    row["severity"] = None
    row["likelihood"] = None
    row["confidence"] = "medium"
    assert model_errors(ScorecardRow, row) == []


def test_case_rows_have_no_risk_fields():
    row = scorecard_row("case", "unclear")
    row["severity"] = "high"
    row["likelihood"] = "low"
    row["applicable"] = False
    assert model_errors(ScorecardRow, row) == [
        'record.severity: only risk rows (scale "risk") have one',
        'record.likelihood: only risk rows (scale "risk") have one',
        'record.applicable: only a risk row (scale "risk") can be not applicable',
    ]


def test_an_unclear_rating_needs_no_stated_reason_but_never_other():
    # The workbook states no unclear reason, so it is optional; the basis gives the reason.
    row = scorecard_row("case", "unclear")
    assert model_errors(ScorecardRow, row) == []
    row["unclear_reason"] = "indirect_evidence_only"
    assert model_errors(ScorecardRow, row) == []

    # "other" needs a note, and a row has nowhere to put one.
    row["unclear_reason"] = "other"
    assert model_errors(ScorecardRow, row) == [
        'record.unclear_reason: "other" needs a note to explain it, and scorecard rows have no note field. '
        "Use the closest of: no_relevant_evidence, conflicting_evidence, underspecified_proposal, "
        "search_incomplete, indirect_evidence_only, outcome_not_operationalized, information_inaccessible, "
        "and explain the rest in the basis"
    ]


def test_potential_severity_is_retired():
    row = scorecard_row("risk", None)
    row["potential_severity"] = "high"
    assert model_errors(ScorecardRow, row) == [
        "record.potential_severity: unknown field (check the spelling, or remove it)"
    ]


def test_technology_page_rules():
    assert model_errors(TechnologyPage, technology_page("wbe")) == []

    page = technology_page("hybrid")
    errors = model_errors(TechnologyPage, page)
    assert errors == ["record.id: Input should be 'wbe', 'bci' or 'neuromorphic' (got \"hybrid\")"]

    page = technology_page("bci")
    page["headline"] = "No italics here"
    errors = model_errors(TechnologyPage, page)
    assert len(errors) == 1
    assert errors[0].startswith("record.headline: needs exactly one *italic* word or phrase")


# ---------------------------------------------------------------------------
# Rating trackers: what a rating card adds to its row


def change(day: str, rating: tuple[str, str], confidence: tuple[str, str]) -> dict:
    """One history entry: change("2026-11-02", ("unclear", "weak"), ("low", "low"))."""
    return {
        "date": day,
        "rating_before": rating[0],
        "rating_after": rating[1],
        "confidence_before": confidence[0],
        "confidence_after": confidence[1],
        "note": {"text": "What changed, and which source caused it.", "provenance": "team", "source_ids": ["s13"]},
    }


def tracked_row(tracker: dict, scale: str = "case") -> dict:
    """An Unclear case row with Low confidence (or a risk row), carrying the given tracker."""
    row = scorecard_row(scale, "unclear" if scale == "case" else None)
    row["tracker"] = tracker
    return row


def test_a_full_tracker_is_valid():
    tracker = {
        "what_would_change": team_claim("A direct test against a non-WBE comparator."),
        "last_updated": "2026-12-03",
        "history": [
            change("2026-10-01", ("weak", "unclear"), ("medium", "low")),
            change("2026-12-03", ("unclear", "unclear"), ("low", "low")),  # nothing changed: still a record
        ],
        "milestone_ids": ["wbe-legal", "wbe-access"],
        "placeholder": False,
    }
    assert model_errors(ScorecardRow, tracked_row(tracker)) == []
    assert model_errors(ScorecardRow, tracked_row({})) == []


def test_history_ratings_must_be_case_ratings():
    tracker = {"last_updated": "2026-11-02", "history": [change("2026-11-02", ("high", "unclear"), ("low", "low"))]}
    assert model_errors(ScorecardRow, tracked_row(tracker, "case")) == [
        'record.tracker.history[0].rating_before: "high" is not a case rating. '
        "Use one of: strong, moderate, weak, unclear, not_claimed"
    ]


def test_a_risk_row_has_no_history():
    tracker = {"last_updated": "2026-11-02", "history": [change("2026-11-02", ("strong", "unclear"), ("low", "low"))]}
    assert model_errors(ScorecardRow, tracked_row(tracker, "risk")) == [
        "record.tracker.history: must be empty on a risk row, which has no rating to change"
    ]
    # A tracker without a history is fine.
    assert model_errors(ScorecardRow, tracked_row({"milestone_ids": ["wbe-legal"]}, "risk")) == []


def test_history_must_be_oldest_first():
    tracker = {
        "last_updated": "2026-11-02",
        "history": [
            change("2026-11-02", ("unclear", "unclear"), ("low", "low")),
            change("2026-10-01", ("unclear", "unclear"), ("low", "low")),
        ],
    }
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        "record.tracker.history[1].date: 2026-10-01 is before tracker.history[0].date (2026-11-02). "
        "Keep the history oldest first and add new changes at the end"
    ]


def test_each_change_starts_where_the_one_before_it_ended():
    tracker = {
        "last_updated": "2026-11-02",
        "history": [
            change("2026-10-01", ("weak", "unclear"), ("low", "low")),
            change("2026-11-02", ("weak", "unclear"), ("low", "low")),
        ],
    }
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        'record.tracker.history[1].rating_before: "weak" doesn\'t match tracker.history[0].rating_after '
        '("unclear"). Each change starts where the one before it ended'
    ]

    tracker["history"] = [
        change("2026-10-01", ("unclear", "unclear"), ("medium", "low")),
        change("2026-11-02", ("unclear", "unclear"), ("medium", "low")),
    ]
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        'record.tracker.history[1].confidence_before: "medium" doesn\'t match tracker.history[0].confidence_after '
        '("low"). Each change starts where the one before it ended'
    ]


def test_the_newest_change_ends_at_the_current_values():
    tracker = {
        "last_updated": "2026-11-02",
        "history": [
            change("2026-10-01", ("weak", "unclear"), ("low", "low")),
            change("2026-11-02", ("unclear", "moderate"), ("low", "medium")),
        ],
    }
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        'record.tracker.history[1].rating_after: "moderate", but the row\'s rating is "unclear". '
        "The newest change has to end at the current rating",
        'record.tracker.history[1].confidence_after: "medium", but the row\'s confidence is "low". '
        "The newest change has to end at the current confidence",
    ]


def test_a_history_needs_a_last_updated_date_after_it():
    tracker = {"history": [change("2026-12-03", ("weak", "unclear"), ("low", "low"))]}
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        "record.tracker.last_updated: required when there is a history"
    ]

    tracker["last_updated"] = "2026-11-01"
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        "record.tracker.last_updated: 2026-11-01 is before the newest change (2026-12-03)"
    ]


def test_a_placeholder_cant_have_a_history():
    tracker = {
        "last_updated": "2026-11-02",
        "history": [change("2026-11-02", ("weak", "unclear"), ("low", "low"))],
        "placeholder": True,
    }
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        "record.tracker.history: must be empty while placeholder is true. A placeholder can't record real changes"
    ]


def test_milestone_ids_are_slugs_listed_once():
    tracker = {"milestone_ids": ["wbe-access", "wbe-legal", "wbe-legal"]}
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        'record.tracker.milestone_ids[2]: "wbe-legal" is listed twice'
    ]

    tracker = {"milestone_ids": ["Not A Slug"]}
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        "record.tracker.milestone_ids[0]: must be lowercase letters, numbers and single hyphens, like "
        'bci-medical-approval (got "Not A Slug")'
    ]


def test_a_change_note_names_its_sources_and_says_what_changed():
    entry = change("2026-11-02", ("weak", "unclear"), ("low", "low"))
    entry["note"]["source_ids"] = []
    tracker = {"last_updated": "2026-11-02", "history": [entry]}
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        "record.tracker.history[0].note.source_ids: name the source or sources that caused this change"
    ]

    entry["note"] = {
        "text": "We can't tell what changed.",
        "provenance": "unclear",
        "unclear_reason": "search_incomplete",
        "source_ids": ["s13"],
    }
    assert model_errors(ScorecardRow, tracked_row(tracker)) == [
        'record.tracker.history[0].note.provenance: can\'t be "unclear". Say what changed'
    ]


def test_an_ai_change_note_needs_a_reviewer_on_a_real_page():
    # find_claims reaches into the history, so the usual AI review rule applies there too.
    page = technology_page("wbe")
    entry = change("2026-11-02", ("unclear", "weak"), ("low", "low"))
    entry["note"] = {"text": "Suggested by a model.", "provenance": "ai", "source_ids": ["s13"]}
    page["scorecard"][0]["tracker"] = {"last_updated": "2026-11-02", "history": [entry]}
    assert page["unreviewed_ai_sections"] is True
    assert model_errors(TechnologyPage, page) == []

    page["unreviewed_ai_sections"] = False
    errors = model_errors(TechnologyPage, page)
    assert len(errors) == 1
    assert errors[0].startswith(
        "record.scorecard[0].tracker.history[0].note.reviewed_by: required when provenance is ai."
    )


# ---------------------------------------------------------------------------
# Scorecard rules that need the whole page


def case_row(row_id: str, dimension: str, problem: str | None) -> dict:
    return {
        "id": row_id,
        "dimension": dimension,
        "problem": problem,
        "scale": "case",
        "rating": "unclear",
        "confidence": "low",
        "unclear_reason": "underspecified_proposal",
        "basis": team_claim("Fixture basis."),
    }


def risk_row(row_id: str, dimension: str) -> dict:
    return {
        "id": row_id,
        "dimension": dimension,
        "problem": None,
        "scale": "risk",
        "rating": None,
        "confidence": "low",
        "severity": "high",
        "likelihood": "not_assessable",
    }


def alignment_assessment() -> dict:
    return {
        "problem_addressed": "Oversight; value specification",
        "mechanism": team_claim("Fixture mechanism."),
        "questions": [],
        "rating": "unclear",
        "confidence": "low",
        "unclear_reason": "underspecified_proposal",
        "reason": team_claim("Fixture reason."),
        "decisive_question": team_claim("Fixture question."),
        "scenarios": [
            {
                "scenario": "WBE as AI overseer",
                "problem": "Oversight",
                "mechanism": "Human-derived overseer supervises AI",
                "supporting": [],
                "contrary_or_qualifying": ["E007", "E038"],
                "gap": "No entry addresses supervising a more capable system (WBE-O-L4).",
            }
        ],
    }


def curse_assessment() -> dict:
    return {
        "mechanism": team_claim("Fixture mechanism."),
        "questions": [{"question": "Who gains, who loses", "answer": team_claim("Fixture answer.")}],
        "rating": "unclear",
        "confidence": "low",
        "unclear_reason": "underspecified_proposal",
        "reason": team_claim("Fixture reason."),
        "decisive_question": None,
        "agency": [
            {
                "group": "Biological humans: bargaining power",
                "effect": "weakens",
                "mechanism": "Fixture mechanism.",
                "ownership_questions": None,
                "entries": ["E087"],
            }
        ],
        "ownership_gate": "0 answered, 2 partly answered.",
    }


def scored_page() -> dict:
    """A page with the two case rows the assessments repeat, plus a risk row."""
    page = technology_page("wbe")
    page["scorecard"] = [
        case_row("alignment-case", "Alignment case", "alignment"),
        case_row("intelligence-curse-case", "Intelligence Curse case", "intelligence_curse"),
        risk_row("governance-risk", "Governance risk"),
    ]
    page["alignment_assessment"] = alignment_assessment()
    page["intelligence_curse_assessment"] = curse_assessment()
    return page


def test_a_scored_page_is_valid():
    assert model_errors(TechnologyPage, scored_page()) == []


def test_a_row_needs_an_id_that_is_a_slug():
    page = scored_page()
    del page["scorecard"][0]["id"]
    assert model_errors(TechnologyPage, page) == ["record.scorecard[0].id: required"]

    page["scorecard"][0]["id"] = "Alignment case"
    assert model_errors(TechnologyPage, page) == [
        "record.scorecard[0].id: must be lowercase letters, numbers and single hyphens, like bci-medical-approval "
        '(got "Alignment case")'
    ]


def test_row_ids_and_dimensions_are_unique_on_a_page():
    page = scored_page()
    page["scorecard"].append(risk_row("governance-risk", "Governance risk"))
    assert model_errors(TechnologyPage, page) == [
        'record.scorecard[3].id: "governance-risk" is already used by scorecard[2]',
        'record.scorecard[3].dimension: "Governance risk" is already used by scorecard[2]',
    ]


def test_a_row_id_cant_be_the_compare_pages_minds_key():
    page = scored_page()
    page["scorecard"][2]["id"] = COMPARE_MINDS_ID
    assert model_errors(TechnologyPage, page) == [
        'record.scorecard[2].id: "artificial-minds" is taken by the compare page\'s artificial minds view. '
        "Pick another id"
    ]


def test_economic_viability_is_a_reserved_id():
    page = scored_page()
    page["scorecard"][2]["id"] = "economic-viability"
    assert model_errors(TechnologyPage, page) == [
        'record.scorecard[2].id: "economic-viability" is taken by the compare page\'s "Economic viability" '
        "milestone category. Pick another id"
    ]


@pytest.mark.parametrize("category", list(MilestoneCategory))
def test_no_row_id_can_be_a_milestone_category_key(category: MilestoneCategory):
    key = compare_category_id(category)
    assert key == category.value.replace("_", "-")
    page = scored_page()
    page["scorecard"][2]["id"] = key
    label = ENUM_INFO["MilestoneCategory"]["values"][category.value][0]
    assert model_errors(TechnologyPage, page) == [
        f'record.scorecard[2].id: "{key}" is taken by the compare page\'s "{label}" milestone category. Pick another id'
    ]


def test_the_v01_sections_are_gone():
    # Replaced by the workbook's tables (content/scorecard.json) and sections.
    for key in ("evidence_register", "theory_of_change", "artificial_minds_assessment", "evidence_gap", "sample"):
        page = scored_page()
        page[key] = []
        errors = model_errors(TechnologyPage, page)
        assert len(errors) == 1
        assert errors[0].startswith(f"record.{key}: ")


def test_the_workbook_sections_are_valid():
    page = scored_page()
    page["artificial_minds_by_stage"] = [
        {
            "stage": "S3",
            "stage_number": 3,
            "stage_label": "3 Whole brain emulation (one instance)",
            "consciousness": "Agnostic. S22 assumes suitably designed digital minds could be conscious.",
            "moral_status": None,
            "identity": None,
            "welfare": None,
            "protections": None,
            "source_ids": ["s22"],
            "entries": ["E086"],
        },
        {"stage": None, "stage_number": None, "stage_label": "All stages"},
    ]
    page["welfare_governance"] = {
        "exposed": team_claim("Emulated persons; scanned originals."),
        "harms": team_claim("Suffering across copies (R01-R06, R20, R21)"),
        "rationale": team_claim("Severity follows from unbounded copy numbers (S22)."),
    }
    claim = team_claim("Fixture.")
    page["scope"] = {
        "intervention": claim,
        "deployment_scenario": claim,
        "affected_groups": claim,
        "time_horizon": claim,
        "comparator": claim,
        "problems_claimed": claim,
        "problem": "both",
        "source_ids": ["s13", "s16"],
    }
    assert model_errors(TechnologyPage, page) == []


def test_an_alignment_assessment_names_the_problem_it_addresses():
    page = scored_page()
    del page["alignment_assessment"]["problem_addressed"]
    page["alignment_assessment"]["scenarios"][0]["supporting"] = ["E7"]
    assert model_errors(TechnologyPage, page) == [
        "record.alignment_assessment.problem_addressed: required",
        'record.alignment_assessment.scenarios[0].supporting[0]: must be an evidence entry id like "E001" (got "E7")',
    ]


def test_agency_effects_use_the_workbooks_values():
    page = scored_page()
    page["intelligence_curse_assessment"]["agency"][0]["effect"] = "Weakens"
    errors = model_errors(TechnologyPage, page)
    assert len(errors) == 1
    assert errors[0].startswith(
        "record.intelligence_curse_assessment.agency[0].effect: Input should be 'strengthens', 'weakens', 'mixed' "
        "or 'not_addressed'"
    )


def test_a_minds_stage_keeps_its_label_word_for_word():
    stage = {"stage": "3", "stage_number": "3", "stage_label": ""}
    assert model_errors(ArtificialMindsStage, stage) == [
        'record.stage: must be a stage like "S1", or "N/A" (got "3")',
        'record.stage_label: must not be empty (got "")',
        'record.stage_number: Input should be a valid integer (got "3")',
    ]


def test_a_placeholder_has_to_mark_something():
    page = scored_page()
    page["scorecard"][0]["tracker"] = {"placeholder": True}
    assert model_errors(TechnologyPage, page) == [
        "record.scorecard[0].tracker.placeholder: true, but the row has nothing to mark. "
        "Add the example fields, or remove the flag"
    ]

    # A what_would_change that is itself "not assessed" isn't shown in the box, so it marks nothing either.
    page["scorecard"][0]["tracker"]["what_would_change"] = {
        "text": "Not assessed yet.",
        "provenance": "unclear",
        "unclear_reason": "search_incomplete",
    }
    assert model_errors(TechnologyPage, page) == [
        "record.scorecard[0].tracker.placeholder: true, but the row has nothing to mark. "
        "Add the example fields, or remove the flag"
    ]

    # Any other unclear reason is an assessment, so it counts.
    page["scorecard"][0]["tracker"]["what_would_change"]["unclear_reason"] = "conflicting_evidence"
    assert model_errors(TechnologyPage, page) == []


@pytest.mark.parametrize(
    "field_name, row_id",
    [("alignment_assessment", "alignment-case"), ("intelligence_curse_assessment", "intelligence-curse-case")],
)
def test_an_assessment_matches_its_scorecard_row(field_name: str, row_id: str):
    page = scored_page()
    page[field_name]["rating"] = "weak"
    page[field_name]["confidence"] = "medium"
    page[field_name]["unclear_reason"] = "no_relevant_evidence"
    assert model_errors(TechnologyPage, page) == [
        f'record.{field_name}.rating: "weak" doesn\'t match the scorecard row "{row_id}" ("unclear"). '
        "Change both together",
        f'record.{field_name}.confidence: "medium" doesn\'t match the scorecard row "{row_id}" ("low"). '
        "Change both together",
        f'record.{field_name}.unclear_reason: "no_relevant_evidence" doesn\'t match the scorecard row "{row_id}" '
        '("underspecified_proposal"). Change both together',
    ]

    # Without the row there is nothing to match.
    remaining = []
    for row in page["scorecard"]:
        if row["id"] != row_id:
            remaining.append(row)
    page["scorecard"] = remaining
    assert model_errors(TechnologyPage, page) == []


# ---------------------------------------------------------------------------
# The workbook's tables (content/scorecard.json), one record at a time


def entry() -> dict:
    return {
        "id": "E014",
        "source_id": "s05",
        "register_id": "S05",
        "locator": "Limits of FLOP-centric regulation; Fig. 1",
        "claim": "NorthPole delivers ~72.7x more tokens/s/W than an H100.",
        "codes": ["NM-M6", "NM-E-L1"],
        "family": "neuromorphic",
        "feeds": [
            {"family": "neuromorphic", "target": "intelligence_curse", "direction": "supports",
             "note": "efficiency prerequisite only"},
            {"family": "neuromorphic", "target": "M6", "direction": "supports", "note": None},
        ],
        "feeds_text": "Neuromorphic AI Intelligence Curse (supports, efficiency prerequisite only); "
        "Neuromorphic AI M6 Economic viability (supports)",
        "source_type_independence": "Preprint; Independent",
        "outcome": "Intelligence Curse",
        "alignment_problem": "N/A",
        "scenarios": ["NM-H", "NM-E"],
        "stage": "S1",
        "directness": "direct",
        "role": "supports",
        "basis": "demonstrated",
    }


def test_an_evidence_entry_is_valid():
    assert model_errors(EvidenceEntry, entry()) == []
    cross = entry()
    cross["family"] = "cross_family"
    cross["feeds"] = []
    cross["feeds_text"] = "Not used in a headline rating"
    cross["stage"] = "N/A"
    cross["alignment_problem"] = "A-X"
    assert model_errors(EvidenceEntry, cross) == []


def test_an_evidence_entry_uses_the_workbooks_codes():
    data = entry()
    data["id"] = "E14"
    data["register_id"] = "S5"
    data["family"] = "Neuromorphic AI"
    data["outcome"] = "Alignment"
    data["scenarios"] = ["NM-H", "*-C"]
    data["role"] = "Supports"
    errors = model_errors(EvidenceEntry, data)
    assert errors[0] == 'record.id: must be an evidence entry id like "E001" (got "E14")'
    assert errors[1] == 'record.register_id: must look like "S02": a capital S and at least two digits (got "S5")'
    assert errors[2].startswith("record.family: Input should be 'wbe', 'bci', 'neuromorphic' or 'cross_family'")
    assert errors[3].startswith("record.outcome: Input should be 'AI Alignment', 'Intelligence Curse', 'Both'")
    assert errors[4] == 'record.scenarios[1]: must be a scenario code like "WBE-O", "BCI-D" or "NM-A" (got "*-C")'
    assert errors[5].startswith("record.role: Input should be 'supports', 'contrary', 'qualifies'")


def link() -> dict:
    return {
        "id": "WBE-O-L1",
        "family": "wbe",
        "scenario_code": "WBE-O",
        "scenario": "WBE as AI overseer",
        "step": "1 Capability",
        "outcome": "AI Alignment",
        "claim": "Prerequisite: a single whole human emulation can be built and run.",
        "status": "contrary",
        "supporting": [],
        "contrary": ["E037"],
        "qualifying": ["E043", "E065"],
        "best_directness": "direct",
        "assumption": "Scanning, functional modelling and compute prerequisites all met.",
        "objection": None,
    }


def test_a_causal_link_names_its_family_in_its_id():
    assert model_errors(CausalLink, link()) == []
    data = link()
    data["id"] = "WBE-O-1"
    assert model_errors(CausalLink, data) == ['record.id: must be a causal link id like "WBE-O-L1" (got "WBE-O-1")']
    data = link()
    data["family"] = "neuromorphic"
    assert model_errors(CausalLink, data) == [
        'record.family: "neuromorphic" doesn\'t match the id "WBE-O-L1", which names wbe'
    ]


def test_a_risk_names_at_least_one_family_once():
    data = {
        "id": "R05",
        "risk": "Neuroscience and WBE research speed up AI capabilities more than safety",
        "families": ["wbe", "neuromorphic", "bci"],
        "domain": "governance",
        "category": "Misuse and dual use (capability acceleration)",
        "exposed": "Everyone (population-wide)",
        "severity": "very_high",
        "likelihood": "not_assessable",
        "reversibility": "low",
        "detectability": "low",
        "remedies": "Controls on access (not specified)",
        "control": "Research groups",
        "confidence": "low",
        "entries": ["E040", "E068"],
    }
    assert model_errors(Risk, data) == []
    data["families"] = []
    assert model_errors(Risk, data) == ["record.families: needs at least one family"]
    data["families"] = ["wbe", "wbe"]
    assert model_errors(Risk, data) == ['record.families[1]: "wbe" is listed twice']


def test_the_workbook_version_and_checksum():
    info = {"title": "Neuroengineering proposal scorecard framework", "version": "0.4", "source_sha256": None}
    assert model_errors(WorkbookInfo, info) == []
    info["version"] = "v0.4"
    info["source_sha256"] = "ABC"
    assert model_errors(WorkbookInfo, info) == [
        'record.version: must look like "0.4": numbers with one dot',
        "record.source_sha256: must be 64 lowercase hexadecimal characters",
    ]
    info["version"] = "0.5"
    info["source_sha256"] = "0" * 64
    assert model_errors(WorkbookInfo, info) == []


def test_a_framework_links_to_a_full_web_address():
    framework = {
        "id": "RF2",
        "reference": "NIST, AI Risk Management Framework (AI RMF 1.0)",
        "url": "https://www.nist.gov/itl/ai-risk-management-framework",
        "contributes": "Govern / Map / Measure / Manage functions.",
        "applied": "Not used.",
    }
    assert model_errors(Framework, framework) == []
    framework["url"] = "www.nist.gov"
    assert model_errors(Framework, framework) == [
        "record.url: must be a full web address starting with https:// or http://"
    ]


# ---------------------------------------------------------------------------
# Posts


def test_post_frontmatter():
    post = {
        "title": "About this blog",
        "slug": "about-this-blog",
        "date": "2026-10-26",
        "author": "Raghav",
        "summary": "What we'll write about.",
    }
    assert model_errors(PostFrontmatter, post) == []

    post["slug"] = "About This Blog"
    post["date"] = "2026-02-30"
    assert model_errors(PostFrontmatter, post) == [
        "record.slug: must be lowercase letters, numbers and single hyphens, like bci-medical-approval "
        '(got "About This Blog")',
        'record.date: is not a real calendar date (got "2026-02-30")',
    ]


def test_compact_dump_leaves_out_empty_claim_keys():
    claim = Claim(text="Ours.", provenance="team")
    assert compact_dump(claim) == {"text": "Ours.", "provenance": "team"}
    sourced = Claim(text="Theirs.", provenance="source", source_ids=["s13"], quote="Exact words.")
    assert compact_dump([sourced]) == [
        {"text": "Theirs.", "provenance": "source", "source_ids": ["s13"], "quote": "Exact words."}
    ]
