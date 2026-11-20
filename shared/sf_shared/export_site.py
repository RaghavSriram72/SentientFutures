"""Build the data folder the public site is built from, then check it.

Run from the repo root:

    python -m sf_shared.export_site --content content/ --api https://<the API> --out .site-data/

then build the site from that folder (in frontend/): DATA_DIR=../.site-data npm run build

The folder has the same layout as content/, so frontend/lib/data.ts reads
either one:

    technologies.json  content/technologies.json, minus any scorecard link to a
                       milestone that isn't in the milestones.json below (one
                       unpublished in admin, say). Each dropped link is printed.
                       Technology pages are edited in git, on purpose (see
                       content/README.md).
    sources.json       content/sources.json plus the approved sources from
                       GET /api/public/sources. An API source that repeats one
                       in content/ (same DOI, arXiv id or title) is skipped,
                       and the skip is printed.
    milestones.json    from GET /api/public/milestones once the milestones have
                       been imported into the database (the API answers
                       "collection_live": true). Until then, content/milestones.json.
    posts/*.md         content/posts/ plus the published posts from
                       GET /api/public/posts. When both have a post with the
                       same slug, the database's version wins, with a warning.
    scorecard.json     content/scorecard.json as it is: the workbook's shared
                       tables, written by python -m sf_shared.import_workbook.
                       It names workbook milestone rows ("BCI-M1"), never
                       timeline milestone ids, so nothing in it depends on
                       what admin has published.

The folder is then checked with the same validator as content/ (validate.py).
Any problem exits with status 1, so the deploy stops and GitHub Pages keeps
serving the last good site. An API that can't be reached after 3 tries does
the same.

Without --api it only copies content/, so CI and local builds work as before.
HTTP goes through the standard library (urllib), so the deploy workflow only
needs shared/ installed.
"""

import argparse
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

from sf_shared.source_match import index_sources
from sf_shared.validate import parse_frontmatter, validate_content

API_ATTEMPTS = 3
API_TIMEOUT_SECONDS = 30
RETRY_WAIT_SECONDS = 5  # times the attempt number: 5 seconds, then 10

# Written into every folder this script makes. The folder is emptied at the
# start of each export, and the marker keeps a mistyped --out (content/, say)
# from being emptied.
MARKER_FILE = ".made-by-export-site"

# fetch(path) -> the API's JSON answer for that path, e.g. fetch("/api/public/posts")
Fetch = Callable[[str], dict]
Say = Callable[[str], None]


class ExportError(Exception):
    """The export can't go on. The message says why."""


# ---------- Reading the API ----------


def read_url(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "sentient-futures-export-site"},
    )
    with urllib.request.urlopen(request, timeout=API_TIMEOUT_SECONDS) as response:
        data = json.loads(response.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise ExportError(f"{url} didn't answer with a JSON object.")
    return data


def api_fetcher(api: str, sleep: Callable[[float], None] = time.sleep, read: Callable[[str], dict] = read_url) -> Fetch:
    """A fetch function for this API that tries each request up to 3 times."""
    base = api.rstrip("/")

    def fetch(path: str) -> dict:
        url = base + path
        problem = ""
        for attempt in range(1, API_ATTEMPTS + 1):
            try:
                return read(url)
            except urllib.error.HTTPError as error:
                problem = f"HTTP {error.code}"
                # A 4xx (other than 429) won't change on a retry.
                if error.code < 500 and error.code != 429:
                    break
            except (urllib.error.URLError, OSError) as error:
                problem = str(getattr(error, "reason", error))
            except json.JSONDecodeError:
                problem = "the answer wasn't JSON"
            if attempt < API_ATTEMPTS:
                sleep(RETRY_WAIT_SECONDS * attempt)
        raise ExportError(f"Couldn't read {url} ({problem}). Nothing was published.")

    return fetch


def list_from(data: dict, key: str, path: str) -> list:
    value = data.get(key)
    if not isinstance(value, list):
        raise ExportError(f'{path} answered without a "{key}" list.')
    return value


def say_skipped(data: dict, what: str, say: Say) -> None:
    """Print the API's own list of records it left out, and why."""
    for item in data.get("skipped", []):
        record_id = item.get("id") or item.get("slug") or "?"
        problems = "; ".join(item.get("problems", []))
        say(f"  The API left out {what} {record_id}: {problems}")


# ---------- The output folder ----------


def prepare_out_dir(out_dir: Path, content_dir: Path) -> None:
    """Empty the folder (or make it), refusing anything that isn't an earlier export."""
    if out_dir.resolve() == content_dir.resolve() or content_dir.resolve().is_relative_to(out_dir.resolve()):
        raise ExportError(f"--out {out_dir} would overwrite the content folder. Use a folder of its own, like .site-data/")
    if out_dir.exists():
        has_files = any(out_dir.iterdir())
        if has_files and not (out_dir / MARKER_FILE).exists():
            raise ExportError(
                f"{out_dir} already has files that this script didn't write, so it wasn't emptied. "
                "Pick another --out folder, or delete this one first."
            )
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    (out_dir / MARKER_FILE).write_text("Made by python -m sf_shared.export_site. Emptied on every export.\n", encoding="utf-8")


def write_json(path: Path, records: list) -> None:
    path.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json_list(path: Path) -> list:
    if not path.exists():
        raise ExportError(f"{path} is missing.")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ExportError(f"{path} should be a list of records.")
    return data


# ---------- Each part ----------


def export_sources(content_dir: Path, out_dir: Path, fetch: Fetch | None, say: Say) -> None:
    content_sources = read_json_list(content_dir / "sources.json")
    sources = list(content_sources)
    from_api = 0
    if fetch is not None:
        data = fetch("/api/public/sources")
        say_skipped(data, "source", say)
        known = index_sources(content_sources)
        content_ids = set()
        for source in content_sources:
            content_ids.add(source.get("id"))
        for source in list_from(data, "sources", "/api/public/sources"):
            match = known.find(source)
            if match is not None:
                say(f"  Skipped {source.get('id')} from the API: same {match.field} as {match.id} in content/sources.json.")
                continue
            if source.get("id") in content_ids:
                say(f"  Skipped {source.get('id')} from the API: content/sources.json already uses that id.")
                continue
            sources.append(source)
            from_api += 1
    write_json(out_dir / "sources.json", sources)
    say(f"Sources: {len(sources)} ({from_api} approved in admin).")


def export_milestones(content_dir: Path, out_dir: Path, fetch: Fetch | None, say: Say) -> None:
    if fetch is not None:
        data = fetch("/api/public/milestones")
        if data.get("collection_live") is True:
            milestones = list_from(data, "milestones", "/api/public/milestones")
            say_skipped(data, "milestone", say)
            write_json(out_dir / "milestones.json", milestones)
            say(f"Milestones: {len(milestones)} published, from the database.")
            return
        say("Milestones: the database has none yet, so content/milestones.json is used.")
    milestones = read_json_list(content_dir / "milestones.json")
    write_json(out_dir / "milestones.json", milestones)
    say(f"Milestones: {len(milestones)}, from content/milestones.json.")


def export_technologies(content_dir: Path, out_dir: Path, milestones_path: Path, say: Say) -> None:
    """Copy the technology pages, leaving out each scorecard row's links to
    milestones that aren't published. The API only answers with published
    milestones, so without this, unpublishing one in admin would fail the
    deploy. CI still checks every link in content/ strictly."""
    pages = read_json_list(content_dir / "technologies.json")
    published_ids = set()
    for milestone in read_json_list(milestones_path):
        if isinstance(milestone, dict):
            published_ids.add(milestone.get("id"))

    for page_index, page in enumerate(pages):
        if not isinstance(page, dict) or not isinstance(page.get("scorecard"), list):
            continue  # the validator reports it
        page_label = f"technologies[{page_index}] ({page.get('id')})"
        for row_index, row in enumerate(page["scorecard"]):
            tracker = row.get("tracker") if isinstance(row, dict) else None
            if not isinstance(tracker, dict) or not isinstance(tracker.get("milestone_ids"), list):
                continue
            kept = []
            for milestone_id in tracker["milestone_ids"]:
                # Anything that isn't a string is kept for the validator to report.
                if not isinstance(milestone_id, str) or milestone_id in published_ids:
                    kept.append(milestone_id)
                else:
                    say(
                        f"  Left out the link from {page_label}.scorecard[{row_index}] to milestone "
                        f'"{milestone_id}": it isn\'t published.'
                    )
            tracker["milestone_ids"] = kept
    write_json(out_dir / "technologies.json", pages)


def export_scorecard(content_dir: Path, out_dir: Path, say: Say) -> None:
    """Copy scorecard.json byte for byte. The validator checks it in the new folder."""
    path = content_dir / "scorecard.json"
    if not path.exists():
        raise ExportError(f"{path} is missing. Run python -m sf_shared.import_workbook first.")
    shutil.copyfile(path, out_dir / "scorecard.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = None  # the validator reports it, with the line number
    entries = data.get("entries") if isinstance(data, dict) else None
    count = len(entries) if isinstance(entries, list) else 0
    say(f"Scorecard: {count} evidence entries, from content/scorecard.json.")


def yaml_text(value: object) -> str:
    """A frontmatter value as a double-quoted string. A JSON string is valid YAML,
    and quoting keeps a date like 2026-10-26 a string for gray-matter."""
    return json.dumps(str(value), ensure_ascii=False)


def render_post(post: dict) -> str:
    lines = ["---"]
    for key in ("title", "slug", "date", "author", "summary"):
        lines.append(f"{key}: {yaml_text(post.get(key, ''))}")
    lines.append("---")
    lines.append("")
    body = str(post.get("body", "")).strip("\n")
    return "\n".join(lines) + "\n" + body + "\n"


def content_post_slug(path: Path) -> str:
    """The slug in a content post's frontmatter, or the file name when it can't be read
    (the validator reports the problem later)."""
    parsed = parse_frontmatter(path.read_text(encoding="utf-8"), str(path), [])
    if parsed is not None and isinstance(parsed.values.get("slug"), str):
        return str(parsed.values["slug"])
    return path.stem


def export_posts(content_dir: Path, out_dir: Path, fetch: Fetch | None, say: Say) -> None:
    posts_dir = out_dir / "posts"
    posts_dir.mkdir()

    database_posts: list = []
    if fetch is not None:
        data = fetch("/api/public/posts")
        say_skipped(data, "post", say)
        database_posts = list_from(data, "posts", "/api/public/posts")
    database_slugs = set()
    for post in database_posts:
        database_slugs.add(str(post.get("slug")))

    copied = 0
    content_posts = content_dir / "posts"
    if content_posts.is_dir():
        for path in sorted(content_posts.glob("*.md")):
            slug = content_post_slug(path)
            if slug in database_slugs or path.stem in database_slugs:
                say(f"  Warning: {path} has the same slug as a post in the database. The database's version is used.")
                continue
            shutil.copyfile(path, posts_dir / path.name)
            copied += 1

    for post in database_posts:
        (posts_dir / f"{post.get('slug')}.md").write_text(render_post(post), encoding="utf-8")
    say(f"Posts: {copied + len(database_posts)} ({len(database_posts)} from the database).")


# ---------- Putting it together ----------


def export_site(content_dir: Path, out_dir: Path, fetch: Fetch | None = None, say: Say = print) -> bool:
    """Write the folder and check it. Returns True when it's ready to build from.

    Raises ExportError when it can't be written at all (the API is down, say).
    """
    prepare_out_dir(out_dir, content_dir)
    export_sources(content_dir, out_dir, fetch, say)
    export_milestones(content_dir, out_dir, fetch, say)
    # After the milestones, so it knows which ones are published.
    export_technologies(content_dir, out_dir, out_dir / "milestones.json", say)
    export_scorecard(content_dir, out_dir, say)
    export_posts(content_dir, out_dir, fetch, say)

    report = validate_content(out_dir)
    for line in report.errors:
        say(line)
    for line in report.warnings:
        say(line)
    if not report.ok:
        say(f"FAILED: {len(report.errors)} problems in {out_dir}. Fix them before publishing.")
        return False
    say(f"OK: {out_dir} is ready. Build with DATA_DIR={out_dir}")
    return True


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Build the public site's data folder from content/ and the API.")
    parser.add_argument("--content", default="content", help="the content/ folder (default: content)")
    parser.add_argument("--api", default=None, help="the API's address, e.g. https://api.example.org (optional)")
    parser.add_argument("--out", default=".site-data", help="the folder to write (default: .site-data)")
    args = parser.parse_args(argv[1:])

    content_dir = Path(args.content)
    out_dir = Path(args.out)
    if not content_dir.is_dir():
        print(f"{content_dir}: folder not found")
        return 1
    fetch = None
    if args.api is not None and args.api.strip() != "":
        fetch = api_fetcher(args.api.strip())
    try:
        ok = export_site(content_dir, out_dir, fetch)
    except ExportError as error:
        print(f"FAILED: {error}")
        return 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
