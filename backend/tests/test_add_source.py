"""Adding a source by hand (POST /api/sources) and the source catalog (GET /api/sources/catalog)."""

import pytest
from api_helpers import SITE_SOURCES, approve_body, insert_candidate, make_config, minutes_ago, write_content


# A site source with only a link to go on, like the LessWrong posts and videos in content/sources.json.
LINK_ONLY = dict(
    SITE_SOURCES[1],
    id="s14",
    register_id="S14",
    title="Brain-Computer Interfaces and AI Alignment",
    year=2021,
    url="https://www.lesswrong.com/posts/rpRsksjrBXEDJuHHy/brain-computer-interfaces-and-ai-alignment",
    doi=None,
)


@pytest.fixture
def content_dir(tmp_path):
    sample = dict(SITE_SOURCES[0], id="sample-thing", register_id=None, arxiv_id="2501.00001", sample=True)
    sources = SITE_SOURCES + [LINK_ONLY, sample]
    return write_content(tmp_path / "content", milestones=[], sources=sources, posts={})


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


def test_a_doi_org_link_with_a_port_is_accepted_without_filling_in_the_doi(client, db, headers):
    # names_its_paper finds the DOI anywhere in a doi.org link, so the link is
    # fine. Only a link that starts with "https://doi.org/" (and the like)
    # fills in the DOI. The "Add a source" page follows both rules
    # (frontend/components/admin/sourceLinks.ts).
    response = add(client, headers, url="https://doi.org:443/10.1000/withport", title="Port")

    assert response.status_code == 201, response.get_json()
    assert db["sources"].find_one({"_id": response.get_json()["id"]})["doi"] is None


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


@pytest.mark.parametrize(
    "url",
    [
        "https://www.lesswrong.com/posts/rpRsksjrBXEDJuHHy/brain-computer-interfaces-and-ai-alignment",
        "http://lesswrong.com/posts/rpRsksjrBXEDJuHHy/brain-computer-interfaces-and-ai-alignment/#comments",
        "https://www.lesswrong.com/posts/rpRsksjrBXEDJuHHy/brain-computer-interfaces-and-ai-alignment?utm_source=x",
    ],
)
def test_the_same_link_as_a_site_source_is_409_whatever_the_title(client, headers, url):
    response = add(client, headers, url=url, title="Some other title", year=2024)
    assert response.status_code == 409
    assert error(response)["details"] == {"existing_id": "s14", "match": "url", "where": "site"}


def test_a_link_already_in_the_database_is_409(client, headers):
    first = add(client, headers, url="https://example.org/papers/one")
    assert first.status_code == 201

    for url in ("https://example.org/papers/one/", "http://www.example.org/papers/one"):
        again = add(client, headers, url=url, title="A second copy")
        assert again.status_code == 409, url
        assert error(again)["details"] == {"existing_id": first.get_json()["id"], "match": "url", "where": "database"}


@pytest.mark.parametrize(
    ("first", "again"),
    [
        ("https://example.org/papers/one", "https://example.org/papers/one?utm_source=twitter"),
        ("https://example.org/papers/one", "https://m.example.org/papers/one#comments"),
        ("https://Example.ORG/papers/one", "https://example.org/papers/one"),
        ("https://www.youtube.com/watch?v=N3151oVuA7M", "https://youtu.be/N3151oVuA7M?t=729"),
    ],
)
def test_a_link_in_the_database_matches_however_its_written(client, headers, first, again):
    # The same normalize.url_key the site check uses.
    created = add(client, headers, url=first)
    assert created.status_code == 201

    response = add(client, headers, url=again, title="A second copy")
    assert response.status_code == 409, again
    assert error(response)["details"] == {"existing_id": created.get_json()["id"], "match": "url", "where": "database"}


def test_another_page_on_the_same_site_isnt_a_match(client, headers):
    assert add(client, headers, url="https://example.org/papers/one").status_code == 201
    assert add(client, headers, url="https://example.org/papers/two", title="Two").status_code == 201
    assert add(client, headers, url="https://example.org.evil.com/papers/one", title="Three").status_code == 201


def test_a_bare_home_page_isnt_a_match(client, headers):
    # A book's site (like ageofem.com) doesn't point at one paper.
    assert add(client, headers, url="https://example.org/", title="One").status_code == 201
    assert add(client, headers, url="https://example.org", title="Two").status_code == 201


def test_a_rejected_paper_can_be_added_again_to_fix_a_typo(client, db, headers):
    # Review can't change the link, title or year, so a typo is fixed by rejecting and adding again.
    insert_candidate(
        db, "manual-typo", status="rejected", url="https://example.org/papr", title="Typo Paper", title_key="typo paper"
    )
    assert add(client, headers, url="https://example.org/paper", title="Typo Paper").status_code == 201
    assert add(client, headers, url="https://example.org/papr", title="Typo Paper, take two").status_code == 201


def test_adding_a_rejected_paper_again_unchanged_is_409(client, db, headers):
    # The same paper found again. Leaving an optional field empty doesn't count as a change.
    insert_candidate(
        db,
        "manual-rejected",
        status="rejected",
        origin="manual",
        collector="manual",
        url="https://example.org/a-report",
        title="Emulation and Its Discontents",
        title_key="emulation and its discontents",
        authors=["Ada Author"],
    )
    for overrides in ({}, {"authors": []}, {"url": "http://www.example.org/a-report/"}):
        response = add(client, headers, **overrides)
        assert response.status_code == 409, overrides
        assert error(response)["details"] == {"existing_id": "manual-rejected", "match": "url", "where": "database"}


def test_a_rejected_paper_with_a_doi_can_be_fixed_by_adding_it_again(client, db, headers):
    # The DOI can't go on a second paper, so the rejected one comes back with the new details.
    typo = add(client, headers, url="https://exmaple.org/paper", doi="10.5555/fixme", abstract="About emulation.")
    source_id = typo.get_json()["id"]
    rejection = {"decision": "reject", "reject_reason": "low_quality", "notes": "The link is wrong."}
    assert client.post(f"/api/queue/{source_id}/review", json=rejection, headers=headers).status_code == 201

    fixed = add(client, headers, url="https://example.org/paper", doi="10.5555/fixme")

    assert fixed.status_code == 200, fixed.get_json()
    assert fixed.get_json()["id"] == source_id
    stored = db["sources"].find_one({"_id": source_id})
    assert stored["url"] == "https://example.org/paper"
    assert stored["doi"] == "10.5555/fixme"
    assert stored["review_status"] == "pending_review"
    assert stored["current_review_id"] is None
    assert stored["abstract"] is None
    assert stored["flags"] == ["no_abstract"]
    assert db["sources"].count_documents({"doi": "10.5555/fixme"}) == 1
    # The rejection stays in its record, after a note that it was added again.
    detail = client.get(f"/api/queue/{source_id}", headers=headers).get_json()
    assert [review["decision"] for review in detail["reviews"]] == ["reject"]
    assert len(detail["re_adds"]) == 1
    assert detail["re_adds"][0]["changed"] == ["url"]
    queue = client.get("/api/queue", headers=headers).get_json()
    assert [item["candidate"]["id"] for item in queue["items"]] == [source_id]

    # Adding it again now is an ordinary duplicate.
    again = add(client, headers, url="https://example.org/paper", doi="10.5555/fixme", title="Something else")
    assert again.status_code == 409
    assert error(again)["details"] == {"existing_id": source_id, "match": "doi", "where": "database"}


def reject(client, headers, source_id: str) -> None:
    rejection = {"decision": "reject", "reject_reason": "low_quality", "notes": "Some details are wrong."}
    assert client.post(f"/api/queue/{source_id}/review", json=rejection, headers=headers).status_code == 201


def test_adding_a_rejected_paper_again_records_who_when_and_what_changed(client, db, headers):
    typo = add(client, headers, url="https://exmaple.org/paper", title="Emulaton", year=2024, doi="10.5555/fixme")
    source_id = typo.get_json()["id"]
    reject(client, headers, source_id)

    fixed = add(client, headers, url="https://example.org/paper", title="Emulation", year=2025, doi="10.5555/fixme")

    assert fixed.status_code == 200
    stored = db["re_adds"].find_one({"source_id": source_id})
    assert stored["added_by"] == "rae@example.com"
    assert stored["added_by_name"] == "Rae Reviewer"
    assert stored["changed"] == ["url", "title", "year"]
    rejection = db["reviews"].find_one({"source_id": source_id})
    assert stored["added_at"] >= rejection["created_at"]

    re_add = client.get(f"/api/queue/{source_id}", headers=headers).get_json()["re_adds"][0]
    assert re_add["source_id"] == source_id
    assert re_add["added_by_name"] == "Rae Reviewer"
    assert re_add["added_at"].endswith("Z")
    assert re_add["changed"] == ["url", "title", "year"]


def test_a_re_add_that_changes_none_of_the_link_title_or_year_says_so(client, db, headers):
    first = add(client, headers, doi="10.5555/authors", authors=["Ada Autor"])
    source_id = first.get_json()["id"]
    reject(client, headers, source_id)

    # Only the authors change, so the paper comes back with nothing in changed.
    assert add(client, headers, doi="10.5555/authors", authors=["Ada Author"]).status_code == 200
    assert db["re_adds"].find_one({"source_id": source_id})["changed"] == []


def test_every_re_add_is_kept_newest_first(client, db, headers):
    first = add(client, headers, url="https://example.org/one", doi="10.5555/twice")
    source_id = first.get_json()["id"]
    reject(client, headers, source_id)
    add(client, headers, url="https://example.org/two", doi="10.5555/twice")
    # The database keeps milliseconds, so set the first one apart.
    db["re_adds"].update_many({}, {"$set": {"added_at": minutes_ago(5)}})
    reject(client, headers, source_id)
    add(client, headers, url="https://example.org/two", title="A Better Title", doi="10.5555/twice")

    detail = client.get(f"/api/queue/{source_id}", headers=headers).get_json()
    assert [re_add["changed"] for re_add in detail["re_adds"]] == [["title"], ["url"]]
    assert len(detail["reviews"]) == 2


def test_a_paper_never_added_again_has_no_re_adds(client, headers):
    source_id = add(client, headers).get_json()["id"]
    assert client.get(f"/api/queue/{source_id}", headers=headers).get_json()["re_adds"] == []


def test_a_rejected_paper_with_a_doi_added_again_unchanged_is_409(client, db, headers):
    insert_candidate(
        db,
        "manual-doi",
        status="rejected",
        origin="manual",
        collector="manual",
        doi="10.5555/same",
        url="https://example.org/a-report",
        title="Emulation and Its Discontents",
        title_key="emulation and its discontents",
        authors=["Ada Author"],
    )
    response = add(client, headers, doi="10.5555/same")
    assert response.status_code == 409
    assert error(response)["details"] == {"existing_id": "manual-doi", "match": "doi", "where": "database"}
    assert db["sources"].find_one({"_id": "manual-doi"})["review_status"] == "rejected"
    assert db["re_adds"].count_documents({}) == 0


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
    add(client, headers, title="Annual Report", year=2024, url="https://example.org/report-2024")
    second = add(client, headers, title="Annual Report", year=2025, url="https://example.org/report-2025")
    assert second.status_code == 201


def test_bad_fields_are_422_with_every_problem(client, headers):
    response = add(client, headers, url="example.org", title="  ", year=1700, doi="not a doi", arxiv_id="nope")
    assert response.status_code == 422
    assert error(response)["code"] == "invalid_source"
    details = error(response)["details"]
    assert "url: must start with https:// or http://" in details
    assert "title: required" in details
    assert "year: must be between 1800 and 2100" in details
    # The hints above the fields give the format, so the errors don't repeat it.
    assert "doi: That doesn't look like a DOI." in details
    assert "arxiv_id: That doesn't look like an arXiv id." in details


@pytest.mark.parametrize(
    "url",
    [
        "https://",
        "https://doi.org10.1234",
        "https://exa mple.com/paper",
        "http://:80",
        "https://localhost/paper",
        # A doi.org or arXiv link with no paper in it opens an error page
        "https://arxiv.org/abs/",
        "https://arxiv.org/pdf/",
        "https://doi.org/",
        "https://doi.org/10.",
    ],
)
def test_a_broken_link_is_422(client, headers, url):
    response = add(client, headers, url=url)
    assert response.status_code == 422
    assert error(response)["details"] == ["url: looks incomplete. Copy it from the browser's address bar"]


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
    assert [entry["id"] for entry in entries] == ["s13", "s19", "s14", "sample-thing", source_id]
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
    assert entries[3]["sample"] is True
    assert entries[4]["origin"] == "approved"
