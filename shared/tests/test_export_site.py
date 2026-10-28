"""The publish step: content/ plus the API's public routes, written as one data folder and validated."""

import json
import urllib.error
from pathlib import Path

import pytest
from helpers import write_json

from sf_shared import export_site
from sf_shared.export_site import ExportError, api_fetcher, export_site as run_export
from sf_shared.validate import parse_frontmatter

EM_DASH = chr(0x2014)


def api_source(source_id: str, **overrides) -> dict:
    source = {
        "id": source_id,
        "title": f"An approved paper {source_id}",
        "authors": ["Ada Author"],
        "year": 2025,
        "url": f"https://example.org/{source_id}",
        "doi": None,
        "arxiv_id": None,
        "source_type": "preprint",
        "kind": "argument",
        "technology": ["bci"],
        "problem": "alignment",
        "summary": {"text": "Our summary.", "provenance": "team"},
        "ai_suggested_fields": [],
        "added_by": "Rae",
        "reviewed_by": "Rae",
        "reviewed_on": "2026-10-27",
    }
    source.update(overrides)
    return source


def api_post(slug: str, **overrides) -> dict:
    post = {
        "slug": slug,
        "title": "Field notes: *what* we read",
        "date": "2026-10-27",
        "author": "Rae",
        "summary": 'A "quoted" summary: with a colon.',
        "body": "First paragraph.\n\n## A heading\n\nMore.",
    }
    post.update(overrides)
    return post


class FakeApi:
    """Answers the three public routes from dicts, and records what was asked."""

    def __init__(self, sources=None, milestones=None, collection_live=True, posts=None, skipped=None):
        self.answers = {
            "/api/public/sources": {"sources": sources or [], "skipped": skipped or []},
            "/api/public/milestones": {"milestones": milestones or [], "collection_live": collection_live, "skipped": []},
            "/api/public/posts": {"posts": posts or [], "skipped": []},
        }
        self.asked: list[str] = []

    def __call__(self, path: str) -> dict:
        self.asked.append(path)
        return self.answers[path]


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture
def out_dir(tmp_path: Path) -> Path:
    return tmp_path / "site-data"


def test_without_the_api_it_copies_content(content_dir, out_dir):
    lines: list[str] = []
    assert run_export(content_dir, out_dir, None, lines.append) is True

    assert read_json(out_dir / "milestones.json") == read_json(content_dir / "milestones.json")
    assert read_json(out_dir / "sources.json") == read_json(content_dir / "sources.json")
    assert read_json(out_dir / "technologies.json") == read_json(content_dir / "technologies.json")
    assert sorted(path.name for path in (out_dir / "posts").iterdir()) == ["about-this-blog.md"]
    assert lines[-1].startswith("OK:")


def test_approved_sources_are_added_and_repeats_of_content_skipped(content_dir, out_dir):
    content_sources = read_json(content_dir / "sources.json")
    real = [source for source in content_sources if not source.get("sample")]
    with_doi = next(source for source in real if source.get("doi"))
    api = FakeApi(
        sources=[
            api_source("arxiv-2610-00001"),
            api_source("same-doi", doi=with_doi["doi"].upper()),
            api_source("same-title", title=real[0]["title"] + "!", year=real[0]["year"]),
            api_source(real[1]["id"]),
        ],
        skipped=[{"id": "arxiv-bad", "problems": ["year: required"]}],
    )
    lines: list[str] = []

    assert run_export(content_dir, out_dir, api, lines.append) is True

    ids = [source["id"] for source in read_json(out_dir / "sources.json")]
    assert ids == [source["id"] for source in content_sources] + ["arxiv-2610-00001"]
    text = "\n".join(lines)
    assert f"Skipped same-doi from the API: same doi as {with_doi['id']}" in text
    assert f"Skipped same-title from the API: same title as {real[0]['id']}" in text
    assert "content/sources.json already uses that id" in text
    assert "The API left out source arxiv-bad: year: required" in text


def test_milestones_come_from_the_api_once_the_collection_is_live(content_dir, out_dir):
    milestones = read_json(content_dir / "milestones.json")[:2]
    for milestone in milestones:
        milestone["depends_on"] = []
    run_export(content_dir, out_dir, FakeApi(milestones=milestones), print)
    assert read_json(out_dir / "milestones.json") == milestones


def test_milestones_come_from_content_until_the_collection_is_live(content_dir, out_dir):
    lines: list[str] = []
    run_export(content_dir, out_dir, FakeApi(milestones=[], collection_live=False), lines.append)
    assert read_json(out_dir / "milestones.json") == read_json(content_dir / "milestones.json")
    assert any("the database has none yet" in line for line in lines)


def test_published_posts_are_written_with_quoted_frontmatter(content_dir, out_dir):
    assert run_export(content_dir, out_dir, FakeApi(posts=[api_post("field-notes")]), print) is True

    text = (out_dir / "posts" / "field-notes.md").read_text(encoding="utf-8")
    errors: list[str] = []
    parsed = parse_frontmatter(text, "field-notes.md", errors)
    assert errors == []
    assert parsed.values == {
        "title": "Field notes: *what* we read",
        "slug": "field-notes",
        "date": "2026-10-27",
        "author": "Rae",
        "summary": 'A "quoted" summary: with a colon.',
    }
    assert parsed.body.strip() == "First paragraph.\n\n## A heading\n\nMore."
    assert (out_dir / "posts" / "about-this-blog.md").exists()


def test_the_database_post_wins_a_slug_clash(content_dir, out_dir):
    lines: list[str] = []
    api = FakeApi(posts=[api_post("about-this-blog", title="The database's version")])

    assert run_export(content_dir, out_dir, api, lines.append) is True

    assert sorted(path.name for path in (out_dir / "posts").iterdir()) == ["about-this-blog.md"]
    assert "The database's version" in (out_dir / "posts" / "about-this-blog.md").read_text(encoding="utf-8")
    assert any("Warning:" in line and "about-this-blog.md" in line for line in lines)


def test_a_folder_that_doesnt_validate_fails_the_export(content_dir, out_dir):
    milestone = read_json(content_dir / "milestones.json")[0]
    milestone["source_ids"] = ["no-such-source"]
    milestone["depends_on"] = []
    lines: list[str] = []

    assert run_export(content_dir, out_dir, FakeApi(milestones=[milestone]), lines.append) is False

    assert any('no source with id "no-such-source"' in line for line in lines)
    assert lines[-1].startswith("FAILED:")


def test_an_em_dash_from_the_api_fails_the_export(content_dir, out_dir):
    post = api_post("notes", body=f"One {EM_DASH} two.")
    assert run_export(content_dir, out_dir, FakeApi(posts=[post]), print) is False


def test_the_folder_is_emptied_on_every_export(content_dir, out_dir):
    run_export(content_dir, out_dir, FakeApi(posts=[api_post("old-post")]), print)
    run_export(content_dir, out_dir, None, print)
    assert not (out_dir / "posts" / "old-post.md").exists()


def test_a_folder_it_didnt_make_is_never_emptied(content_dir, tmp_path):
    other = tmp_path / "something"
    other.mkdir()
    (other / "keep.txt").write_text("mine", encoding="utf-8")

    with pytest.raises(ExportError):
        run_export(content_dir, other, None, print)
    with pytest.raises(ExportError):
        run_export(content_dir, content_dir, None, print)
    with pytest.raises(ExportError):
        run_export(content_dir, content_dir.parent, None, print)
    assert (other / "keep.txt").exists()


def test_the_api_is_tried_three_times_then_the_export_stops():
    waits: list[float] = []
    calls: list[str] = []

    def unreachable(url: str) -> dict:
        calls.append(url)
        raise urllib.error.URLError("connection refused")

    fetch = api_fetcher("https://api.example.org/", sleep=waits.append, read=unreachable)
    with pytest.raises(ExportError, match="connection refused"):
        fetch("/api/public/sources")
    assert calls == ["https://api.example.org/api/public/sources"] * 3
    assert waits == [5, 10]


def test_a_404_isnt_retried():
    calls: list[str] = []

    def not_found(url: str) -> dict:
        calls.append(url)
        raise urllib.error.HTTPError(url, 404, "Not Found", None, None)

    fetch = api_fetcher("https://api.example.org", sleep=lambda seconds: None, read=not_found)
    with pytest.raises(ExportError, match="HTTP 404"):
        fetch("/api/public/posts")
    assert len(calls) == 1


def test_a_retry_that_works_is_used():
    answers = [urllib.error.URLError("timed out"), {"sources": [], "skipped": []}]

    def flaky(url: str) -> dict:
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    fetch = api_fetcher("https://api.example.org", sleep=lambda seconds: None, read=flaky)
    assert fetch("/api/public/sources") == {"sources": [], "skipped": []}


def test_main_exits_1_on_failure_and_0_on_success(content_dir, tmp_path):
    out = tmp_path / "out"
    assert export_site.main(["export_site", "--content", str(content_dir), "--out", str(out)]) == 0
    write_json(content_dir / "milestones.json", [{"id": "broken"}])
    assert export_site.main(["export_site", "--content", str(content_dir), "--out", str(out)]) == 1
    assert export_site.main(["export_site", "--content", str(tmp_path / "missing"), "--out", str(out)]) == 1
