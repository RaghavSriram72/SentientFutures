"""The source catalog: every source a milestone can cite.

    content/sources.json         the sources the site already cites, edited in git
    approved sources in MongoDB  in the public Source shape (publish.py), except
                                 any that repeat a source in content/sources.json,
                                 because the publish step leaves those out too

The milestone editor's pickers read it (GET /api/sources/catalog), and saving
a milestone checks every source id against it, so a milestone can never cite
a source the published site won't have.
"""

import json
import logging
from pathlib import Path

from sf_api.publish import approved_public_sources
from sf_shared.source_match import index_sources

log = logging.getLogger(__name__)


def read_content_sources(content_dir: Path) -> list[dict]:
    """content/sources.json as a list of dicts, or [] when it's missing or unreadable."""
    path = content_dir / "sources.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log.warning("%s isn't valid JSON, so the source catalog leaves it out.", path)
        return []
    if not isinstance(data, list):
        return []
    sources = []
    for item in data:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            sources.append(item)
    return sources


def published_sources(db, content_dir: Path) -> list[dict]:
    """The full public Source records the next publish will have, content/ first."""
    content_sources = read_content_sources(content_dir)
    known = index_sources(content_sources)
    content_ids = set()
    for source in content_sources:
        content_ids.add(source["id"])

    sources = list(content_sources)
    approved, _skipped = approved_public_sources(db)
    for source in approved:
        if known.find(source) is not None or source["id"] in content_ids:
            continue
        sources.append(source)
    return sources


def catalog_entry(source: dict, origin: str) -> dict:
    return {
        "id": source["id"],
        "register_id": source.get("register_id"),
        "title": source.get("title", ""),
        "authors": source.get("authors", []),
        "year": source.get("year"),
        "url": source.get("url"),
        "sample": bool(source.get("sample", False)),
        "origin": origin,  # "site" (content/sources.json) or "approved" (approved in admin)
    }


def catalog_entries(db, content_dir: Path) -> list[dict]:
    content_ids = set()
    for source in read_content_sources(content_dir):
        content_ids.add(source["id"])
    entries = []
    for source in published_sources(db, content_dir):
        origin = "site" if source["id"] in content_ids else "approved"
        entries.append(catalog_entry(source, origin))
    return entries


def catalog_ids(db, content_dir: Path) -> set[str]:
    ids = set()
    for source in published_sources(db, content_dir):
        ids.add(source["id"])
    return ids


def catalog_sample_ids(db, content_dir: Path) -> set[str]:
    """The fictional sample sources in the catalog. Only sample milestones may cite them."""
    ids = set()
    for source in published_sources(db, content_dir):
        if source.get("sample") is True:
            ids.add(source["id"])
    return ids
