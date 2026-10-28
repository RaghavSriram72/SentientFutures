"""The review queue: candidates waiting for a person, one candidate's history, and the review itself."""

import re
from typing import get_args

from flask import Blueprint, jsonify, request

from sf_api.app_state import app_db
from sf_api.auth import current_user
from sf_api.documents import from_document
from sf_api.errors import ApiError, parse_body, query_int
from sf_api.pipeline_routes import review_status_counts
from sf_api.reviews import ReviewBody, record_review, review_stats
from sf_shared.enums import SourceKind
from sf_shared.pipeline_models import CandidateFlag, ReviewStatus

blueprint = Blueprint("queue", __name__, url_prefix="/api")

STATUSES = [status.value for status in ReviewStatus]
KINDS = [kind.value for kind in SourceKind]
FLAGS = list(get_args(CandidateFlag))


def choice_arg(name: str, allowed: list[str], default: str | None) -> str | None:
    value = request.args.get(name, "").strip()
    if value == "":
        return default
    if value not in allowed:
        raise ApiError(400, "invalid_query", f'{name} must be one of: {", ".join(allowed)} (got "{value}").')
    return value


def assessment_json(assessment: dict | None, include_raw_output: bool) -> dict | None:
    if assessment is None:
        return None
    result = from_document(assessment)
    if not include_raw_output:
        result.pop("raw_output", None)
    return result


def search_pattern(text: str) -> dict:
    """A case-insensitive 'contains' match, with the text escaped so it's never treated as a regex."""
    return {"$regex": re.escape(text), "$options": "i"}


@blueprint.get("/queue")
def list_queue():
    """Candidates in one status (pending_review by default), oldest first, each with its latest assessment.

    kind filters on what the AI said (argument or milestone_evidence), since
    candidates have no kind of their own until someone reviews them.

    counts has the number of sources in every status, ignoring the filters,
    so the queue can label its tabs and open on one that has papers.
    """
    db = app_db()
    status = choice_arg("status", STATUSES, ReviewStatus.PENDING_REVIEW.value)
    kind = choice_arg("kind", KINDS, None)
    flag = choice_arg("flag", FLAGS, None)
    text = request.args.get("q", "").strip()
    limit = query_int("limit", default=50, minimum=1, maximum=200)
    offset = query_int("offset", default=0, minimum=0, maximum=1_000_000)

    filters: dict = {"review_status": status}
    if flag is not None:
        filters["flags"] = flag
    if text != "":
        filters["$or"] = [{"title": search_pattern(text)}, {"authors": search_pattern(text)}]
    if kind is not None:
        rows = db["sources"].find(filters, projection={"current_assessment_id": 1})
        assessment_ids = []
        for row in rows:
            if row.get("current_assessment_id") is not None:
                assessment_ids.append(row["current_assessment_id"])
        matching = db["ai_assessments"].find(
            {"_id": {"$in": assessment_ids}, "parsed.kind": kind},
            projection={"_id": 1},
        )
        matching_ids = []
        for assessment in matching:
            matching_ids.append(assessment["_id"])
        filters["current_assessment_id"] = {"$in": matching_ids}

    total = db["sources"].count_documents(filters)
    # The abstract is left out of the list to keep it light; the detail view has it.
    page = list(
        db["sources"]
        .find(filters, projection={"abstract": 0})
        .sort([("found_at", 1), ("_id", 1)])
        .skip(offset)
        .limit(limit)
    )

    page_assessment_ids = []
    for candidate in page:
        if candidate.get("current_assessment_id") is not None:
            page_assessment_ids.append(candidate["current_assessment_id"])
    assessments_by_id = {}
    for assessment in db["ai_assessments"].find({"_id": {"$in": page_assessment_ids}}):
        assessments_by_id[assessment["_id"]] = assessment

    items = []
    for candidate in page:
        assessment = assessments_by_id.get(candidate.get("current_assessment_id"))
        items.append(
            {
                "candidate": from_document(candidate),
                "assessment": assessment_json(assessment, include_raw_output=False),
            }
        )
    return jsonify(
        {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "counts": review_status_counts(db),
        }
    )


@blueprint.get("/queue/<candidate_id>")
def get_candidate(candidate_id: str):
    """One candidate with every assessment and review of it, newest first."""
    db = app_db()
    candidate = db["sources"].find_one({"_id": candidate_id})
    if candidate is None:
        raise ApiError(404, "not_found", f"No source with id {candidate_id}.")

    assessments = []
    current = None
    for assessment in db["ai_assessments"].find({"source_id": candidate_id}).sort("created_at", -1):
        assessments.append(assessment_json(assessment, include_raw_output=True))
        if assessment["_id"] == candidate.get("current_assessment_id"):
            current = assessment_json(assessment, include_raw_output=True)

    reviews = []
    for review in db["reviews"].find({"source_id": candidate_id}).sort("created_at", -1):
        reviews.append(from_document(review))

    return jsonify(
        {
            "candidate": from_document(candidate),
            "current_assessment": current,
            "assessments": assessments,
            "reviews": reviews,
        }
    )


@blueprint.post("/queue/<candidate_id>/review")
def review_candidate(candidate_id: str):
    body = parse_body(ReviewBody)
    result = record_review(app_db(), candidate_id, body, current_user())
    return jsonify(result), 201


@blueprint.get("/reviews/stats")
def get_review_stats():
    return jsonify(review_stats(app_db()))
