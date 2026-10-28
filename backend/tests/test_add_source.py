"""Adding a source by hand (POST /api/sources) and the source catalog (GET /api/sources/catalog)."""

import pytest
from api_helpers import SITE_SOURCES, approve_body, insert_candidate, make_config, write_content


@pytest.fixture
def content_dir(tmp_path):
    sample = dict(SITE_SOURCES[0], id="sample-thing", register_id=None, arxiv_id="2501.00001", sample=True)
    return write_content(tmp_path / "content", milestones=[], sources=SITE_SOURCES + [sample], posts={})


@pytest.fixture
def config(content_dir):
    return make_config(content_dir=content_dir)


def new_source(**overrides) -> dict:
    body = {
        "url": "https://example.org/a-report",
        "title": "Emulation and Its Discontents",
        "authors": ["Ada Author", "  "],
        "year": 2025,
        "source_type": "report",
        "note": "Mentioned at the reading group.",
    }
    body.update(overrides)
    return body


def add(client, headers, **overrides):
    return client.post("/api/sources", json=new_source(**overrides), headers=headers)


def error(response) -> dict:
    return response.get_json()["error"]


def test_a_new_source_waits_for_review_as_added_by_hand(client, db, headers):
    response = add(client, headers)

    assert response.status_code == 201, response.get_json()
    source_id = response.get_json()["id"]
    assert source_id.startswith("manual-emulation-and-its-discontents-")
    stored = db["sources"].find_one({"_id": source_id})
    assert stored["origin"] == "manual"
    assert stored["collector"] == "manual"
    assert stored["review_status"] == "pending_review"
    assert stored["flags"] == ["no_abstract"]
    assert stored["authors"] == ["Ada Author"]
    assert stored["added_by"] == "rae@example.com"
    assert stored["added_by_name"] == "Rae Reviewer"
    assert stored["note"] == "Mentioned at the reading group."
    assert stored["current_assessment_id"] is None

    queue = client.get("/api/queue", headers=headers).get_json()
    assert [item["candidate"]["id"] for item in queue["items"]] == [source_id]


def test_a_source_with_an_abstract_isnt_flagged(client, db, headers):
    response = add(client, headers, abstract="We look at emulation.")
    stored = db["sources"].find_one({"_id": response.get_json()["id"]})
    assert stored["flags"] == []
    assert stored["abstract"] == "We look at emulation."


def test_identifiers_are_normalized_and_read_from_the_link(client, db, headers):
    arxiv = add(client, headers, url="https://arxiv.org/abs/2610.12345v3", title="One")
    doi = add(client, headers, url="https://doi.org/10.1000/ABC.42", title="Two")
    typed = add(client, headers, title="Three", doi="doi:10.1000/XYZ", arxiv_id="arXiv:2610.54321v1")

    assert db["sources"].find_one({"_id": arxiv.get_json()["id"]})["arxiv_id"] == "2610.12345"
    assert db["sources"].find_one({"_id": doi.get_json()["id"]})["doi"] == "10.1000/abc.42"
    stored = db["sources"].find_one({"_id": typed.get_json()["id"]})
    assert (stored["doi"], stored["arxiv_id"]) == ("10.1000/xyz", "2610.54321")


@pytest.mark.parametrize(
    ("overrides", "match"),
    [
        ({"url": "https://arxiv.org/abs/2411.18526v2"}, "arxiv_id"),
        ({"doi": "https://doi.org/10.3389/FHUMD.2023.1245619"}, "doi"),
        ({"title": "NeuroAI for AI safety!", "year": 2024}, "title"),
    ],
)
def test_a_paper_the_site_already_cites_is_409(client, headers, overrides, match):
    response = add(client, headers, **overrides)
    assert response.status_code == 409
    assert error(response)["code"] == "duplicate"
    assert error(response)["details"]["where"] == "site"
    assert error(response)["details"]["match"] == match
    assert error(response)["details"]["existing_id"] in ("s13", "s19")


def test_a_sample_source_never_counts_as_a_duplicate(client, headers):
    assert add(client, headers, url="https://arxiv.org/abs/2501.00001").status_code == 201


def test_a_paper_already_in_the_database_is_409(client, db, headers):
    insert_candidate(db, "arxiv-2610.11111", arxiv_id="2610.11111", status="rejected")
    response = add(client, headers, arxiv_id="2610.11111")
    assert response.status_code == 409
    assert error(response)["details"] == {"existing_id": "arxiv-2610.11111", "match": "arxiv_id", "where": "database"}

    first = add(client, headers, title="A Brand New Paper")
    again = add(client, headers, title="a brand-new paper", url="https://example.org/elsewhere")
    assert again.status_code == 409
    assert error(again)["details"]["existing_id"] == first.get_json()["id"]
    assert error(again)["details"]["match"] == "title"


def test_the_same_title_in_another_year_is_a_different_paper(client, headers):
    add(client, headers, title="Annual Report", year=2024)
    assert add(client, headers, title="Annual Report", year=2025).status_code == 201


def test_bad_fields_are_422_with_every_problem(client, headers):
    response = add(client, headers, url="example.org", title="  ", year=1700, doi="not a doi", arxiv_id="nope")
    assert response.status_code == 422
    assert error(response)["code"] == "invalid_source"
    details = error(response)["details"]
    assert "url: must start with https:// or http://" in details
    assert "title: required" in details
    assert "year: must be between 1800 and 2100" in details
    assert any(line.startswith("doi:") for line in details)
    assert any(line.startswith("arxiv_id:") for line in details)


def test_the_year_is_required_because_the_public_source_needs_one(client, headers):
    response = add(client, headers, year=None)
    assert response.status_code == 422
    assert error(response)["details"][0].startswith("year: required")


def test_a_missing_field_or_unknown_type_is_400(client, headers):
    assert client.post("/api/sources", json={"title": "No url"}, headers=headers).status_code == 400
    assert add(client, headers, source_type="pamphlet").status_code == 400


def test_an_approved_manual_source_is_public_with_whoever_added_it(client, headers):
    source_id = add(client, headers).get_json()["id"]

    response = client.post(f"/api/queue/{source_id}/review", json=approve_body(), headers=headers)

    assert response.status_code == 201, response.get_json()
    assert response.get_json()["publish_problems"] == []
    public = client.get("/api/public/sources").get_json()["sources"]
    assert public[0]["id"] == source_id
    assert public[0]["added_by"] == "Rae Reviewer"
    assert "note" not in public[0]


def test_the_catalog_has_the_site_sources_and_approved_ones(client, db, headers):
    source_id = add(client, headers).get_json()["id"]
    client.post(f"/api/queue/{source_id}/review", json=approve_body(), headers=headers)
    # Approved, but the same paper as s13, so the publish step would leave it out.
    insert_candidate(db, "arxiv-2411.18526", arxiv_id="2411.18526", status="pending_review")
    client.post("/api/queue/arxiv-2411.18526/review", json=approve_body(), headers=headers)

    response = client.get("/api/sources/catalog", headers=headers)

    assert response.status_code == 200
    entries = response.get_json()["sources"]
    assert [entry["id"] for entry in entries] == ["s13", "s19", "sample-thing", source_id]
    assert entries[0] == {
        "id": "s13",
        "register_id": "S13",
        "title": "NeuroAI for AI Safety",
        "authors": ["Patrick Mineault"],
        "year": 2024,
        "url": "https://arxiv.org/abs/2411.18526",
        "sample": False,
        "origin": "site",
    }
    assert entries[2]["sample"] is True
    assert entries[3]["origin"] == "approved"
