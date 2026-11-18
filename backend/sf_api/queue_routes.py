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
# Every paper in these tabs has a decision, so the kind filter reads the decision.
DECIDED_STATUSES = (ReviewStatus.APPROVED.value, ReviewStatus.REJECTED.value)


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


def ai_kinds_by_assessment(db, assessment_ids: list[str]) -> dict:
    """Assessment id -> the kind the AI gave (None when it gave none, or no usable answer)."""
    kinds = {}
    for assessment in db["ai_assessments"].find({"_id": {"$in": assessment_ids}}, projection={"parsed.kind": 1}):
        parsed = assessment.get("parsed") or {}
        kinds[assessment["_id"]] = parsed.get("kind")
    return kinds


def ai_kind_filter(db, filters: dict, kind: str) -> dict:
    """Sources whose current AI assessment gave this kind, as a filter on current_assessment_id."""
    assessment_ids = []
    for row in db["sources"].find(filters, projection={"current_assessment_id": 1}):
        if row.get("current_assessment_id") is not None:
            assessment_ids.append(row["current_assessment_id"])
    matching_ids = []
    for assessment_id, ai_kind in ai_kinds_by_assessment(db, assessment_ids).items():
        if ai_kind == kind:
            matching_ids.append(assessment_id)
    return {"$in": matching_ids}


def decided_kind_filter(db, filters: dict, kind: str) -> dict:
    """Decided sources whose current decision gave this kind, as a filter on _id.

    A decision with no kind (a rejection can leave it unset) falls back to
    the AI's kind, so those papers still turn up under what the AI said.
    """
    rows = list(db["sources"].find(filters, projection={"current_review_id": 1, "current_assessment_id": 1}))
    review_ids = []
    assessment_ids = []
    for row in rows:
        if row.get("current_review_id") is not None:
            review_ids.append(row["current_review_id"])
        if row.get("current_assessment_id") is not None:
            assessment_ids.append(row["current_assessment_id"])

    decided_kinds = {}
    for review in db["reviews"].find({"_id": {"$in": review_ids}}, projection={"final.kind": 1}):
        final = review.get("final") or {}
        decided_kinds[review["_id"]] = final.get("kind")
    ai_kinds = ai_kinds_by_assessment(db, assessment_ids)

    matching_ids = []
    for row in rows:
        source_kind = decided_kinds.get(row.get("current_review_id"))
        if source_kind is None:
            source_kind = ai_kinds.get(row.get("current_assessment_id"))
        if source_kind == kind:
            matching_ids.append(row["_id"])
    return {"$in": matching_ids}


def reject_reasons_by_review(db, review_ids: list[str]) -> dict:
    """Review id -> its reject_reason (None for an approval)."""
    reasons = {}
    for review in db["reviews"].find({"_id": {"$in": review_ids}}, projection={"reject_reason": 1}):
        reasons[review["_id"]] = review.get("reject_reason")
    return reasons


@blueprint.get("/queue")
def list_queue():
    """Candidates in one status (pending_review by default), oldest first, each with its latest assessment.

    kind (argument or milestone_evidence) filters on what the AI said, since
    candidates have no kind of their own until someone reviews them. In
    approved and rejected it filters on the current decision's kind instead,
    or the AI's when the decision gave none.

    Each item's reject_reason is its current decision's, so the Rejected tab
    can say why without opening each paper. It's null for every other paper.

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
    if kind is not None and status in DECIDED_STATUSES:
        filters["_id"] = decided_kind_filter(db, filters, kind)
    elif kind is not None:
        filters["current_assessment_id"] = ai_kind_filter(db, filters, kind)

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
    page_review_ids = []
    for candidate in page:
        if candidate.get("current_assessment_id") is not None:
            page_assessment_ids.append(candidate["current_assessment_id"])
        if candidate.get("current_review_id") is not None:
            page_review_ids.append(candidate["current_review_id"])
    assessments_by_id = {}
    for assessment in db["ai_assessments"].find({"_id": {"$in": page_assessment_ids}}):
        assessments_by_id[assessment["_id"]] = assessment
    reject_reasons = reject_reasons_by_review(db, page_review_ids)

    items = []
    for candidate in page:
        assessment = assessments_by_id.get(candidate.get("current_assessment_id"))
        items.append(
            {
                "candidate": from_document(candidate),
                "assessment": assessment_json(assessment, include_raw_output=False),
                "reject_reason": reject_reasons.get(candidate.get("current_review_id")),
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
    """One candidate with every assessment and review of it, and every time it was added again, newest first."""
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

    # A rejected paper someone added again (sources_routes.reopen).
    re_adds = []
    for re_add in db["re_adds"].find({"source_id": candidate_id}).sort("added_at", -1):
        re_adds.append(from_document(re_add))

    return jsonify(
        {
            "candidate": from_document(candidate),
            "current_assessment": current,
            "assessments": assessments,
            "reviews": reviews,
            "re_adds": re_adds,
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
