"""Turning an approved candidate into the public Source shape (shared/sf_shared/models.py).

What goes public: the paper's metadata, a link, the final values a person
chose, the team's own summary, and which fields came from the AI. What never
does: reviewer emails, notes, abstracts, and the AI's reasons and quotes.
"""

import re

from pydantic import ValidationError

from sf_api.documents import as_utc
from sf_api.errors import validation_problems
from sf_shared.models import Source
from sf_shared.pipeline_models import ReviewStatus

RUBRIC_FIELDS = ("evidence_type", "directness", "independence", "relevance", "credibility", "credibility_unclear_reason")


def public_id(candidate_id: str) -> str:
    """'arxiv-2411.18526' -> 'arxiv-2411-18526' (public ids are slugs: they end up in URLs)."""
    return re.sub(r"[^a-z0-9]+", "-", candidate_id.lower()).strip("-")


def non_blank(names: list) -> list[str]:
    result = []
    for name in names:
        if isinstance(name, str) and name.strip() != "":
            result.append(name.strip())
    return result


def build_public_source(candidate: dict, review: dict) -> Source:
    """The public Source for an approved candidate and its review. Raises ValidationError if it isn't valid."""
    final = review["final"]
    source_type = final.get("source_type") or candidate.get("source_type")
    reviewer_name = review["reviewer_name"]
    # A source added by hand was added by that person; one the pipeline found
    # was added to the site by whoever approved it.
    added_by = candidate.get("added_by_name") or reviewer_name

    data = {
        "id": public_id(candidate["_id"]),
        "title": candidate.get("title", ""),
        "authors": non_blank(candidate.get("authors", [])),
        "year": candidate.get("year"),
        "url": candidate.get("url", ""),
        "doi": candidate.get("doi"),
        "arxiv_id": candidate.get("arxiv_id"),
        "venue": candidate.get("venue"),
        "source_type": source_type,
        "kind": final.get("kind"),
        "technology": final.get("technology", []),
        "problem": final.get("problem"),
        "claim_directions": final.get("claim_directions", []),
        # Approving needs a summary, so the team wrote this one.
        "summary": {"text": final.get("summary") or "", "provenance": "team"},
        "ai_suggested_fields": list(review.get("ai_values_used", [])),
        "added_by": added_by,
        "reviewed_by": reviewer_name,
        "reviewed_on": as_utc(review["created_at"]).date().isoformat(),
    }
    for field in RUBRIC_FIELDS:
        data[field] = final.get(field)
    return Source.model_validate(data)


def approved_public_sources(db) -> tuple[list[dict], list[dict]]:
    """Every approved source in the public Source shape (as JSON), and the ones left out.

    A source that doesn't validate is left out and listed in the second list
    as {id, problems}, so one bad record never blocks the rest. GET
    /api/public/sources and the source catalog both use this.
    """
    candidates = list(db["sources"].find({"review_status": ReviewStatus.APPROVED.value}).sort("_id", 1))

    review_ids = []
    for candidate in candidates:
        if candidate.get("current_review_id") is not None:
            review_ids.append(candidate["current_review_id"])
    reviews_by_id = {}
    for review in db["reviews"].find({"_id": {"$in": review_ids}}):
        reviews_by_id[review["_id"]] = review

    sources = []
    skipped = []
    candidate_for_public_id: dict[str, str] = {}
    for candidate in candidates:
        review = reviews_by_id.get(candidate.get("current_review_id"))
        if review is None or review.get("decision") != "approve":
            skipped.append({"id": candidate["_id"], "problems": ["No approving review was found for this source."]})
            continue

        try:
            source = build_public_source(candidate, review)
        except ValidationError as error:
            skipped.append({"id": candidate["_id"], "problems": validation_problems(error)})
            continue

        if source.id in candidate_for_public_id:
            other = candidate_for_public_id[source.id]
            problem = f'Its public id "{source.id}" is already used by {other}.'
            skipped.append({"id": candidate["_id"], "problems": [problem]})
            continue
        candidate_for_public_id[source.id] = candidate["_id"]
        sources.append(source.model_dump(mode="json"))
    return sources, skipped
