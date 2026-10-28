"""The public export: approved sources only, in the public Source shape, with nothing private."""

from api_helpers import REVIEWER_EMAIL, REVIEWER_NAME, approve_body, insert_assessment, insert_candidate

from sf_api.publish import public_id
from sf_shared.models import Source


def approve(client, headers, candidate_id: str, **overrides) -> dict:
    response = client.post(f"/api/queue/{candidate_id}/review", json=approve_body(**overrides), headers=headers)
    assert response.status_code == 201, response.get_json()
    return response.get_json()["review"]


def test_public_sources_are_valid_and_private_data_stays_out(client, db, headers):
    insert_candidate(db, "arxiv-2411.18526", doi="10.1234/example", venue="arXiv")
    insert_assessment(db, "arxiv-2411.18526")
    approve(client, headers, "arxiv-2411.18526", ai_values_used=["kind", "technology", "problem"], notes="Private note.")

    insert_candidate(db, "arxiv-pending")
    insert_candidate(db, "arxiv-rejected")
    client.post("/api/queue/arxiv-rejected/review", json={"decision": "reject", "reject_reason": "duplicate"}, headers=headers)

    # No token: the publish step reads this without signing in.
    response = client.get("/api/public/sources")

    assert response.status_code == 200
    body = response.get_json()
    assert body["skipped"] == []
    assert len(body["sources"]) == 1
    source = body["sources"][0]
    Source.model_validate(source)
    assert source["id"] == "arxiv-2411-18526"
    assert source["summary"] == {
        "text": "The authors argue that BCIs could give people a say in what AI systems learn.",
        "provenance": "team",
        "source_ids": [],
        "quote": None,
        "quote_location": None,
        "unclear_reason": None,
        "unclear_note": None,
        "reviewed_by": None,
    }
    assert source["ai_suggested_fields"] == ["kind", "technology", "problem"]
    assert source["reviewed_by"] == REVIEWER_NAME
    assert source["added_by"] == REVIEWER_NAME
    assert source["kind"] == "argument"
    assert source["technology"] == ["bci"]
    assert source["claim_directions"] == ["ai_alignment"]
    assert source["source_type"] == "preprint"
    assert source["doi"] == "10.1234/example"
    assert source["evidence_type"] is None

    text = response.get_data(as_text=True)
    assert REVIEWER_EMAIL not in text
    assert "@" not in text
    assert "We argue that" not in text  # the abstract
    assert "Private note." not in text
    assert "abstract" not in text


def test_rubric_ratings_and_source_type_come_from_the_review(client, db, headers):
    insert_candidate(db, "s2-abc", collector="semantic_scholar", source_type=None)
    body = approve_body()
    body["final"].update({"source_type": "peer_reviewed", "evidence_type": "experiment", "directness": "adjacent", "credibility": "adequate"})
    response = client.post("/api/queue/s2-abc/review", json=body, headers=headers)
    assert response.status_code == 201

    source = client.get("/api/public/sources").get_json()["sources"][0]

    assert source["source_type"] == "peer_reviewed"
    assert source["evidence_type"] == "experiment"
    assert source["directness"] == "adjacent"
    assert source["credibility"] == "adequate"
    assert source["relevance"] is None


def test_kept_ai_claim_directions_are_published_as_ai_suggested(client, db, headers):
    insert_candidate(db, "arxiv-1")
    insert_assessment(db, "arxiv-1")  # the AI said ai_alignment, as approve_body does
    approve(client, headers, "arxiv-1", ai_values_used=["claim_directions"])

    body = client.get("/api/public/sources").get_json()

    assert body["skipped"] == []
    assert body["sources"][0]["ai_suggested_fields"] == ["claim_directions"]


def test_a_source_that_doesnt_validate_is_skipped_with_its_problems(client, db, headers):
    insert_candidate(db, "arxiv-no-year", year=None)
    approve(client, headers, "arxiv-no-year")
    insert_candidate(db, "arxiv-fine")
    approve(client, headers, "arxiv-fine")

    body = client.get("/api/public/sources").get_json()

    assert [source["id"] for source in body["sources"]] == ["arxiv-fine"]
    assert body["skipped"][0]["id"] == "arxiv-no-year"
    assert body["skipped"][0]["problems"][0].startswith("year")


def test_reviewed_on_is_the_review_date(client, db, headers):
    insert_candidate(db, "arxiv-1")
    saved = approve(client, headers, "arxiv-1")
    source = client.get("/api/public/sources").get_json()["sources"][0]
    assert source["reviewed_on"] == saved["created_at"][:10]


def test_public_ids_are_slugs():
    assert public_id("arxiv-2411.18526") == "arxiv-2411-18526"
    assert public_id("s2-649def34f8be52c8b66281af98ae884c09aef38b") == "s2-649def34f8be52c8b66281af98ae884c09aef38b"
    assert public_id("Manual_Source--One") == "manual-source-one"
