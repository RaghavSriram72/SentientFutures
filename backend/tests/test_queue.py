"""The review queue: listing, filters and one candidate's history."""

from api_helpers import approve_body, insert_assessment, insert_candidate, minutes_ago, triage_result


def queue_ids(response) -> list[str]:
    ids = []
    for item in response.get_json()["items"]:
        ids.append(item["candidate"]["id"])
    return ids


def test_queue_lists_pending_candidates_oldest_first(client, db, headers):
    insert_candidate(db, "arxiv-3", found_at=minutes_ago(10))
    insert_candidate(db, "arxiv-1", found_at=minutes_ago(30))
    insert_candidate(db, "arxiv-2", found_at=minutes_ago(20))
    insert_candidate(db, "arxiv-new", status="new")
    insert_candidate(db, "arxiv-done", status="approved")
    for candidate_id in ["arxiv-1", "arxiv-2", "arxiv-3"]:
        insert_assessment(db, candidate_id)

    response = client.get("/api/queue", headers=headers)

    assert response.status_code == 200
    assert queue_ids(response) == ["arxiv-1", "arxiv-2", "arxiv-3"]
    body = response.get_json()
    assert body["total"] == 3
    first = body["items"][0]
    assert first["assessment"]["parsed"]["kind"] == "argument"
    # The list stays light: no abstracts and no raw model output.
    assert "abstract" not in first["candidate"]
    assert "raw_output" not in first["assessment"]
    assert "_id" not in first["candidate"]


def test_queue_can_list_untriaged_candidates(client, db, headers):
    insert_candidate(db, "arxiv-new", status="new")
    insert_candidate(db, "arxiv-pending")

    response = client.get("/api/queue?status=new", headers=headers)

    assert queue_ids(response) == ["arxiv-new"]
    assert response.get_json()["items"][0]["assessment"] is None


def test_queue_counts_every_status_whatever_the_filters(client, db, headers):
    insert_candidate(db, "arxiv-new-1", status="new")
    insert_candidate(db, "arxiv-new-2", status="new", flags=["no_abstract"])
    insert_candidate(db, "arxiv-pending")
    insert_candidate(db, "arxiv-out", status="triaged_out")

    response = client.get("/api/queue?status=new&flag=no_abstract", headers=headers)

    assert queue_ids(response) == ["arxiv-new-2"]
    assert response.get_json()["counts"] == {
        "new": 2,
        "triaged_out": 1,
        "pending_review": 1,
        "approved": 0,
        "rejected": 0,
    }


def test_queue_rejects_an_unknown_status(client, headers):
    response = client.get("/api/queue?status=everything", headers=headers)
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_query"


def test_queue_filters_by_flag(client, db, headers):
    insert_candidate(db, "arxiv-failed", flags=["ai_failed"])
    insert_candidate(db, "arxiv-fine")
    response = client.get("/api/queue?flag=ai_failed", headers=headers)
    assert queue_ids(response) == ["arxiv-failed"]


def test_queue_filters_by_the_ais_kind(client, db, headers):
    insert_candidate(db, "arxiv-argument")
    insert_assessment(db, "arxiv-argument", parsed=triage_result(kind="argument"))
    insert_candidate(db, "arxiv-evidence")
    insert_assessment(db, "arxiv-evidence", parsed=triage_result(kind="milestone_evidence"))
    insert_candidate(db, "arxiv-untriaged")

    response = client.get("/api/queue?kind=milestone_evidence", headers=headers)

    assert queue_ids(response) == ["arxiv-evidence"]
    assert response.get_json()["total"] == 1


def test_queue_kind_uses_the_current_assessment_only(client, db, headers):
    insert_candidate(db, "arxiv-retriaged")
    insert_assessment(db, "arxiv-retriaged", parsed=triage_result(kind="milestone_evidence"), created_at=minutes_ago(60))
    insert_assessment(db, "arxiv-retriaged", parsed=triage_result(kind="argument"))

    assert queue_ids(client.get("/api/queue?kind=argument", headers=headers)) == ["arxiv-retriaged"]
    assert queue_ids(client.get("/api/queue?kind=milestone_evidence", headers=headers)) == []


def test_queue_searches_titles_and_authors_case_insensitively(client, db, headers):
    insert_candidate(db, "arxiv-a", title="Whole Brain Emulation and Alignment")
    insert_candidate(db, "arxiv-b", title="Motor decoding", authors=["Grace Emulator"])
    insert_candidate(db, "arxiv-c", title="Something else")

    response = client.get("/api/queue?q=EMULAT", headers=headers)

    assert queue_ids(response) == ["arxiv-a", "arxiv-b"]


def test_queue_search_treats_regex_characters_as_text(client, db, headers):
    insert_candidate(db, "arxiv-a", title="Brains (and more)")
    response = client.get("/api/queue?q=(and", headers=headers)
    assert response.status_code == 200
    assert queue_ids(response) == ["arxiv-a"]


def test_queue_pages_with_limit_and_offset(client, db, headers):
    for index in range(5):
        insert_candidate(db, f"arxiv-{index}", found_at=minutes_ago(50 - index))

    response = client.get("/api/queue?limit=2&offset=2", headers=headers)

    assert queue_ids(response) == ["arxiv-2", "arxiv-3"]
    assert response.get_json()["total"] == 5
    assert client.get("/api/queue?limit=0", headers=headers).status_code == 400


def test_candidate_detail_has_the_abstract_assessments_and_reviews(client, db, headers):
    insert_candidate(db, "arxiv-1")
    older = insert_assessment(db, "arxiv-1", created_at=minutes_ago(60))
    current = insert_assessment(db, "arxiv-1")

    response = client.get("/api/queue/arxiv-1", headers=headers)

    assert response.status_code == 200
    body = response.get_json()
    assert body["candidate"]["abstract"].startswith("We argue")
    assert body["current_assessment"]["id"] == current["_id"]
    assessment_ids = []
    for assessment in body["assessments"]:
        assessment_ids.append(assessment["id"])
    assert assessment_ids == [current["_id"], older["_id"]]
    assert body["reviews"] == []


def test_candidate_detail_404s_for_an_unknown_id(client, headers):
    response = client.get("/api/queue/arxiv-missing", headers=headers)
    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "not_found"


def decide(client, headers, candidate_id: str, body: dict) -> None:
    response = client.post(f"/api/queue/{candidate_id}/review", json=body, headers=headers)
    assert response.status_code == 201, response.get_json()


def test_queue_kind_reads_the_decision_in_approved_and_rejected(client, db, headers):
    # The AI said argument, the reviewer changed it to milestone evidence.
    insert_candidate(db, "arxiv-changed")
    insert_assessment(db, "arxiv-changed", parsed=triage_result(kind="argument"))
    decide(client, headers, "arxiv-changed", approve_body(final={**approve_body()["final"], "kind": "milestone_evidence"}))
    # Added by hand, so the AI never gave a kind.
    insert_candidate(db, "manual-paper", origin="manual", collector="manual")
    decide(client, headers, "manual-paper", approve_body())

    def kind_ids(kind: str) -> list[str]:
        return queue_ids(client.get(f"/api/queue?status=approved&kind={kind}", headers=headers))

    assert kind_ids("milestone_evidence") == ["arxiv-changed"]
    assert kind_ids("argument") == ["manual-paper"]


def test_queue_kind_falls_back_to_the_ais_when_the_decision_has_none(client, db, headers):
    insert_candidate(db, "arxiv-rejected")
    insert_assessment(db, "arxiv-rejected", parsed=triage_result(kind="milestone_evidence"))
    decide(client, headers, "arxiv-rejected", {"decision": "reject", "reject_reason": "out_of_scope", "notes": ""})
    insert_candidate(db, "manual-rejected", origin="manual", collector="manual")
    decide(client, headers, "manual-rejected", {"decision": "reject", "reject_reason": "duplicate", "notes": ""})

    response = client.get("/api/queue?status=rejected&kind=milestone_evidence", headers=headers)

    assert queue_ids(response) == ["arxiv-rejected"]
    assert response.get_json()["total"] == 1


def test_queue_kind_still_reads_the_ai_in_pending_review(client, db, headers):
    insert_candidate(db, "manual-pending", origin="manual", collector="manual")
    insert_candidate(db, "arxiv-pending")
    insert_assessment(db, "arxiv-pending", parsed=triage_result(kind="argument"))

    assert queue_ids(client.get("/api/queue?kind=argument", headers=headers)) == ["arxiv-pending"]


def test_rejected_rows_carry_their_reject_reason(client, db, headers):
    insert_candidate(db, "arxiv-rejected", found_at=minutes_ago(20))
    decide(client, headers, "arxiv-rejected", {"decision": "reject", "reject_reason": "low_quality", "notes": ""})
    insert_candidate(db, "arxiv-approved", found_at=minutes_ago(10))
    decide(client, headers, "arxiv-approved", approve_body())
    insert_candidate(db, "arxiv-pending")

    rejected = client.get("/api/queue?status=rejected", headers=headers).get_json()["items"]
    approved = client.get("/api/queue?status=approved", headers=headers).get_json()["items"]
    pending = client.get("/api/queue", headers=headers).get_json()["items"]

    assert [item["reject_reason"] for item in rejected] == ["low_quality"]
    assert [item["reject_reason"] for item in approved] == [None]
    assert [item["reject_reason"] for item in pending] == [None]


def test_a_changed_rejection_shows_the_newest_reason(client, db, headers):
    insert_candidate(db, "arxiv-1")
    decide(client, headers, "arxiv-1", {"decision": "reject", "reject_reason": "low_quality", "notes": ""})
    first = db["sources"].find_one({"_id": "arxiv-1"})["current_review_id"]
    change = {"decision": "reject", "reject_reason": "duplicate", "notes": "", "replaces_review_id": first}
    decide(client, headers, "arxiv-1", change)

    items = client.get("/api/queue?status=rejected", headers=headers).get_json()["items"]
    assert [item["reject_reason"] for item in items] == ["duplicate"]
