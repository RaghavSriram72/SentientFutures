"""Override rates: per prompt version, per field, how often reviewers changed the AI's value."""

from api_helpers import approve_body, insert_assessment, insert_candidate, triage_result


def approve(client, headers, candidate_id: str, final: dict, ai_values_used: list[str]) -> None:
    final = dict(final, summary="Our summary.")
    if not final.get("technology"):
        # Approving needs a technology or "General background". These tests
        # are about other fields, and general background keeps technology empty.
        final["general_background"] = True
    response = client.post(
        f"/api/queue/{candidate_id}/review",
        json=approve_body(final=final, ai_values_used=ai_values_used),
        headers=headers,
    )
    assert response.status_code == 201, response.get_json()


def group_for(body: dict, prompt_version: str | None) -> dict:
    for group in body["by_prompt_version"]:
        if group["prompt_version"] == prompt_version:
            return group
    raise AssertionError(f"no group for {prompt_version}")


def test_stats_count_changes_per_field_and_prompt_version(client, db, headers):
    ai = triage_result(kind="argument", technology=["bci"], problem="alignment", claim_directions=[])

    insert_candidate(db, "arxiv-1")
    insert_assessment(db, "arxiv-1", parsed=ai, prompt_version="triage_v1-aaaa1111")
    approve(client, headers, "arxiv-1", {"kind": "argument", "technology": ["bci"], "problem": "alignment"}, ["kind", "technology"])

    insert_candidate(db, "arxiv-2")
    insert_assessment(db, "arxiv-2", parsed=ai, prompt_version="triage_v1-aaaa1111")
    approve(client, headers, "arxiv-2", {"kind": "milestone_evidence", "technology": ["bci", "wbe"], "problem": "alignment"}, [])

    insert_candidate(db, "arxiv-3")
    insert_assessment(db, "arxiv-3", parsed=ai, prompt_version="triage_v1-bbbb2222")
    reject = {"decision": "reject", "reject_reason": "not_relevant"}
    assert client.post("/api/queue/arxiv-3/review", json=reject, headers=headers).status_code == 201

    insert_candidate(db, "arxiv-4", status="new")
    approve(client, headers, "arxiv-4", {"kind": "argument"}, [])

    body = client.get("/api/reviews/stats", headers=headers).get_json()

    assert body["fields"] == ["kind", "technology", "problem", "claim_directions"]

    first = group_for(body, "triage_v1-aaaa1111")
    assert (first["reviews"], first["approved"], first["rejected"]) == (2, 2, 0)
    kind = first["fields"]["kind"]
    assert (kind["compared"], kind["changed"], kind["ai_values_used"]) == (2, 1, 1)
    assert kind["change_rate"] == 0.5
    assert {"ai": "argument", "final": "milestone_evidence", "count": 1} in kind["pairs"]
    assert {"ai": "argument", "final": "argument", "count": 1} in kind["pairs"]
    technology = first["fields"]["technology"]
    assert {"ai": ["bci"], "final": ["bci", "wbe"], "count": 1} in technology["pairs"]
    problem = first["fields"]["problem"]
    assert (problem["compared"], problem["changed"]) == (2, 0)
    # The AI gave no claim directions and neither did the reviewers: compared, and unchanged.
    claims = first["fields"]["claim_directions"]
    assert (claims["compared"], claims["changed"], claims["change_rate"]) == (2, 0, 0.0)
    assert claims["pairs"] == [{"ai": [], "final": [], "count": 2}]

    second = group_for(body, "triage_v1-bbbb2222")
    assert (second["reviews"], second["approved"], second["rejected"]) == (1, 0, 1)
    assert second["fields"]["kind"]["compared"] == 0

    # Reviewed without any AI assessment.
    none = group_for(body, None)
    assert none["reviews"] == 1
    assert none["fields"]["kind"]["compared"] == 0


def test_stats_with_no_reviews(client, headers):
    body = client.get("/api/reviews/stats", headers=headers).get_json()
    assert body["by_prompt_version"] == []


def test_a_changed_decision_replaces_the_earlier_one_in_the_stats(client, db, headers):
    ai = triage_result(kind="argument", technology=["bci"], problem="alignment", claim_directions=[])
    insert_candidate(db, "arxiv-1")
    insert_assessment(db, "arxiv-1", parsed=ai, prompt_version="triage_v1-aaaa1111")
    approve(client, headers, "arxiv-1", {"kind": "milestone_evidence", "technology": ["bci"], "problem": "alignment"}, [])
    first_review_id = db["sources"].find_one({"_id": "arxiv-1"})["current_review_id"]

    change = approve_body(
        final={"kind": "argument", "technology": ["bci"], "problem": "alignment", "summary": "Our summary."},
        replaces_review_id=first_review_id,
    )
    assert client.post("/api/queue/arxiv-1/review", json=change, headers=headers).status_code == 201

    group = group_for(client.get("/api/reviews/stats", headers=headers).get_json(), "triage_v1-aaaa1111")
    assert group["reviews"] == 1
    assert group["fields"]["kind"]["changed"] == 0


def test_tags_the_ai_left_out_count_as_changes(client, db, headers):
    # The AI chose no problem and no claim direction; the reviewer added both.
    ai = triage_result(kind="argument", technology=["bci"], problem=None, claim_directions=[])
    insert_candidate(db, "arxiv-1")
    insert_assessment(db, "arxiv-1", parsed=ai, prompt_version="triage_v1-aaaa1111")
    final = {"kind": "argument", "technology": ["bci"], "problem": "alignment", "claim_directions": ["ai_alignment"]}
    approve(client, headers, "arxiv-1", final, [])

    review = db["reviews"].find_one({"source_id": "arxiv-1"})
    assert review["compared_fields"] == ["kind", "technology", "problem", "claim_directions"]
    assert review["changed_fields"] == ["problem", "claim_directions"]

    group = group_for(client.get("/api/reviews/stats", headers=headers).get_json(), "triage_v1-aaaa1111")
    problem = group["fields"]["problem"]
    assert (problem["compared"], problem["changed"], problem["change_rate"]) == (1, 1, 1.0)
    assert problem["pairs"] == [{"ai": None, "final": "alignment", "count": 1}]
    claims = group["fields"]["claim_directions"]
    assert claims["pairs"] == [{"ai": [], "final": ["ai_alignment"], "count": 1}]


def test_stats_split_decisions_by_what_the_ai_said_about_relevance(client, db, headers):
    version = "triage_v1-aaaa1111"
    reject = {"decision": "reject", "reject_reason": "not_relevant"}

    insert_candidate(db, "arxiv-yes")
    insert_assessment(db, "arxiv-yes", parsed=triage_result(relevant="yes"), prompt_version=version)
    approve(client, headers, "arxiv-yes", {"kind": "argument"}, [])

    insert_candidate(db, "arxiv-unsure")
    insert_assessment(db, "arxiv-unsure", parsed=triage_result(relevant="unsure"), prompt_version=version)
    assert client.post("/api/queue/arxiv-unsure/review", json=reject, headers=headers).status_code == 201

    # The AI said no to both of these. One was sampled for a spot check, the
    # other was rescued from the Triaged out tab.
    insert_candidate(db, "arxiv-spot", flags=["spot_check"])
    insert_assessment(db, "arxiv-spot", parsed=triage_result(relevant="no"), prompt_version=version)
    approve(client, headers, "arxiv-spot", {"kind": "argument"}, [])

    insert_candidate(db, "arxiv-rescued", status="triaged_out")
    insert_assessment(db, "arxiv-rescued", parsed=triage_result(relevant="no"), prompt_version=version)
    approve(client, headers, "arxiv-rescued", {"kind": "argument"}, [])

    insert_candidate(db, "arxiv-failed", flags=["ai_failed"])
    insert_assessment(db, "arxiv-failed", failed=True, prompt_version=version)
    assert client.post("/api/queue/arxiv-failed/review", json=reject, headers=headers).status_code == 201

    body = client.get("/api/reviews/stats", headers=headers).get_json()

    assert body["ai_relevant_groups"] == ["yes", "unsure", "no_spot_check", "no_rescued", "no_answer"]
    group = group_for(body, version)
    assert (group["reviews"], group["approved"], group["approval_rate"]) == (5, 3, 0.6)
    by_relevant = group["by_ai_relevant"]
    assert by_relevant["yes"] == {"reviews": 1, "approved": 1, "rejected": 0, "approval_rate": 1.0}
    assert by_relevant["unsure"] == {"reviews": 1, "approved": 0, "rejected": 1, "approval_rate": 0.0}
    assert by_relevant["no_spot_check"] == {"reviews": 1, "approved": 1, "rejected": 0, "approval_rate": 1.0}
    assert by_relevant["no_rescued"] == {"reviews": 1, "approved": 1, "rejected": 0, "approval_rate": 1.0}
    assert by_relevant["no_answer"] == {"reviews": 1, "approved": 0, "rejected": 1, "approval_rate": 0.0}


def test_relevance_groups_with_no_reviews_have_no_rate(client, db, headers):
    insert_candidate(db, "arxiv-1")
    insert_assessment(db, "arxiv-1", prompt_version="triage_v1-aaaa1111")
    approve(client, headers, "arxiv-1", {"kind": "argument"}, [])

    group = group_for(client.get("/api/reviews/stats", headers=headers).get_json(), "triage_v1-aaaa1111")
    assert group["by_ai_relevant"]["unsure"] == {"reviews": 0, "approved": 0, "rejected": 0, "approval_rate": None}
