"""The flask --app sf_api commands: users, seed-config, content import and export, and sources."""

import json

from api_helpers import (
    POST_TEXT,
    REVIEWER_EMAIL,
    SAMPLE_POST_TEXT,
    SITE_SOURCES,
    bearer,
    insert_candidate,
    make_config,
    valid_milestone,
    write_content,
)

from sf_api import create_app
from sf_api.config import DEFAULT_CONTENT_DIR as REPO_CONTENT
from sf_shared.models import Milestone


def run(app, *args: str):
    return app.test_cli_runner().invoke(args=list(args))


def test_users_add_lowercases_the_email_and_lets_them_sign_in(app, client, db):
    result = run(app, "users", "add", "New.Person@Example.com", "New Person")

    assert result.exit_code == 0, result.output
    user = db["users"].find_one({"_id": "new.person@example.com"})
    assert user["display_name"] == "New Person"
    assert user["active"] is True
    headers = bearer(app.extensions["sf_config"], "new.person@example.com")
    assert client.get("/api/auth/me", headers=headers).status_code == 200


def test_users_add_checks_its_arguments(app):
    assert run(app, "users", "add", "not-an-email", "Name").exit_code != 0
    assert run(app, "users", "add", "a@example.com", "  ").exit_code != 0


def test_users_list_shows_everyone(app):
    result = run(app, "users", "list")
    assert result.exit_code == 0
    assert REVIEWER_EMAIL in result.output
    assert "active" in result.output


def test_users_remove_locks_them_out_at_once(app, client, headers):
    assert client.get("/api/auth/me", headers=headers).status_code == 200

    result = run(app, "users", "remove", REVIEWER_EMAIL.upper())

    assert result.exit_code == 0, result.output
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert "removed" in run(app, "users", "list").output


def test_users_remove_someone_not_on_the_list_fails(app):
    result = run(app, "users", "remove", "nobody@example.com")
    assert result.exit_code != 0
    assert "isn't on the team list" in result.output


def test_users_add_brings_a_removed_user_back(app, db):
    run(app, "users", "remove", REVIEWER_EMAIL)
    run(app, "users", "add", REVIEWER_EMAIL, "Rae Again")
    user = db["users"].find_one({"_id": REVIEWER_EMAIL})
    assert user["active"] is True
    assert user["display_name"] == "Rae Again"


def test_seed_config_keeps_a_saved_config_unless_told_to_replace(app, db):
    db["search_config"].update_one({"_id": "default"}, {"$set": {"lookback_days": 99}})

    kept = run(app, "seed-config")
    assert kept.exit_code == 0
    assert "kept" in kept.output
    assert db["search_config"].find_one({"_id": "default"})["lookback_days"] == 99

    replaced = run(app, "seed-config", "--replace")
    assert replaced.exit_code == 0
    assert db["search_config"].find_one({"_id": "default"})["lookback_days"] == 14


def test_commands_warn_about_an_in_memory_database(app):
    result = run(app, "users", "add", "a@example.com", "A")
    assert "in-memory" in result.output


# ---------- content import and export, sources flag-missing-abstracts ----------


def editor_app(tmp_path, milestones=None, posts=None):
    """An app whose in-memory database starts empty (its content folder has nothing to seed)."""
    content_dir = write_content(tmp_path / "seed", sources=SITE_SOURCES)
    files = write_content(tmp_path / "files", milestones=milestones or [], posts=posts or {})
    return create_app(make_config(content_dir=content_dir)), files


def test_import_milestones_saves_each_as_published_with_a_revision(tmp_path):
    milestones = [valid_milestone("wbe-a"), valid_milestone("wbe-b", depends_on=["wbe-a"]), valid_milestone("bci-sample-c", sample=True)]
    app, files = editor_app(tmp_path, milestones=milestones)
    db = app.extensions["sf_db"]

    result = run(app, "content", "import-milestones", str(files / "milestones.json"))

    assert result.exit_code == 0, result.output
    assert "Added 3 milestones" in result.output
    stored = list(db["milestones"].find().sort("position", 1))
    assert [m["_id"] for m in stored] == ["wbe-a", "wbe-b", "bci-sample-c"]
    assert all(m["published"] for m in stored)
    assert stored[2]["sample"] is True
    assert db["milestone_revisions"].count_documents({"action": "import"}) == 3


def test_import_milestones_keeps_what_is_there_unless_told_to_replace(tmp_path):
    app, files = editor_app(tmp_path, milestones=[valid_milestone("wbe-a")])
    db = app.extensions["sf_db"]
    run(app, "content", "import-milestones", str(files / "milestones.json"))
    db["milestones"].update_one({"_id": "wbe-a"}, {"$set": {"name": "Edited in admin"}})

    kept = run(app, "content", "import-milestones", str(files / "milestones.json"))
    assert "kept 1" in kept.output
    assert db["milestones"].find_one({"_id": "wbe-a"})["name"] == "Edited in admin"

    replaced = run(app, "content", "import-milestones", str(files / "milestones.json"), "--replace")
    assert "replaced 1" in replaced.output
    stored = db["milestones"].find_one({"_id": "wbe-a"})
    assert stored["name"] == "Milestone wbe-a"
    assert stored["version"] == 2


def test_import_milestones_imports_nothing_from_an_invalid_file(tmp_path):
    milestones = [valid_milestone("wbe-a"), valid_milestone("wbe-b", depends_on=["wbe-nope"], source_ids=["s404"])]
    app, files = editor_app(tmp_path, milestones=milestones)

    result = run(app, "content", "import-milestones", str(files / "milestones.json"))

    assert result.exit_code != 0
    assert 'milestones[1] (wbe-b).depends_on[0]: no milestone with id "wbe-nope"' in result.output
    assert 'no source with id "s404"' in result.output
    assert app.extensions["sf_db"]["milestones"].count_documents({}) == 0


def test_export_milestones_writes_the_published_ones_like_the_content_file(tmp_path):
    app, files = editor_app(tmp_path, milestones=[valid_milestone("wbe-a"), valid_milestone("wbe-b")])
    db = app.extensions["sf_db"]
    run(app, "content", "import-milestones", str(files / "milestones.json"))
    db["milestones"].update_one({"_id": "wbe-b"}, {"$set": {"published": False}})

    out = tmp_path / "out"
    result = run(app, "content", "export-milestones", "--out", str(out))

    assert result.exit_code == 0, result.output
    written = json.loads((out / "milestones.json").read_text(encoding="utf-8"))
    assert written == [valid_milestone("wbe-a")]


def test_the_real_milestones_file_survives_an_import_and_export(tmp_path):
    app = create_app(make_config())  # seeded from the repo's content/
    out = tmp_path / "out"
    run(app, "content", "export-milestones", "--out", str(out))
    original = json.loads((REPO_CONTENT / "milestones.json").read_text(encoding="utf-8"))
    exported = json.loads((out / "milestones.json").read_text(encoding="utf-8"))
    assert [m["id"] for m in exported] == [m["id"] for m in original]
    for before, after in zip(original, exported, strict=True):
        assert Milestone.model_validate(before) == Milestone.model_validate(after)


def test_import_posts_skips_samples(tmp_path):
    app, files = editor_app(tmp_path, posts={"about-this-blog.md": POST_TEXT, "sample-post.md": SAMPLE_POST_TEXT})

    result = run(app, "content", "import-posts", str(files / "posts"))

    assert result.exit_code == 0, result.output
    assert "Added 1 posts" in result.output
    posts = list(app.extensions["sf_db"]["posts"].find())
    assert [post["_id"] for post in posts] == ["about-this-blog"]
    assert posts[0]["status"] == "published"


def test_import_posts_reports_a_broken_post(tmp_path):
    broken = POST_TEXT.replace('date: "2026-10-26"', "date: 2026-10-26")
    app, files = editor_app(tmp_path, posts={"about-this-blog.md": broken})

    result = run(app, "content", "import-posts", str(files / "posts"))

    assert result.exit_code != 0
    assert 'date: put the value in double quotes' in result.output


def test_flag_missing_abstracts_only_touches_new_sources(app, db):
    insert_candidate(db, "arxiv-new-none", status="new", abstract=None)
    insert_candidate(db, "arxiv-new-has", status="new")
    insert_candidate(db, "arxiv-decided", status="approved", abstract=None)

    result = run(app, "sources", "flag-missing-abstracts")

    assert result.exit_code == 0, result.output
    assert "Flagged 1 sources" in result.output
    assert db["sources"].find_one({"_id": "arxiv-new-none"})["flags"] == ["no_abstract"]
    assert db["sources"].find_one({"_id": "arxiv-new-has"})["flags"] == []
    assert db["sources"].find_one({"_id": "arxiv-decided"})["flags"] == []
    assert "Flagged 0 sources" in run(app, "sources", "flag-missing-abstracts").output
