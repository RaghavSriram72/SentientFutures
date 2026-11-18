"""Per-record rules in claims.py and models.py, checked one model at a time."""

import pytest
from helpers import model_errors, sample_milestone, sample_source, team_claim, technology_page

from sf_shared.claims import Claim, compact_dump
from sf_shared.enums import ENUM_INFO, MilestoneCategory
from sf_shared.models import (
    COMPARE_MINDS_ID,
    Estimate,
    Forecast,
    Milestone,
    PostFrontmatter,
    ScorecardRow,
    Source,
    TechnologyPage,
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
    assert len(errors) == 1
    assert errors[0].startswith("record.unclear_reason: required when provenance is unclear.")


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
        "Use the closest of: no_relevant_evidence, conflicting_evidence, underspecified_proposal, search_incomplete"
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


def scorecard_row(scale: str, rating: str, provenance: str = "team") -> dict:
    basis: dict = {"text": "Basis.", "provenance": provenance}
    if provenance == "source":
        basis["source_ids"] = ["sample-bci-trial"]
        basis["quote"] = "Sample quote."
    return {
        "id": "welfare-risk",
        "dimension": "Welfare risk",
        "problem": None,
        "scale": scale,
        "rating": rating,
        "confidence": "low",
        "basis": basis,
    }


def test_rating_must_match_its_scale():
    assert model_errors(ScorecardRow, scorecard_row("case", "high")) == [
        'record.rating: "high" is not a case rating. Use one of: strong, moderate, weak, unclear, not_claimed'
    ]
    assert model_errors(ScorecardRow, scorecard_row("risk", "strong")) == [
        'record.rating: "strong" is not a risk rating. Use one of: high, medium, low, unclear'
    ]
    assert model_errors(ScorecardRow, scorecard_row("case", "not_claimed")) == []
    assert model_errors(ScorecardRow, scorecard_row("risk", "medium")) == []


def test_unclear_rating_needs_a_reason():
    row = scorecard_row("risk", "unclear")
    assert model_errors(ScorecardRow, row) == ['record.unclear_reason: required when rating is "unclear"']
    row["unclear_reason"] = "no_relevant_evidence"
    assert model_errors(ScorecardRow, row) == []

    # "other" needs a note, and a row has nowhere to put one.
    row["unclear_reason"] = "other"
    assert model_errors(ScorecardRow, row) == [
        'record.unclear_reason: "other" needs a note to explain it, and scorecard rows have no note field. '
        "Use the closest of: no_relevant_evidence, conflicting_evidence, underspecified_proposal, "
        "search_incomplete, and explain the rest in the basis"
    ]


def test_low_risk_needs_a_sourced_basis():
    errors = model_errors(ScorecardRow, scorecard_row("risk", "low"))
    assert len(errors) == 1
    assert errors[0].startswith('record.basis.provenance: must be "source" for a low risk rating.')
    assert model_errors(ScorecardRow, scorecard_row("risk", "low", provenance="source")) == []


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
    """An Unclear row with Low confidence, carrying the given tracker."""
    row = scorecard_row(scale, "unclear")
    row["unclear_reason"] = "search_incomplete"
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


def test_history_ratings_must_be_on_the_row_scale():
    tracker = {"last_updated": "2026-11-02", "history": [change("2026-11-02", ("high", "unclear"), ("low", "low"))]}
    assert model_errors(ScorecardRow, tracked_row(tracker, "case")) == [
        'record.tracker.history[0].rating_before: "high" is not a case rating. '
        "Use one of: strong, moderate, weak, unclear, not_claimed"
    ]

    tracker = {"last_updated": "2026-11-02", "history": [change("2026-11-02", ("strong", "unclear"), ("low", "low"))]}
    assert model_errors(ScorecardRow, tracked_row(tracker, "risk")) == [
        'record.tracker.history[0].rating_before: "strong" is not a risk rating. Use one of: high, medium, low, unclear'
    ]


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
    assert page["sample"] is True
    assert model_errors(TechnologyPage, page) == []

    page["sample"] = False
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


def assessment() -> dict:
    return {
        "mechanism": team_claim("Fixture mechanism."),
        "questions": [],
        "rating": "unclear",
        "confidence": "low",
        "unclear_reason": "underspecified_proposal",
        "reason": team_claim("Fixture reason."),
        "decisive_question": team_claim("Fixture question."),
    }


def evidence_row(scorecard_ids: list[str]) -> dict:
    return {
        "claim": "Fixture claim.",
        "supporting_ids": ["S02"],
        "contrary_ids": [],
        "evidence_type": "Argument",
        "directness": "remote",
        "limitation": "Fixture limitation.",
        "independence": "Unclear",
        "provenance": "team",
        "scorecard_ids": scorecard_ids,
    }


def scored_page() -> dict:
    """A page with the two case rows the assessments repeat, plus a risk row."""
    page = technology_page("wbe")
    governance = case_row("governance-risk", "Governance risk", None)
    governance["scale"] = "risk"
    page["scorecard"] = [
        case_row("alignment-case", "Alignment case", "alignment"),
        case_row("intelligence-curse-case", "Intelligence Curse case", "intelligence_curse"),
        governance,
    ]
    page["alignment_assessment"] = assessment()
    page["intelligence_curse_assessment"] = assessment()
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
    repeat = case_row("governance-risk", "Governance risk", None)
    repeat["scale"] = "risk"
    page["scorecard"].append(repeat)
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


def test_register_links_name_a_row_on_this_page():
    page = scored_page()
    page["evidence_register"] = [evidence_row(["alignment-case"]), evidence_row(["alignment", "welfare"])]
    assert model_errors(TechnologyPage, page) == [
        'record.evidence_register[1].scorecard_ids[0]: no scorecard row with id "alignment" on this page. '
        'Did you mean "alignment-case"?',
        'record.evidence_register[1].scorecard_ids[1]: no scorecard row with id "welfare" on this page. '
        "Use one of: alignment-case, intelligence-curse-case, governance-risk",
    ]


def test_register_links_on_a_page_with_no_rows():
    page = scored_page()
    page["scorecard"] = []
    page["evidence_register"] = [evidence_row(["alignment-case"])]
    assert model_errors(TechnologyPage, page) == [
        'record.evidence_register[0].scorecard_ids[0]: no scorecard row with id "alignment-case" on this page. '
        "This page has no scorecard rows yet"
    ]


def test_a_register_row_links_each_row_once():
    page = scored_page()
    page["evidence_register"] = [evidence_row(["alignment-case", "governance-risk", "alignment-case"])]
    assert model_errors(TechnologyPage, page) == [
        'record.evidence_register[0].scorecard_ids[2]: "alignment-case" is listed twice'
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

    # A register row linking it is enough: the card shows that link inside the placeholder box.
    page["scorecard"][0]["tracker"] = {"placeholder": True}
    page["evidence_register"] = [evidence_row(["alignment-case"])]
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
