"""Adding a source by hand, and the source catalog the milestone editor picks from.

POST /api/sources puts a paper someone found themselves into the review
queue, as if the pipeline had found it:

    1. the link is checked (normalize.is_web_link and names_its_paper, so
       "https://arxiv.org/abs/" with no id is refused), and the DOI and arXiv id
       are normalized (an arXiv link in url counts as its arXiv id, and a
       doi.org link as its DOI)
    2. it's checked against every source in the database (same DOI, arXiv id,
       link, or title with the same year) and against content/sources.json.
       A match is a 409 with the existing id, so nobody reviews a paper
       twice. Links are compared with normalize.url_key, as the site check
       does, so a copy with tracking parameters, "m." or a youtu.be link
       still matches
    3. it goes in as a candidate with origin "manual" and status
       "pending_review", flagged no_abstract when it has none

There's no AI assessment. The normal review flow approves or rejects it, and
the approval reaches the public site at the next publish.

Review can't change a paper's link, title, authors, year or venue, so a typo
in one of them is fixed by rejecting the paper and adding it again. A
rejected paper still counts as a match when nothing review can't change is
different (someone found the same paper again), or when the pipeline found
it and the new one has its DOI or arXiv id. Otherwise:

    - a rejected paper added by hand with the same DOI or arXiv id goes back
      into Pending review with the new details (reopen), because those ids
      are unique. Its rejection stays in its record, and the response is a
      200 with its id instead of a 201. A re_adds document (insert-only, like
      reviews) records who added it again, when, and which of the link, title
      and year changed, so the record can say so
    - a rejected paper that matches on link or title stays as it is, and the
      new one goes in beside it
"""

import re
import uuid
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from flask import Blueprint, jsonify
from pydantic import BaseModel, ConfigDict, Field
from pymongo.errors import DuplicateKeyError

from sf_api.app_state import app_config, app_db
from sf_api.auth import current_user
from sf_api.catalog import catalog_entries, read_content_sources
from sf_api.documents import from_document, plain, to_document
from sf_api.errors import ApiError, parse_body
from sf_shared.db import now
from sf_shared.enums import SourceType
from sf_shared.normalize import (
    DOI_PREFIXES,
    is_web_link,
    names_its_paper,
    normalize_arxiv_id,
    normalize_doi,
    title_key,
    url_key,
)
from sf_shared.pipeline_models import Candidate, CandidateFlag, ReviewStatus
from sf_shared.source_match import index_sources

blueprint = Blueprint("sources", __name__, url_prefix="/api/sources")

MIN_YEAR = 1800
MAX_YEAR = 2100

# Besides the link, title and year, what review can't change on a paper, so
# adding it again is the only way to fix a typo in one of them. (The review
# sets the source type itself.) These are optional when adding a paper.
OPTIONAL_DETAILS = ("authors", "venue", "doi", "arxiv_id")
# What the duplicate checks read from each paper they look at.
MATCH_FIELDS = ["url", "title", "year", "review_status", "origin", "current_review_id", *OPTIONAL_DETAILS]
# A youtu.be link and a youtube.com one can be the same video (normalize.url_key).
YOUTUBE_HOSTS = ("youtube.com", "youtu.be")


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


# The details a reviewer can see changed when a rejected paper is added again.
ReAddedDetail = Literal["url", "title", "year"]


class ReAdd(BaseModel):
    """A rejected paper someone added again, putting it back into Pending review (reopen).

    Stored in re_adds, which is insert-only like reviews: GET /api/queue/<id>
    sends them with the paper's reviews, so its record shows the re-add.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    source_id: str
    added_by: str  # email
    added_by_name: str
    added_at: datetime
    # Which of the link, title and year the new details changed. Empty when
    # only something else changed, like the authors or the venue.
    changed: list[ReAddedDetail]


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
    elif not is_web_link(url) or not names_its_paper(url):
        # "https://", a missing slash ("https://doi.org10.1234"), a space, or
        # a doi.org or arXiv link with no paper in it ("https://arxiv.org/abs/").
        problems.append("url: looks incomplete. Copy it from the browser's address bar")
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
            problems.append("doi: That doesn't look like a DOI.")
    elif is_doi_link(url):
        doi = normalize_doi(url)

    arxiv_id = None
    arxiv_text = blank_to_none(body.arxiv_id)
    if arxiv_text is not None:
        arxiv_id = normalize_arxiv_id(arxiv_text)
        if arxiv_id is None:
            problems.append("arxiv_id: That doesn't look like an arXiv id.")
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
    # match is "doi", "arxiv_id", "url" or "title"; where is "site" (content/sources.json) or "database".
    return ApiError(409, "duplicate", message, {"existing_id": existing_id, "match": match, "where": where})


def same_site_links(url: str) -> re.Pattern:
    """Matches a stored link on the same site as this one, whatever its scheme,
    "www." or "m.", and with the host in any case.

    The database keeps links as they were pasted, so this is the first cut of
    the link lookup. url_key then decides which of them are the same page.
    """
    host = urlsplit(url).hostname or ""
    for prefix in ("www.", "m."):
        if host.startswith(prefix):
            host = host[len(prefix):]
            break
    hosts = [host]
    if host in YOUTUBE_HOSTS:
        hosts = list(YOUTUBE_HOSTS)
    names = "|".join(re.escape(name) for name in hosts)
    return re.compile(rf"(//|@)(www\.|m\.)?({names})([:/?#]|$)", re.IGNORECASE)


def same_link(first: str | None, second: str | None) -> bool:
    first_key = url_key(first)
    second_key = url_key(second)
    if first_key is None or second_key is None:
        # A home page has no url_key, so it's compared as written.
        return (first or "").strip() == (second or "").strip()
    return first_key == second_key


def same_details(found: dict, fields: dict) -> bool:
    """Whether adding this paper again could only repeat the one in the
    database, never fix it: the same link, title and year, and the same of
    anything else the new one gives that review can't change. An optional
    field left empty isn't a change, since someone who finds the paper again
    may not fill it in."""
    if not same_link(found.get("url"), fields["url"]):
        return False
    if title_key(found.get("title") or "") != title_key(fields["title"]) or found.get("year") != fields["year"]:
        return False
    for name in OPTIONAL_DETAILS:
        if fields[name] is None or fields[name] == []:
            continue
        if found.get(name) != fields[name]:
            return False
    return True


def blocks(found: dict, fields: dict, match: str) -> bool:
    """Whether this paper in the database stops the new one going in (see the module docstring)."""
    if found.get("review_status") != ReviewStatus.REJECTED.value:
        return True
    if same_details(found, fields):
        return True
    if match in ("doi", "arxiv_id"):
        # Fixed by reopen() when it was added by hand.
        return found.get("origin") != "manual"
    return False


def find_in_database(db, fields: dict) -> ApiError | None:
    for field in ("doi", "arxiv_id"):
        if fields[field] is not None:
            found = db["sources"].find_one({field: fields[field]}, projection=MATCH_FIELDS)
            if found is not None and blocks(found, fields, field):
                return duplicate(found["_id"], field, "database")
    # A bare home page (url_key None) could be cited for more than one paper.
    key = url_key(fields["url"])
    if key is not None:
        for found in db["sources"].find({"url": same_site_links(fields["url"])}, projection=MATCH_FIELDS):
            if url_key(found.get("url")) == key and blocks(found, fields, "url"):
                return duplicate(found["_id"], "url", "database")
    for found in db["sources"].find({"title_key": title_key(fields["title"])}, projection=MATCH_FIELDS):
        same_year = fields["year"] is None or found.get("year") is None or found.get("year") == fields["year"]
        if same_year and blocks(found, fields, "title"):
            return duplicate(found["_id"], "title", "database")
    return None


def holding_identifiers(db, fields: dict, other_than: str | None = None) -> ApiError | None:
    """A 409 for whichever paper has this one's DOI or arXiv id, or None.

    For when the unique index refuses a write that find_in_database let through.
    """
    for field in ("doi", "arxiv_id"):
        if fields[field] is not None:
            found = db["sources"].find_one({field: fields[field], "_id": {"$ne": other_than}}, projection={"_id": 1})
            if found is not None:
                return duplicate(found["_id"], field, "database")
    return None


def rejected_copy_to_fix(db, fields: dict) -> dict | None:
    """The rejected paper, added by hand, with this one's DOI or arXiv id, or None.

    find_in_database has already let it through, so some detail differs and
    the new one fixes a typo in it. Both ids have to agree with it: a
    different DOI on each would be a different paper.
    """
    for field in ("doi", "arxiv_id"):
        if fields[field] is None:
            continue
        found = db["sources"].find_one({field: fields[field]}, projection=MATCH_FIELDS)
        if found is None:
            continue
        for other in ("doi", "arxiv_id"):
            if fields[other] is not None and found.get(other) is not None and found.get(other) != fields[other]:
                return None
        return found
    return None


def changed_details(rejected: dict, fields: dict) -> list[ReAddedDetail]:
    """Which of the link, title and year the new details change, as written.

    A fixed typo can be a capital letter or a tracking code the duplicate
    checks see past, so these compare the text itself.
    """
    changed: list[ReAddedDetail] = []
    if (rejected.get("url") or "") != fields["url"]:
        changed.append("url")
    if (rejected.get("title") or "") != fields["title"]:
        changed.append("title")
    if rejected.get("year") != fields["year"]:
        changed.append("year")
    return changed


def new_re_add_id() -> str:
    """e.g. re-add-20261028-1a2b3c4d5e"""
    return "re-add-" + now().strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:10]


def reopen(db, rejected: dict, fields: dict, user: dict, flags: list[CandidateFlag]) -> dict:
    """Put a rejected paper back into Pending review with the new details.

    The paper changes, and a re_adds document says who added it again, when,
    and what changed. Its rejection stays in the reviews collection, so the
    record still shows it, and the next review is a new decision rather than
    a change to that one (current_review_id goes back to None).
    """
    moment = now()
    changes = {
        "url": fields["url"],
        "title": fields["title"],
        "title_key": title_key(fields["title"]),
        "authors": fields["authors"],
        "year": fields["year"],
        # An id the new one leaves out stays as it was.
        "doi": fields["doi"] or rejected.get("doi"),
        "arxiv_id": fields["arxiv_id"] or rejected.get("arxiv_id"),
        "venue": fields["venue"],
        "source_type": plain(fields["source_type"]),
        "abstract": fields["abstract"],
        "note": fields["note"],
        "flags": flags,
        "added_by": user["email"],
        "added_by_name": user["name"],
        "review_status": ReviewStatus.PENDING_REVIEW.value,
        "current_review_id": None,
        "updated_at": moment,
    }
    # The filter repeats what was checked, so a review saved a moment ago wins.
    still_rejected = {
        "_id": rejected["_id"],
        "review_status": ReviewStatus.REJECTED.value,
        "current_review_id": rejected.get("current_review_id"),
    }
    try:
        result = db["sources"].update_one(still_rejected, {"$set": changes})
    except DuplicateKeyError:
        # The new one's other id belongs to another paper.
        problem = holding_identifiers(db, fields, other_than=rejected["_id"])
        if problem is not None:
            raise problem from None
        raise
    if result.matched_count == 0:
        raise duplicate(rejected["_id"], "doi" if fields["doi"] is not None else "arxiv_id", "database")
    re_add = ReAdd(
        id=new_re_add_id(),
        source_id=rejected["_id"],
        added_by=user["email"],
        added_by_name=user["name"],
        added_at=moment,
        changed=changed_details(rejected, fields),
    )
    db["re_adds"].insert_one(to_document(re_add))
    return db["sources"].find_one({"_id": rejected["_id"]})


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
    rejected = rejected_copy_to_fix(db, fields)
    if rejected is not None:
        document = reopen(db, rejected, fields, user, flags)
        return jsonify({"id": document["_id"], "candidate": from_document(document)}), 200
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
        problem = find_in_database(db, fields) or holding_identifiers(db, fields)
        if problem is not None:
            raise problem from None
        raise
    return jsonify({"id": document["_id"], "candidate": from_document(document)}), 201


@blueprint.get("/catalog")
def source_catalog():
    """Every source a milestone can cite: {id, register_id, title, authors, year, sample, origin}."""
    entries = catalog_entries(app_db(), app_config().content_dir)
    return jsonify({"sources": entries})
