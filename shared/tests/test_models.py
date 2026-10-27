"""Per-record rules in claims.py and models.py, checked one model at a time."""

import pytest
from helpers import model_errors, sample_milestone, sample_source, team_claim, technology_page

from sf_shared.claims import Claim
from sf_shared.models import Estimate, Forecast, Milestone, PostFrontmatter, ScorecardRow, Source, TechnologyPage

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


# ---------------------------------------------------------------------------
# Source


def test_sample_sources_are_valid():
    assert model_errors(Source, sample_source()) == []


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
    "Use any of: source_type, kind, technology, problem, evidence_type, directness, independence, relevance, "
    "credibility, credibility_unclear_reason"
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
