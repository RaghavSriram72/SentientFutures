"""Adding a source by hand, and the source catalog the milestone editor picks from.

POST /api/sources puts a paper someone found themselves into the review
queue, as if the pipeline had found it:

    1. the DOI and arXiv id are normalized (an arXiv link in url counts as
       its arXiv id, and a doi.org link as its DOI)
    2. it's checked against every source in the database (same DOI, arXiv id,
       or title with the same year) and against content/sources.json. A
       match is a 409 with the existing id, so nobody reviews a paper twice
    3. it goes in as a candidate with origin "manual" and status
       "pending_review", flagged no_abstract when it has none

There's no AI assessment. The normal review flow approves or rejects it, and
the approval reaches the public site at the next publish.
"""

import uuid

from flask import Blueprint, jsonify
from pydantic import BaseModel, ConfigDict, Field
from pymongo.errors import DuplicateKeyError

from sf_api.app_state import app_config, app_db
from sf_api.auth import current_user
from sf_api.catalog import catalog_entries, read_content_sources
from sf_api.documents import from_document, to_document
from sf_api.errors import ApiError, parse_body
from sf_shared.db import now
from sf_shared.enums import SourceType
from sf_shared.normalize import DOI_PREFIXES, normalize_arxiv_id, normalize_doi, title_key
from sf_shared.pipeline_models import Candidate, CandidateFlag, ReviewStatus
from sf_shared.source_match import index_sources

blueprint = Blueprint("sources", __name__, url_prefix="/api/sources")

MIN_YEAR = 1800
MAX_YEAR = 2100


class AddSourceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    title: str
    authors: list[str] = []
    year: int | None = None  # required, but checked below so the message says why
    doi: str | None = None
    arxiv_id: str | None = None
    venue: str | None = None
    source_type: SourceType | None = None
    abstract: str | None = None
    note: str | None = Field(default=None, max_length=5000)  # for the reviewer; never public


def blank_to_none(value: str | None) -> str | None:
    if value is None or value.strip() == "":
        return None
    return value.strip()


def is_doi_link(url: str) -> bool:
    lowered = url.lower()
    for prefix in DOI_PREFIXES:
        if prefix.startswith("http") and lowered.startswith(prefix):
            return True
    return False


def manual_id(title: str) -> str:
    """e.g. manual-whole-brain-emulation-a-roadmap-1a2b3c"""
    slug = title_key(title).replace(" ", "-")[:40].strip("-")
    suffix = uuid.uuid4().hex[:6]
    if slug == "":
        return f"manual-{suffix}"
    return f"manual-{slug}-{suffix}"


def checked_fields(body: AddSourceBody) -> dict:
    """The body's values, normalized, or a 422 listing every problem."""
    problems = []
    url = body.url.strip()
    if not (url.startswith("https://") or url.startswith("http://")):
        problems.append("url: must start with https:// or http://")
    title = body.title.strip()
    if title == "":
        problems.append("title: required")
    if body.year is None:
        # The public source needs a year, and the review form can't add one later.
        problems.append("year: required. The site lists every source with the year it came out")
    elif body.year < MIN_YEAR or body.year > MAX_YEAR:
        problems.append(f"year: must be between {MIN_YEAR} and {MAX_YEAR}")

    doi = None
    doi_text = blank_to_none(body.doi)
    if doi_text is not None:
        doi = normalize_doi(doi_text)
        if doi is None:
            problems.append('doi: doesn\'t look like a DOI. It starts with "10.", like 10.1000/xyz123')
    elif is_doi_link(url):
        doi = normalize_doi(url)

    arxiv_id = None
    arxiv_text = blank_to_none(body.arxiv_id)
    if arxiv_text is not None:
        arxiv_id = normalize_arxiv_id(arxiv_text)
        if arxiv_id is None:
            problems.append("arxiv_id: doesn't look like an arXiv id, like 2411.18526")
    else:
        arxiv_id = normalize_arxiv_id(url)

    if len(problems) > 0:
        raise ApiError(422, "invalid_source", "Some fields aren't valid.", problems)

    authors = []
    for name in body.authors:
        if name.strip() != "":
            authors.append(name.strip())
    return {
        "url": url,
        "title": title,
        "authors": authors,
        "year": body.year,
        "doi": doi,
        "arxiv_id": arxiv_id,
        "venue": blank_to_none(body.venue),
        "source_type": body.source_type,
        "abstract": blank_to_none(body.abstract),
        "note": blank_to_none(body.note),
    }


def duplicate(existing_id: str, match: str, where: str) -> ApiError:
    if where == "site":
        message = f"The site already cites this paper ({existing_id})."
    else:
        message = f"This paper is already in admin ({existing_id}). Open it from the queue instead."
    # match is "doi", "arxiv_id" or "title"; where is "site" (content/sources.json) or "database".
    return ApiError(409, "duplicate", message, {"existing_id": existing_id, "match": match, "where": where})


def find_in_database(db, fields: dict) -> ApiError | None:
    if fields["doi"] is not None:
        found = db["sources"].find_one({"doi": fields["doi"]}, projection={"_id": 1})
        if found is not None:
            return duplicate(found["_id"], "doi", "database")
    if fields["arxiv_id"] is not None:
        found = db["sources"].find_one({"arxiv_id": fields["arxiv_id"]}, projection={"_id": 1})
        if found is not None:
            return duplicate(found["_id"], "arxiv_id", "database")
    key = title_key(fields["title"])
    for found in db["sources"].find({"title_key": key}, projection={"_id": 1, "year": 1}):
        if fields["year"] is None or found.get("year") is None or found.get("year") == fields["year"]:
            return duplicate(found["_id"], "title", "database")
    return None


def find_on_site(content_dir, fields: dict) -> ApiError | None:
    match = index_sources(read_content_sources(content_dir)).find(fields)
    if match is None:
        return None
    return duplicate(match.id, match.field, "site")


@blueprint.post("")
def add_source():
    body = parse_body(AddSourceBody)
    fields = checked_fields(body)
    db = app_db()

    problem = find_in_database(db, fields) or find_on_site(app_config().content_dir, fields)
    if problem is not None:
        raise problem

    user = current_user()
    flags: list[CandidateFlag] = []
    if fields["abstract"] is None:
        flags.append("no_abstract")
    moment = now()
    candidate = Candidate(
        id=manual_id(fields["title"]),
        origin="manual",
        collector="manual",
        title=fields["title"],
        authors=fields["authors"],
        year=fields["year"],
        url=fields["url"],
        doi=fields["doi"],
        arxiv_id=fields["arxiv_id"],
        venue=fields["venue"],
        source_type=fields["source_type"],
        abstract=fields["abstract"],
        title_key=title_key(fields["title"]),
        review_status=ReviewStatus.PENDING_REVIEW,
        flags=flags,
        found_at=moment,
        updated_at=moment,
        added_by=user["email"],
        added_by_name=user["name"],
        note=fields["note"],
    )
    document = to_document(candidate)
    try:
        db["sources"].insert_one(document)
    except DuplicateKeyError:
        # Someone (or a pipeline run) added the same DOI or arXiv id a moment ago.
        problem = find_in_database(db, fields)
        if problem is not None:
            raise problem from None
        raise
    return jsonify({"id": document["_id"], "candidate": from_document(document)}), 201


@blueprint.get("/catalog")
def source_catalog():
    """Every source a milestone can cite: {id, register_id, title, authors, year, sample, origin}."""
    entries = catalog_entries(app_db(), app_config().content_dir)
    return jsonify({"sources": entries})
