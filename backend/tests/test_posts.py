"""The blog post editor: list, create, save with a version check, renaming drafts, and the public copy."""

import pytest
from api_helpers import POST_TEXT, SAMPLE_POST_TEXT, SITE_SOURCES, make_config, write_content

EM_DASH = chr(0x2014)


@pytest.fixture
def content_dir(tmp_path):
    posts = {"about-this-blog.md": POST_TEXT, "sample-post.md": SAMPLE_POST_TEXT}
    return write_content(tmp_path / "content", milestones=[], sources=SITE_SOURCES, posts=posts)


@pytest.fixture
def config(content_dir):
    return make_config(content_dir=content_dir)


def draft(**overrides) -> dict:
    body = {
        "slug": "field-notes",
        "title": "Field notes",
        "date": "2026-10-27",
        "author": "Raghav",
        "summary": "What we read this week.",
        "body": "A first paragraph.\n\nA second one.",
    }
    body.update(overrides)
    return body


def create(client, headers, **overrides):
    return client.post("/api/posts", json=draft(**overrides), headers=headers)


def error(response) -> dict:
    return response.get_json()["error"]


def test_an_in_memory_database_starts_with_the_content_posts_except_samples(client, headers):
    posts = client.get("/api/posts", headers=headers).get_json()["posts"]

    assert [post["slug"] for post in posts] == ["about-this-blog"]
    post = posts[0]
    assert post["status"] == "published"
    assert post["title"] == "About *this blog*"
    assert post["date"] == "2026-10-26"
    assert post["body"] == "Posts here are looser than the rest of the site."
    assert post["version"] == 1
    assert post["published_at"] is not None


def test_a_new_post_is_a_draft_by_default(client, headers):
    response = create(client, headers)

    assert response.status_code == 201, response.get_json()
    post = response.get_json()["post"]
    assert post["status"] == "draft"
    assert post["published_at"] is None
    assert post["version"] == 1
    assert post["updated_by_name"] == "Rae Reviewer"
    assert client.get("/api/posts/field-notes", headers=headers).get_json()["post"]["title"] == "Field notes"


def test_a_taken_slug_is_409(client, headers):
    response = create(client, headers, slug="about-this-blog")
    assert response.status_code == 409
    assert error(response)["code"] == "slug_taken"


def test_an_invalid_post_is_422_with_every_problem(client, headers):
    response = create(client, headers, slug="Not A Slug", date="27 October", summary="", body=" ")

    assert response.status_code == 422
    assert error(response)["code"] == "invalid_post"
    details = error(response)["details"]
    assert any(line.startswith("slug: must be lowercase") for line in details)
    assert any(line.startswith("date: must be a date written YYYY-MM-DD") for line in details)
    assert any(line.startswith("summary: must not be empty") for line in details)
    assert "body: the post has no text yet" in details


def test_em_dashes_are_refused_with_the_line(client, headers):
    response = create(client, headers, title=f"One {EM_DASH} two", body=f"Fine.\nNot {EM_DASH} fine.")
    assert response.status_code == 422
    details = error(response)["details"]
    assert details[0].startswith("title: has an em dash")
    assert details[1].startswith("body: has an em dash (line 2)")


def test_saving_needs_the_version_and_bumps_it(client, headers):
    create(client, headers)

    missing = client.put("/api/posts/field-notes", json=draft(title="New title"), headers=headers)
    assert missing.status_code == 400
    assert error(missing)["code"] == "version_required"

    saved = client.put("/api/posts/field-notes", json=draft(title="New title", version=1), headers=headers)
    assert saved.status_code == 200, saved.get_json()
    assert saved.get_json()["post"]["version"] == 2
    assert saved.get_json()["post"]["title"] == "New title"

    stale = client.put("/api/posts/field-notes", json=draft(title="Older", version=1), headers=headers)
    assert stale.status_code == 409
    assert error(stale)["code"] == "version_conflict"
    assert error(stale)["details"]["current_version"] == 2


def test_marking_published_sets_published_at_once(client, headers):
    create(client, headers)
    published = client.put("/api/posts/field-notes", json=draft(status="published", version=1), headers=headers)
    first_time = published.get_json()["post"]["published_at"]
    assert first_time is not None

    back_to_draft = client.put("/api/posts/field-notes", json=draft(status="draft", version=2), headers=headers)
    assert back_to_draft.get_json()["post"]["published_at"] == first_time


def test_a_draft_can_be_renamed(client, db, headers):
    create(client, headers)

    response = client.put("/api/posts/field-notes", json=draft(slug="field-notes-1", version=1), headers=headers)

    assert response.status_code == 200, response.get_json()
    assert response.get_json()["post"]["slug"] == "field-notes-1"
    assert client.get("/api/posts/field-notes", headers=headers).status_code == 404
    assert client.get("/api/posts/field-notes-1", headers=headers).status_code == 200
    revision = db["post_revisions"].find_one({"post_slug": "field-notes-1"})
    assert revision["previous_slug"] == "field-notes"


def test_renaming_to_a_taken_slug_is_409_and_changes_nothing(client, headers):
    create(client, headers)
    response = client.put("/api/posts/field-notes", json=draft(slug="about-this-blog", version=1), headers=headers)
    assert response.status_code == 409
    assert client.get("/api/posts/field-notes", headers=headers).status_code == 200


def test_the_slug_is_fixed_once_published(client, headers):
    response = client.put(
        "/api/posts/about-this-blog",
        json=draft(slug="about-the-blog", status="published", version=1),
        headers=headers,
    )
    assert response.status_code == 422
    assert error(response)["details"][0].startswith("slug: can't change once the post has been published")


def test_the_nested_shape_and_server_fields_are_accepted(client, headers):
    record = client.get("/api/posts/about-this-blog", headers=headers).get_json()["post"]
    record["title"] = "About this blog"
    response = client.put("/api/posts/about-this-blog", json={"post": record, "version": 1}, headers=headers)
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["post"]["title"] == "About this blog"


def test_public_posts_are_the_published_ones(client, headers):
    create(client, headers)

    body = client.get("/api/public/posts").get_json()

    assert [post["slug"] for post in body["posts"]] == ["about-this-blog"]
    assert set(body["posts"][0]) == {"slug", "title", "date", "author", "summary", "body"}
    assert body["skipped"] == []


def test_a_published_post_that_breaks_a_rule_is_skipped(client, db):
    db["posts"].update_one({"_id": "about-this-blog"}, {"$set": {"summary": f"A {EM_DASH} B"}})
    body = client.get("/api/public/posts").get_json()
    assert body["posts"] == []
    assert body["skipped"][0]["slug"] == "about-this-blog"
    assert body["skipped"][0]["problems"][0].startswith("summary: has an em dash")


def test_an_unknown_post_is_404(client, headers):
    assert client.get("/api/posts/nope", headers=headers).status_code == 404
    assert client.put("/api/posts/nope", json=draft(version=1), headers=headers).status_code == 404
