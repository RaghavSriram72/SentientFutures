"""The milestone editor: list, create, save with a version check, revisions, and the public copy."""

import pytest
from api_helpers import (
    SITE_SOURCES,
    approve_body,
    bearer,
    insert_candidate,
    make_config,
    valid_milestone,
    write_content,
)

from sf_api import create_app

EM_DASH = chr(0x2014)


SAMPLE_SOURCE = {
    "id": "sample-report",
    "title": "A made-up report",
    "authors": ["Example Author"],
    "year": 2021,
    "url": "https://example.org/sample-report",
    "source_type": "report",
    "technology": ["bci"],
    "problem": "alignment",
    "summary": {"text": "Placeholder summary.", "provenance": "team"},
    "ai_suggested_fields": [],
    "sample": True,
}


@pytest.fixture
def content_dir(tmp_path):
    milestones = [
        valid_milestone("wbe-first"),
        valid_milestone("wbe-second", depends_on=["wbe-first"], source_ids=["s13"]),
        valid_milestone("bci-sample-thing", technology="bci", sample=True, source_ids=["sample-report"]),
    ]
    sources = [*SITE_SOURCES, SAMPLE_SOURCE]
    return write_content(tmp_path / "content", milestones=milestones, sources=sources, posts={})


@pytest.fixture
def config(content_dir):
    return make_config(content_dir=content_dir)


def get(client, headers, milestone_id: str) -> dict:
    response = client.get(f"/api/milestones/{milestone_id}", headers=headers)
    assert response.status_code == 200, response.get_json()
    return response.get_json()["milestone"]


def save(client, headers, milestone_id: str, changes: dict, published: bool = True, version: int | None = None):
    record = get(client, headers, milestone_id)
    if version is None:
        version = record["version"]
    record.update(changes)
    body = {"milestone": record, "version": version, "published": published}
    return client.put(f"/api/milestones/{milestone_id}", json=body, headers=headers)


def error(response) -> dict:
    return response.get_json()["error"]


# ---------- Seeding and listing ----------


def test_an_in_memory_database_starts_with_the_content_milestones(client, headers):
    response = client.get("/api/milestones", headers=headers)

    assert response.status_code == 200
    milestones = response.get_json()["milestones"]
    assert [m["id"] for m in milestones] == ["wbe-first", "wbe-second", "bci-sample-thing"]
    first = milestones[0]
    assert first["published"] is True
    assert first["version"] == 1
    assert first["position"] == 0
    assert first["updated_by_name"] == "content/ seed"
    # The sample flag is kept; the public site hides samples itself.
    assert milestones[2]["sample"] is True


def test_seeding_writes_one_revision_each(client, headers):
    revisions = client.get("/api/milestones/wbe-first/revisions", headers=headers).get_json()["revisions"]
    assert len(revisions) == 1
    assert revisions[0]["action"] == "seed"
    assert revisions[0]["milestone"]["id"] == "wbe-first"
    assert "published" not in revisions[0]["milestone"]


def test_an_unknown_milestone_is_404(client, headers):
    assert client.get("/api/milestones/nope", headers=headers).status_code == 404
    assert client.get("/api/milestones/nope/revisions", headers=headers).status_code == 404
    body = {"milestone": valid_milestone("nope"), "version": 1, "published": True}
    assert client.put("/api/milestones/nope", json=body, headers=headers).status_code == 404


# ---------- Creating ----------


def test_a_new_milestone_starts_as_an_unpublished_draft(client, headers):
    response = client.post("/api/milestones", json={"milestone": valid_milestone("wbe-new")}, headers=headers)

    assert response.status_code == 201, response.get_json()
    created = response.get_json()["milestone"]
    assert created["published"] is False
    assert created["version"] == 1
    assert created["position"] == 3  # listed last
    assert created["updated_by"] == "rae@example.com"
    assert created["updated_by_name"] == "Rae Reviewer"
    revisions = client.get("/api/milestones/wbe-new/revisions", headers=headers).get_json()["revisions"]
    assert [r["action"] for r in revisions] == ["create"]


def test_creating_a_milestone_with_a_taken_id_is_409(client, headers):
    response = client.post("/api/milestones", json={"milestone": valid_milestone("wbe-first")}, headers=headers)
    assert response.status_code == 409
    assert error(response)["code"] == "id_taken"


def test_an_invalid_milestone_is_422_with_field_paths(client, headers):
    broken = valid_milestone("wbe-broken", would_move_later=[], name=" ")
    broken["forecasts"] = [
        {
            "id": "f1",
            "source_id": "s13",
            "forecaster": "Someone",
            "claim": "Soon",
            "quote": "",
            "made_in": 2024,
            "earliest": 2030,
            "latest": 2035,
            "never": False,
        }
    ]
    response = client.post("/api/milestones", json={"milestone": broken}, headers=headers)

    assert response.status_code == 422
    assert error(response)["code"] == "invalid_milestone"
    details = error(response)["details"]
    assert any(line.startswith("milestone.name: must not be empty") for line in details)
    assert any(line.startswith("milestone.forecasts[0].quote: required") for line in details)


def test_the_milestone_rules_are_checked_too(client, headers):
    broken = valid_milestone("wbe-broken", would_move_later=[], achieved_in=2020)
    response = client.post("/api/milestones", json={"milestone": broken}, headers=headers)

    assert response.status_code == 422
    details = error(response)["details"]
    assert any(line.startswith("milestone.achieved_in_basis: required when achieved_in is set") for line in details)
    assert any(line.startswith("milestone.would_move_later: needs at least one entry") for line in details)


def test_a_milestone_body_must_be_wrapped(client, headers):
    response = client.post("/api/milestones", json=valid_milestone("wbe-new"), headers=headers)
    assert response.status_code == 400
    assert error(response)["code"] == "invalid_body"


# ---------- Saving ----------


def test_saving_bumps_the_version_and_adds_a_revision(client, headers):
    response = save(client, headers, "wbe-first", {"name": "A clearer name"})

    assert response.status_code == 200, response.get_json()
    saved = response.get_json()["milestone"]
    assert saved["name"] == "A clearer name"
    assert saved["version"] == 2
    assert saved["position"] == 0
    assert saved["updated_by_name"] == "Rae Reviewer"
    revisions = client.get("/api/milestones/wbe-first/revisions", headers=headers).get_json()["revisions"]
    assert [(r["version"], r["action"]) for r in revisions] == [(2, "update"), (1, "seed")]
    assert revisions[0]["milestone"]["name"] == "A clearer name"
    assert revisions[1]["milestone"]["name"] == "Milestone wbe-first"


def test_saving_from_an_old_version_is_409(client, headers):
    assert save(client, headers, "wbe-first", {"name": "First edit"}).status_code == 200

    response = save(client, headers, "wbe-first", {"name": "Second edit"}, version=1)

    assert response.status_code == 409
    assert error(response)["code"] == "version_conflict"
    assert error(response)["details"]["current_version"] == 2
    assert error(response)["details"]["updated_by_name"] == "Rae Reviewer"
    assert get(client, headers, "wbe-first")["name"] == "First edit"


def test_the_id_cant_change(client, headers):
    response = save(client, headers, "wbe-first", {"id": "wbe-renamed"})
    assert response.status_code == 422
    assert error(response)["details"][0].startswith('milestone.id: can\'t change from "wbe-first"')


def test_unknown_and_self_dependencies_are_refused(client, headers):
    response = save(client, headers, "wbe-first", {"depends_on": ["wbe-nope", "wbe-first"]})
    assert response.status_code == 422
    assert error(response)["details"] == [
        'milestone.depends_on[0]: no milestone with id "wbe-nope"',
        "milestone.depends_on[1]: a milestone can't depend on itself",
    ]


def test_a_dependency_cycle_is_refused(client, headers):
    # wbe-second already depends on wbe-first.
    response = save(client, headers, "wbe-first", {"depends_on": ["wbe-second"]})
    assert response.status_code == 422
    assert "dependency cycle" in error(response)["details"][0]
    assert "wbe-first" in error(response)["details"][0]


def test_every_source_id_must_be_in_the_catalog(client, headers):
    estimate = {
        "earliest": 2040,
        "latest": 2060,
        "basis": {"text": "Our range.", "provenance": "source", "source_ids": ["s404"], "quote": "Between 2040 and 2060."},
        "set_by": "Raghav",
        "set_on": "2026-10-27",
    }
    changes = {"source_ids": ["s13", "s99"], "estimate": estimate, "confidence": "low"}
    response = save(client, headers, "wbe-first", changes)

    assert response.status_code == 422
    details = error(response)["details"]
    assert any(line.startswith('milestone.source_ids[1]: no source with id "s99"') for line in details)
    assert any(line.startswith('milestone.estimate.basis.source_ids[0]: no source with id "s404"') for line in details)


def test_a_real_milestone_cant_link_to_samples(client, headers):
    response = save(client, headers, "wbe-first", {"depends_on": ["bci-sample-thing"], "source_ids": ["sample-report"]})

    assert response.status_code == 422
    assert error(response)["details"] == [
        'milestone.depends_on[0]: "bci-sample-thing" is a sample milestone. The public site leaves samples out, '
        "so a real milestone can only depend on real ones",
        'milestone.source_ids[0]: "sample-report" is a sample source. The public site leaves samples out, '
        "so a real record has to cite a real source",
    ]


def test_a_sample_milestone_can_cite_a_sample_source(client, headers):
    assert save(client, headers, "bci-sample-thing", {"source_ids": ["sample-report"]}).status_code == 200


def test_an_approved_source_can_be_cited(client, db, headers):
    insert_candidate(db, "arxiv-2610.00001")
    response = client.post("/api/queue/arxiv-2610.00001/review", json=approve_body(), headers=headers)
    assert response.status_code == 201

    assert save(client, headers, "wbe-first", {"source_ids": ["arxiv-2610-00001"]}).status_code == 200


def test_an_em_dash_is_refused(client, headers):
    summary = {"text": f"Before {EM_DASH} after.", "provenance": "team"}
    response = save(client, headers, "wbe-first", {"summary": summary})
    assert response.status_code == 422
    assert error(response)["details"][0].startswith("milestone.summary.text: has an em dash")


def test_a_published_milestone_cant_depend_on_a_draft(client, headers):
    client.post("/api/milestones", json={"milestone": valid_milestone("wbe-draft")}, headers=headers)

    published = save(client, headers, "wbe-first", {"depends_on": ["wbe-draft"]}, published=True)
    assert published.status_code == 422
    assert "isn't published yet" in error(published)["details"][0]

    as_draft = save(client, headers, "wbe-first", {"depends_on": ["wbe-draft"]}, published=False)
    # wbe-second (published) depends on wbe-first, so wbe-first can't become a draft either.
    assert as_draft.status_code == 422
    assert error(as_draft)["details"][0].startswith("published: published milestones depend on this one (wbe-second)")


def test_unpublishing_a_milestone_nothing_depends_on_works(client, headers):
    response = save(client, headers, "wbe-second", {}, published=False)
    assert response.status_code == 200
    assert response.get_json()["milestone"]["published"] is False


def test_editor_fields_sent_back_inside_the_milestone_are_ignored(client, headers):
    record = get(client, headers, "wbe-first")
    record["version"] = 99
    record["position"] = 42
    body = {"milestone": record, "version": 1, "published": True}
    response = client.put("/api/milestones/wbe-first", json=body, headers=headers)
    assert response.status_code == 200
    assert response.get_json()["milestone"]["version"] == 2
    assert response.get_json()["milestone"]["position"] == 0


# ---------- The public copy ----------


def test_public_milestones_are_the_published_ones_without_editor_fields(client, headers):
    save(client, headers, "wbe-second", {}, published=False)

    response = client.get("/api/public/milestones")

    assert response.status_code == 200
    body = response.get_json()
    assert body["collection_live"] is True
    assert body["skipped"] == []
    ids = [m["id"] for m in body["milestones"]]
    assert ids == ["wbe-first", "bci-sample-thing"]
    first = body["milestones"][0]
    for field in ("published", "version", "position", "updated_by", "updated_by_name", "updated_at", "_id"):
        assert field not in first
    # Claims are written the way content/milestones.json writes them.
    assert first["summary"] == {"text": "What this milestone is about.", "provenance": "team"}
    assert body["milestones"][1]["sample"] is True


def test_a_broken_record_is_skipped_and_so_is_what_depends_on_it(app, client, db):
    db["milestones"].update_one({"_id": "wbe-first"}, {"$set": {"stage": "not-a-stage"}})

    body = client.get("/api/public/milestones").get_json()

    assert [m["id"] for m in body["milestones"]] == ["bci-sample-thing"]
    skipped = {item["id"]: item["problems"] for item in body["skipped"]}
    assert set(skipped) == {"wbe-first", "wbe-second"}
    assert skipped["wbe-second"] == ["depends_on: wbe-first isn't published or was left out"]


def test_collection_live_is_false_until_milestones_are_imported(tmp_path):
    empty = write_content(tmp_path / "empty", sources=SITE_SOURCES)
    app = create_app(make_config(content_dir=empty))
    client = app.test_client()

    body = client.get("/api/public/milestones").get_json()
    assert body["collection_live"] is False
    assert body["milestones"] == []

    headers = bearer(app.extensions["sf_config"])
    client.post("/api/milestones", json={"milestone": valid_milestone("wbe-new")}, headers=headers)
    body = client.get("/api/public/milestones").get_json()
    # Live now, but the only milestone is a draft.
    assert body["collection_live"] is True
    assert body["milestones"] == []


def test_the_real_content_folder_seeds_without_problems():
    app = create_app(make_config())
    client = app.test_client()
    body = client.get("/api/public/milestones").get_json()
    assert body["collection_live"] is True
    assert body["skipped"] == []
    assert len(body["milestones"]) > 0
