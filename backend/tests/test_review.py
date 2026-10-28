"""Reviews: the approve and reject rules, the compared/changed/kept semantics,
and what happens to the source and the AI's record afterwards."""

import mongomock
import pytest
from bson.errors import InvalidDocument
from api_helpers import (
    PROMPT_VERSION,
    REVIEWER_EMAIL,
    REVIEWER_NAME,
    approve_body,
    insert_assessment,
    insert_candidate,
    triage_result,
)
from pymongo.errors import PyMongoError


def review(client, headers, candidate_id: str, body: dict):
    return client.post(f"/api/queue/{candidate_id}/review", json=body, headers=headers)


def error_code(response) -> str:
    return response.get_json()["error"]["code"]


@pytest.fixture
def pending(db) -> dict:
    """A pending candidate whose AI assessment gave kind, technology and problem, and no claim directions."""
    candidate = insert_candidate(db, "arxiv-2411.18526")
    parsed = triage_result(kind="argument", technology=["bci", "wbe"], problem="alignment", claim_directions=[])
    return insert_assessment(db, candidate["_id"], parsed=parsed)


# ---------- What gets compared, changed and kept ----------


def test_compared_changed_and_ai_values_used_follow_the_rules(client, db, headers, pending):
    body = approve_body(
        final={
            "kind": "argument",  # same as the AI, and the reviewer pressed "Use AI value"
            "technology": ["wbe", "bci"],  # same set as the AI, chosen on their own
            "problem": "both",  # different from the AI
            "claim_directions": ["human_empowerment"],  # the AI gave none, so adding one is a change
            "summary": "  Our own summary.  ",
        },
        ai_values_used=["kind"],
    )

    response = review(client, headers, "arxiv-2411.18526", body)

    assert response.status_code == 201, response.get_json()
    saved = response.get_json()["review"]
    assert saved["compared_fields"] == ["kind", "technology", "problem", "claim_directions"]
    assert saved["changed_fields"] == ["problem", "claim_directions"]
    assert saved["ai_values_used"] == ["kind"]
    assert saved["assessment_id"] == pending["_id"]
    assert saved["prompt_version"] == PROMPT_VERSION
    assert saved["reviewer"] == REVIEWER_EMAIL
    assert saved["reviewer_name"] == REVIEWER_NAME
    assert saved["final"]["summary"] == "Our own summary."


def test_using_an_ai_value_the_reviewer_changed_is_refused(client, headers, pending):
    body = approve_body(
        final={"kind": "milestone_evidence", "technology": ["bci", "wbe"], "problem": "alignment", "summary": "S."},
        ai_values_used=["kind"],
    )
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "ai_values_mismatch"
    assert "kind" in response.get_json()["error"]["details"][0]


def test_using_an_ai_value_the_ai_never_gave_is_refused(client, headers, pending):
    body = approve_body(
        final={"kind": "argument", "technology": ["bci"], "claim_directions": [], "summary": "S."},
        ai_values_used=["claim_directions"],
    )
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "ai_values_mismatch"


def test_ai_values_used_only_takes_fields_the_ai_suggests(client, headers, pending):
    body = approve_body(
        final={"kind": "argument", "technology": ["bci"], "source_type": "preprint", "summary": "S."},
        ai_values_used=["source_type"],
    )
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "ai_values_mismatch"


def test_repeated_tags_and_repeated_ai_values_are_collapsed(client, headers, pending):
    body = approve_body(
        final={"kind": "argument", "technology": ["bci", "wbe", "bci"], "problem": "alignment", "summary": "S."},
        ai_values_used=["technology", "technology"],
    )
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 201
    saved = response.get_json()["review"]
    assert saved["final"]["technology"] == ["bci", "wbe"]
    assert saved["ai_values_used"] == ["technology"]
    assert saved["changed_fields"] == []


def test_a_candidate_the_ai_hasnt_triaged_compares_nothing(client, db, headers):
    insert_candidate(db, "arxiv-new", status="new")
    body = approve_body(assessment_id=None)

    response = review(client, headers, "arxiv-new", body)

    assert response.status_code == 201
    saved = response.get_json()["review"]
    assert saved["assessment_id"] is None
    assert saved["prompt_version"] is None
    assert saved["compared_fields"] == []
    assert saved["changed_fields"] == []


def test_a_failed_assessment_compares_nothing(client, db, headers):
    insert_candidate(db, "arxiv-failed", flags=["ai_failed"])
    failed = insert_assessment(db, "arxiv-failed", failed=True)

    response = review(client, headers, "arxiv-failed", approve_body())

    saved = response.get_json()["review"]
    assert saved["assessment_id"] == failed["_id"]
    assert saved["compared_fields"] == []


# ---------- Approve rules ----------


@pytest.mark.parametrize("summary", [None, "", "   "])
def test_approving_needs_a_summary(client, headers, pending, summary):
    body = approve_body(final={"kind": "argument", "summary": summary})
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "summary_required"


def test_approving_with_a_reject_reason_is_refused(client, headers, pending):
    response = review(client, headers, "arxiv-2411.18526", approve_body(reject_reason="duplicate"))
    assert response.status_code == 400


def test_approving_needs_a_source_type_from_somewhere(client, db, headers):
    insert_candidate(db, "s2-abc", collector="semantic_scholar", source_type=None)
    insert_assessment(db, "s2-abc")

    refused = review(client, headers, "s2-abc", approve_body())
    assert refused.status_code == 400
    assert error_code(refused) == "source_type_required"

    body = approve_body()
    body["final"]["source_type"] = "peer_reviewed"
    assert review(client, headers, "s2-abc", body).status_code == 201


def test_credibility_unclear_needs_a_reason(client, headers, pending):
    body = approve_body()
    body["final"]["credibility"] = "unclear"
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "credibility_reason_required"


def test_credibility_unclear_reason_other_is_refused(client, headers, pending):
    body = approve_body()
    body["final"]["credibility"] = "unclear"
    body["final"]["credibility_unclear_reason"] = "other"
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "credibility_reason_other"


def test_credibility_unclear_with_a_reason_reaches_the_public_source(client, headers, pending):
    body = approve_body()
    body["final"]["credibility"] = "unclear"
    body["final"]["credibility_unclear_reason"] = "conflicting_evidence"
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 201, response.get_json()
    assert response.get_json()["publish_problems"] == []

    public = client.get("/api/public/sources").get_json()["sources"]
    assert public[0]["credibility"] == "unclear"
    assert public[0]["credibility_unclear_reason"] == "conflicting_evidence"


def test_a_leftover_unclear_reason_is_dropped_when_credibility_isnt_unclear(client, db, headers, pending):
    body = approve_body()
    body["final"]["credibility"] = "strong"
    body["final"]["credibility_unclear_reason"] = "conflicting_evidence"
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 201
    assert response.get_json()["review"]["final"]["credibility_unclear_reason"] is None


def test_approving_needs_a_kind(client, headers, pending):
    body = approve_body()
    body["final"]["kind"] = None
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "kind_required"


def test_approving_needs_a_technology_or_general_background(client, headers, pending):
    body = approve_body()
    body["final"]["technology"] = []
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "technology_required"

    body["final"]["general_background"] = True
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 201, response.get_json()
    public = client.get("/api/public/sources").get_json()["sources"]
    assert public[0]["technology"] == []


def test_general_background_with_technologies_is_refused(client, headers, pending):
    body = approve_body()
    body["final"]["general_background"] = True
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "technology_conflict"


def test_a_rejection_needs_no_kind_or_technology(client, headers, pending):
    body = {"decision": "reject", "reject_reason": "not_relevant"}
    assert review(client, headers, "arxiv-2411.18526", body).status_code == 201


@pytest.mark.parametrize("status", ["approved", "rejected"])
def test_a_decided_candidate_needs_the_review_it_replaces(client, db, headers, status):
    insert_candidate(db, "arxiv-done", status=status)
    response = review(client, headers, "arxiv-done", approve_body())
    assert response.status_code == 409
    assert error_code(response) == "not_reviewable"
    assert db["reviews"].count_documents({}) == 0


def test_a_triaged_out_paper_can_be_rescued(client, db, headers):
    insert_candidate(db, "arxiv-ruled-out", status="triaged_out", abstract=None)
    insert_assessment(db, "arxiv-ruled-out", parsed=triage_result(relevant="no", kind=None, technology=[]))

    response = review(client, headers, "arxiv-ruled-out", approve_body())

    assert response.status_code == 201, response.get_json()
    assert db["sources"].find_one({"_id": "arxiv-ruled-out"})["review_status"] == "approved"


def test_a_decision_can_be_changed_by_naming_the_review_it_replaces(client, db, headers, pending):
    first = review(client, headers, "arxiv-2411.18526", approve_body()).get_json()["review"]
    assert "final" in db["sources"].find_one({"_id": "arxiv-2411.18526"})

    body = {"decision": "reject", "reject_reason": "duplicate", "replaces_review_id": first["id"]}
    second = review(client, headers, "arxiv-2411.18526", body)

    assert second.status_code == 201, second.get_json()
    source = db["sources"].find_one({"_id": "arxiv-2411.18526"})
    assert source["review_status"] == "rejected"
    assert source["current_review_id"] == second.get_json()["review"]["id"]
    assert "final" not in source  # the approval's values don't linger on a rejected source
    assert db["reviews"].count_documents({}) == 2  # the first review is kept

    # The same change sent twice (a double click) only counts once.
    again = review(client, headers, "arxiv-2411.18526", body)
    assert again.status_code == 409
    assert error_code(again) == "review_changed"
    assert db["reviews"].count_documents({}) == 2


def test_replacing_a_review_on_an_undecided_paper_is_refused(client, headers, pending):
    body = approve_body(replaces_review_id="review-that-does-not-exist")
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 409
    assert error_code(response) == "review_changed"


def test_a_second_review_of_the_same_candidate_is_refused(client, db, headers, pending):
    assert review(client, headers, "arxiv-2411.18526", approve_body()).status_code == 201
    second = review(client, headers, "arxiv-2411.18526", approve_body())
    assert second.status_code == 409
    assert db["reviews"].count_documents({}) == 1


def test_a_review_of_an_older_assessment_is_refused(client, db, headers, pending):
    newer = insert_assessment(db, "arxiv-2411.18526")
    stale = review(client, headers, "arxiv-2411.18526", approve_body(assessment_id=pending["_id"]))
    assert stale.status_code == 409
    assert error_code(stale) == "assessment_changed"

    current = review(client, headers, "arxiv-2411.18526", approve_body(assessment_id=newer["_id"]))
    assert current.status_code == 201


def test_reviewing_an_unknown_candidate_is_404(client, headers):
    response = review(client, headers, "arxiv-missing", approve_body())
    assert response.status_code == 404


def test_the_body_is_validated(client, headers, pending):
    bad_enum = approve_body(final={"kind": "opinion", "summary": "S."})
    response = review(client, headers, "arxiv-2411.18526", bad_enum)
    assert response.status_code == 400
    assert error_code(response) == "invalid_body"
    assert any("final.kind" in line for line in response.get_json()["error"]["details"])

    unknown_key = approve_body(score=4)
    assert review(client, headers, "arxiv-2411.18526", unknown_key).status_code == 400


# ---------- Reject rules ----------


def test_rejecting_needs_a_reason(client, headers, pending):
    response = review(client, headers, "arxiv-2411.18526", {"decision": "reject"})
    assert response.status_code == 400
    assert error_code(response) == "reject_reason_required"


def test_a_rejection_records_no_field_comparison(client, db, headers, pending):
    body = {"decision": "reject", "reject_reason": "out_of_scope", "notes": "Motor decoding only."}

    response = review(client, headers, "arxiv-2411.18526", body)

    assert response.status_code == 201
    saved = response.get_json()["review"]
    assert saved["decision"] == "reject"
    assert saved["reject_reason"] == "out_of_scope"
    assert saved["compared_fields"] == []
    assert saved["changed_fields"] == []
    assert saved["ai_values_used"] == []
    source = db["sources"].find_one({"_id": "arxiv-2411.18526"})
    assert source["review_status"] == "rejected"
    assert source["abstract"] is None
    assert source["current_review_id"] == saved["id"]


def test_a_rejection_cant_keep_ai_values(client, headers, pending):
    body = {"decision": "reject", "reject_reason": "not_relevant", "ai_values_used": ["kind"]}
    response = review(client, headers, "arxiv-2411.18526", body)
    assert response.status_code == 400
    assert error_code(response) == "ai_values_mismatch"


# ---------- What changes in the database ----------


def test_approving_moves_the_source_and_clears_the_abstract(client, db, headers, pending):
    response = review(client, headers, "arxiv-2411.18526", approve_body())

    saved = response.get_json()["review"]
    source = db["sources"].find_one({"_id": "arxiv-2411.18526"})
    assert source["review_status"] == "approved"
    assert source["current_review_id"] == saved["id"]
    assert source["abstract"] is None
    assert source["final"]["summary"] == saved["final"]["summary"]
    assert response.get_json()["candidate"]["abstract"] is None


def test_the_review_is_stored_as_returned(client, db, headers, pending):
    saved = review(client, headers, "arxiv-2411.18526", approve_body()).get_json()["review"]
    stored = db["reviews"].find_one({"_id": saved["id"]})
    assert stored["source_id"] == "arxiv-2411.18526"
    assert stored["compared_fields"] == saved["compared_fields"]
    assert stored["final"]["kind"] == "argument"


def test_ai_assessments_are_untouched_by_a_review(client, db, headers, pending):
    before = list(db["ai_assessments"].find().sort("_id", 1))

    review(client, headers, "arxiv-2411.18526", approve_body())

    after = list(db["ai_assessments"].find().sort("_id", 1))
    assert after == before


def test_approval_reports_problems_that_would_keep_it_off_the_site(client, db, headers):
    insert_candidate(db, "arxiv-no-year", year=None)
    insert_assessment(db, "arxiv-no-year")

    response = review(client, headers, "arxiv-no-year", approve_body())

    assert response.status_code == 201
    problems = response.get_json()["publish_problems"]
    assert len(problems) == 1
    assert problems[0].startswith("year")


def test_if_the_review_cant_be_saved_the_source_is_put_back(client, db, headers, pending, monkeypatch):
    original_insert = mongomock.collection.Collection.insert_one

    def failing_insert(collection, document, *args, **kwargs):
        if collection.name == "reviews":
            raise PyMongoError("disk full")
        return original_insert(collection, document, *args, **kwargs)

    monkeypatch.setattr(mongomock.collection.Collection, "insert_one", failing_insert)

    response = review(client, headers, "arxiv-2411.18526", approve_body())

    assert response.status_code == 500
    source = db["sources"].find_one({"_id": "arxiv-2411.18526"})
    assert source["review_status"] == "pending_review"
    assert source["current_review_id"] is None
    assert source["abstract"].startswith("We argue")
    assert "final" not in source


def test_the_source_is_put_back_whatever_stops_the_review_being_saved(client, db, headers, pending, monkeypatch):
    # bson's InvalidDocument isn't a PyMongoError, and it used to leave the
    # source approved with a current_review_id pointing at nothing.
    original_insert = mongomock.collection.Collection.insert_one

    def failing_insert(collection, document, *args, **kwargs):
        if collection.name == "reviews":
            raise InvalidDocument("cannot encode object")
        return original_insert(collection, document, *args, **kwargs)

    monkeypatch.setattr(mongomock.collection.Collection, "insert_one", failing_insert)

    response = review(client, headers, "arxiv-2411.18526", approve_body())

    assert response.status_code == 500
    source = db["sources"].find_one({"_id": "arxiv-2411.18526"})
    assert source["review_status"] == "pending_review"
    assert source["current_review_id"] is None
    assert db["reviews"].count_documents({}) == 0


def test_a_decided_source_whose_review_is_missing_can_be_reviewed_again(client, db, headers):
    # If a source was left decided with no review behind it, the review page
    # can recover by naming the missing review as the one it replaces.
    insert_candidate(db, "arxiv-orphan", status="approved", current_review_id="review-that-was-never-saved")

    body = approve_body(replaces_review_id="review-that-was-never-saved")
    response = review(client, headers, "arxiv-orphan", body)

    assert response.status_code == 201, response.get_json()
    saved = response.get_json()["review"]
    assert db["sources"].find_one({"_id": "arxiv-orphan"})["current_review_id"] == saved["id"]
