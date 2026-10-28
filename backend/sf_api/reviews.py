"""How a human review is checked and recorded.

The AI suggests four fields that a reviewer can keep or change:

    kind, technology, problem, claim_directions

For an approval, the review records three lists:

    compared_fields  all four fields, whenever the current AI assessment was
                     parsed. A null or an empty list counts as the AI's
                     answer, so a tag the reviewer adds where the AI chose
                     nothing is a change. A failed assessment, or a candidate
                     the AI hasn't triaged yet, has nothing to compare.
    changed_fields   of those, the ones where the final value differs from the
                     AI's. Lists are compared as sets, so order doesn't matter.
    ai_values_used   the fields where the reviewer pressed "Use AI value". Each
                     one needs a value from the AI (not null and not an empty
                     list) and has to be unchanged, or the review is refused:
                     the public site marks these fields AI-suggested, so the
                     claim has to be true.

A field can be unchanged without being in ai_values_used. That means the
reviewer chose the same value on their own.

A rejection records no comparison (all three lists are empty), because the
final values on a rejected paper aren't a judgment of the AI's tags and would
skew the override rates.

What an approval needs (check_decision_rules):

    summary          the team's own words; public summaries are never the AI's
    source_type      unless the collector already knew it
    kind             argument or milestone evidence
    technology       at least one, or general_background set to true for a
                     source about the project as a whole (it goes public
                     with no technology)
    credibility_unclear_reason
                     when credibility is "unclear", and not "other" (sources
                     have no note field to explain it)

Which papers can be reviewed:

    new, pending_review, triaged_out   any time. Triaged-out papers are
                     included so a person can rescue one the AI ruled out.
    approved, rejected                 only to change the decision. The body
                     names the review it replaces (replaces_review_id), and
                     it has to be the source's current one, so a double click
                     or two people changing it at once can't both count.

Reviews and AI assessments are insert-only. Nothing in this API updates or
deletes them (tests/test_insert_only.py checks the source for it).
"""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from sf_api.documents import from_document, plain, to_document
from sf_api.errors import ApiError, validation_problems
from sf_api.publish import build_public_source
from sf_shared.db import now
from sf_shared.enums import RUBRIC_VERSION, Credibility, UnclearReason
from sf_shared.pipeline_models import RejectReason, Review, ReviewFinal, ReviewStatus

COMPARED_FIELDS = ("kind", "technology", "problem", "claim_directions")
# How the stats split reviews by what the AI said about relevance. See ai_relevance_group.
RELEVANCE_GROUPS = ("yes", "unsure", "no_spot_check", "no_rescued", "no_answer")
UNDECIDED_STATUSES = (
    ReviewStatus.NEW.value,
    ReviewStatus.PENDING_REVIEW.value,
    ReviewStatus.TRIAGED_OUT.value,
)
DECIDED_STATUSES = (ReviewStatus.APPROVED.value, ReviewStatus.REJECTED.value)


class ReviewBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approve", "reject"]
    final: ReviewFinal = ReviewFinal()
    ai_values_used: list[str] = []
    notes: str = Field(default="", max_length=5000)
    reject_reason: RejectReason | None = None
    # The assessment the reviewer was looking at, or null if there was none.
    # Optional. When it's sent and a newer assessment has arrived since, the
    # review is refused so the comparison matches what the reviewer saw.
    assessment_id: str | None = None
    # Only when changing an earlier decision: the id of the review it replaces.
    replaces_review_id: str | None = None


# ---------- Comparing with the AI ----------


def has_value(value: object) -> bool:
    return value is not None and value != []


def same_value(first: object, second: object) -> bool:
    if isinstance(first, list) and isinstance(second, list):
        return set(first) == set(second)
    return first == second


def parsed_result(assessment: dict | None) -> dict | None:
    """The AI's parsed answer, or None for no assessment or one that didn't validate."""
    if assessment is None:
        return None
    return assessment.get("parsed")


def ai_field_values(assessment: dict | None) -> dict[str, object]:
    """The AI's answer for each compared field, or {} when there's no parsed answer.

    null and [] stay in: "the AI chose nothing" is an answer the reviewer can
    disagree with, and the override stats need to see when that happens.
    """
    parsed = parsed_result(assessment)
    if parsed is None:
        return {}
    values = {}
    for field in COMPARED_FIELDS:
        values[field] = plain(parsed.get(field))
    return values


def final_field_values(final: ReviewFinal) -> dict[str, object]:
    dumped = final.model_dump(mode="json")
    values = {}
    for field in COMPARED_FIELDS:
        values[field] = dumped[field]
    return values


def compare_with_ai(final: ReviewFinal, ai_values: dict[str, object]) -> tuple[list[str], list[str]]:
    """(compared_fields, changed_fields), in COMPARED_FIELDS order."""
    final_values = final_field_values(final)
    compared = []
    changed = []
    for field in COMPARED_FIELDS:
        if field not in ai_values:
            continue
        compared.append(field)
        if not same_value(final_values[field], ai_values[field]):
            changed.append(field)
    return compared, changed


def unique(items: list) -> list:
    """Drop repeats, keeping the first of each."""
    result = []
    for item in items:
        if item not in result:
            result.append(item)
    return result


def tidy_final(final: ReviewFinal) -> ReviewFinal:
    """Trim the summary (blank becomes null), drop repeated tags, and drop a
    credibility reason left over from when credibility was "unclear"."""
    summary = final.summary
    if summary is not None:
        summary = summary.strip()
        if summary == "":
            summary = None
    unclear_reason = final.credibility_unclear_reason
    if final.credibility != Credibility.UNCLEAR:
        unclear_reason = None
    return final.model_copy(
        update={
            "summary": summary,
            "technology": unique(final.technology),
            "claim_directions": unique(final.claim_directions),
            "credibility_unclear_reason": unclear_reason,
        }
    )


# ---------- Checking a review ----------


def check_decision_rules(body: ReviewBody, final: ReviewFinal, candidate: dict) -> None:
    if body.decision == "approve":
        if final.summary is None:
            raise ApiError(
                400,
                "summary_required",
                "Write a summary before approving. Public summaries are always the team's own words.",
            )
        if body.reject_reason is not None:
            raise ApiError(400, "invalid_body", "reject_reason is only for rejections.")
        if final.source_type is None and candidate.get("source_type") is None:
            raise ApiError(
                400,
                "source_type_required",
                "Pick a source type before approving. The pipeline couldn't tell what kind of publication this is.",
            )
        if final.kind is None:
            raise ApiError(
                400,
                "kind_required",
                "Pick a kind before approving: an argument, or evidence for a milestone.",
            )
        if len(final.technology) == 0 and not final.general_background:
            raise ApiError(
                400,
                "technology_required",
                'Pick at least one technology before approving, or mark it "General background" '
                "if it's about the project as a whole.",
            )
        if len(final.technology) > 0 and final.general_background:
            raise ApiError(
                400,
                "technology_conflict",
                '"General background" means no particular technology. Clear the technologies or untick it.',
            )
        if final.credibility == Credibility.UNCLEAR and final.credibility_unclear_reason is None:
            # The public Source shows the reason next to "unclear".
            raise ApiError(
                400,
                "credibility_reason_required",
                'Credibility "unclear" needs a reason. Pick why it\'s unclear.',
            )
        if final.credibility_unclear_reason == UnclearReason.OTHER:
            # Sources have no note field to explain "other".
            raise ApiError(
                400,
                "credibility_reason_other",
                'Pick the closest specific reason for credibility "unclear". "Other" needs a note, and sources have no place for one.',
            )
    else:
        if body.reject_reason is None:
            raise ApiError(400, "reject_reason_required", "Pick a reason for rejecting.")


def check_reviewable(candidate: dict, body: ReviewBody) -> None:
    """Refuse with a 409 unless this source can take this review (see the module docstring)."""
    status = candidate.get("review_status")
    if status in UNDECIDED_STATUSES:
        if body.replaces_review_id is not None:
            raise ApiError(
                409,
                "review_changed",
                "This source has no decision to replace yet. Reload to see where it is now.",
            )
        return
    if status in DECIDED_STATUSES:
        if body.replaces_review_id is None:
            raise ApiError(
                409,
                "not_reviewable",
                f'This source is already "{status}". To change the decision, send replaces_review_id '
                "with the id of its current review.",
            )
        if body.replaces_review_id != candidate.get("current_review_id"):
            raise ApiError(
                409,
                "review_changed",
                "Someone changed this decision while you were looking at it. Reload to see the latest one.",
            )
        return
    raise ApiError(409, "not_reviewable", f'This source has the status "{status}", which can\'t be reviewed.')


def check_ai_values_used(fields: list[str], ai_values: dict[str, object], changed: list[str]) -> None:
    problems = []
    for field in fields:
        if field not in COMPARED_FIELDS:
            problems.append(f'"{field}" isn\'t a field the AI suggests. Use any of: {", ".join(COMPARED_FIELDS)}')
        elif not has_value(ai_values.get(field)):
            problems.append(f"{field}: the AI gave no value for this field, so there's nothing to keep")
        elif field in changed:
            problems.append(f"{field}: the final value differs from the AI's, so it isn't the AI's value")
    if len(problems) > 0:
        raise ApiError(400, "ai_values_mismatch", "ai_values_used doesn't match the AI's values.", problems)


def current_assessment(db, candidate: dict) -> dict | None:
    assessment_id = candidate.get("current_assessment_id")
    if assessment_id is None:
        return None
    return db["ai_assessments"].find_one({"_id": assessment_id})


def public_source_problems(candidate: dict, review: dict) -> list[str]:
    """What would stop this approval reaching the public site, if anything.

    These are problems the reviewer can't fix from the review form (a missing
    year, say), so they don't block the approval. The export skips the source
    and lists the same problems until someone fixes the record.
    """
    try:
        build_public_source(candidate, review)
    except ValidationError as error:
        return validation_problems(error)
    return []


# ---------- Recording it ----------


def record_review(db, candidate_id: str, body: ReviewBody, reviewer: dict) -> dict:
    """Check a review, insert it and move the source on. Returns what the route sends back."""
    candidate = db["sources"].find_one({"_id": candidate_id})
    if candidate is None:
        raise ApiError(404, "not_found", f"No source with id {candidate_id}.")
    check_reviewable(candidate, body)

    assessment = current_assessment(db, candidate)
    assessment_id = None
    if assessment is not None:
        assessment_id = assessment["_id"]
    if "assessment_id" in body.model_fields_set and body.assessment_id != assessment_id:
        raise ApiError(
            409,
            "assessment_changed",
            "The AI's assessment changed while you were reviewing. Reload to see the new one.",
        )

    final = tidy_final(body.final)
    check_decision_rules(body, final, candidate)

    ai_values_used = unique(body.ai_values_used)
    ai_values = ai_field_values(assessment)
    compared: list[str] = []
    changed: list[str] = []
    if body.decision == "approve":
        compared, changed = compare_with_ai(final, ai_values)
    elif len(ai_values_used) > 0:
        raise ApiError(
            400,
            "ai_values_mismatch",
            "A rejection doesn't keep any AI values, so ai_values_used must be empty.",
        )
    check_ai_values_used(ai_values_used, ai_values, changed)

    prompt_version = None
    if assessment is not None:
        prompt_version = assessment.get("prompt_version")

    review = Review(
        id=new_review_id(),
        source_id=candidate_id,
        assessment_id=assessment_id,
        reviewer=reviewer["email"],
        reviewer_name=reviewer["name"],
        decision=body.decision,
        reject_reason=body.reject_reason,
        final=final,
        compared_fields=compared,
        changed_fields=changed,
        ai_values_used=ai_values_used,
        notes=body.notes.strip(),
        prompt_version=prompt_version,
        rubric_version=RUBRIC_VERSION,
        created_at=now(),
    )
    review_document = to_document(review)

    publish_problems: list[str] = []
    if body.decision == "approve":
        publish_problems = public_source_problems(candidate, review_document)

    move_source(db, candidate, review_document)
    try:
        db["reviews"].insert_one(review_document)
    except Exception:
        # Any failure, not only a database one (a document the driver won't
        # encode raises a bson error), or the source would keep a decision
        # whose review doesn't exist.
        undo_move_source(db, candidate, review_document["_id"])
        raise

    updated = db["sources"].find_one({"_id": candidate_id})
    return {
        "review": from_document(review_document),
        "candidate": from_document(updated),
        "publish_problems": publish_problems,
    }


def new_review_id() -> str:
    """e.g. review-20261027-1a2b3c4d5e"""
    return "review-" + now().strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:10]


def move_source(db, candidate: dict, review_document: dict) -> None:
    """Set the source's new status, in one atomic update.

    The filter repeats what we checked (same status, same assessment, same
    current review), so if another reviewer or a pipeline run got there first,
    nothing changes and the reviewer gets a 409 instead of a second decision.
    """
    decision = review_document["decision"]
    new_status = ReviewStatus.APPROVED.value if decision == "approve" else ReviewStatus.REJECTED.value
    changes = {
        "review_status": new_status,
        "current_review_id": review_document["_id"],
        # Journal abstracts are copyrighted, so they go once a decision is made.
        "abstract": None,
        "updated_at": now(),
    }
    if decision == "approve":
        # A copy of the final values, so the source reads on its own. The
        # review stays the record of who decided what.
        changes["final"] = review_document["final"]
    update: dict = {"$set": changes}
    if decision == "reject":
        # A rejection that replaces an approval mustn't leave the old values behind.
        update["$unset"] = {"final": ""}

    result = db["sources"].update_one(
        {
            "_id": candidate["_id"],
            "review_status": candidate.get("review_status"),
            "current_assessment_id": candidate.get("current_assessment_id"),
            "current_review_id": candidate.get("current_review_id"),
        },
        update,
    )
    if result.matched_count == 0:
        raise ApiError(
            409,
            "conflict",
            "Someone else changed this source while you were reviewing it. Reload and check.",
        )


def undo_move_source(db, candidate: dict, review_id: str) -> None:
    """Put the source back if the review couldn't be saved, so no decision exists without its record."""
    restore = {
        "review_status": candidate.get("review_status"),
        "current_review_id": candidate.get("current_review_id"),
        "abstract": candidate.get("abstract"),
        "updated_at": candidate.get("updated_at"),
    }
    if "final" in candidate:
        restore["final"] = candidate["final"]
    update: dict = {"$set": restore}
    if "final" not in candidate:
        update["$unset"] = {"final": ""}
    db["sources"].update_one({"_id": candidate["_id"], "current_review_id": review_id}, update)


# ---------- Override rates ----------


def value_key(value: object) -> object:
    """A hashable, order-free form of a field value, for counting pairs."""
    if isinstance(value, list):
        return tuple(sorted(value))
    return value


def value_from_key(key: object) -> object:
    if isinstance(key, tuple):
        return list(key)
    return key


def empty_field_stats() -> dict:
    return {"compared": 0, "changed": 0, "ai_values_used": 0, "pairs": {}}


def empty_decision_counts() -> dict:
    return {"reviews": 0, "approved": 0, "rejected": 0}


def count_decision(counts: dict, review: dict) -> None:
    counts["reviews"] += 1
    if review["decision"] == "approve":
        counts["approved"] += 1
    else:
        counts["rejected"] += 1


def add_approval_rate(counts: dict) -> None:
    counts["approval_rate"] = None
    if counts["reviews"] > 0:
        counts["approval_rate"] = round(counts["approved"] / counts["reviews"], 3)


def ai_relevance_group(assessment: dict | None, source: dict | None) -> str:
    """Which of RELEVANCE_GROUPS a review belongs to, from the AI's "relevant" answer.

    yes, unsure     what the AI said
    no_spot_check   the AI said no, and the paper was in the spot-check sample
    no_rescued      the AI said no, and someone reviewed it anyway, nearly
                    always by opening it from the Triaged out tab
    no_answer       the assessment failed, or the paper was never triaged

    The two "no" groups are how we learn what the AI misses: every approval in
    them is a relevant paper the AI would have dropped. The spot_check flag is
    read from the source, which keeps it after the decision.
    """
    parsed = parsed_result(assessment)
    if parsed is None:
        return "no_answer"
    relevant = plain(parsed.get("relevant"))
    if relevant == "yes" or relevant == "unsure":
        return str(relevant)
    flags = []
    if source is not None:
        flags = source.get("flags", [])
    if "spot_check" in flags:
        return "no_spot_check"
    return "no_rescued"


def latest_review_per_source(db) -> list[dict]:
    """Each source's newest review, oldest first. A changed decision replaces the
    earlier one in the stats, so one paper never counts twice."""
    latest_by_source: dict[str, dict] = {}
    for review in db["reviews"].find().sort("created_at", 1):
        latest_by_source[review["source_id"]] = review
    return list(latest_by_source.values())


def review_stats(db) -> dict:
    """Per prompt version: approval rates, split by what the AI said about
    relevance, and per field how often reviewers changed the AI's value, and to what."""
    reviews = latest_review_per_source(db)

    assessment_ids = []
    source_ids = []
    for review in reviews:
        if review.get("assessment_id") is not None:
            assessment_ids.append(review["assessment_id"])
        source_ids.append(review["source_id"])
    assessments_by_id = {}
    for assessment in db["ai_assessments"].find({"_id": {"$in": assessment_ids}}):
        assessments_by_id[assessment["_id"]] = assessment
    sources_by_id = {}
    for source in db["sources"].find({"_id": {"$in": source_ids}}, projection={"flags": 1}):
        sources_by_id[source["_id"]] = source

    groups: dict[str, dict] = {}
    for review in reviews:
        version = review.get("prompt_version")
        group_key = version or ""
        if group_key not in groups:
            by_relevance = {}
            for relevance_group in RELEVANCE_GROUPS:
                by_relevance[relevance_group] = empty_decision_counts()
            fields = {}
            for field in COMPARED_FIELDS:
                fields[field] = empty_field_stats()
            groups[group_key] = {
                "prompt_version": version,
                "reviews": 0,
                "approved": 0,
                "rejected": 0,
                "by_ai_relevant": by_relevance,
                "fields": fields,
            }
        group = groups[group_key]
        count_decision(group, review)

        assessment = assessments_by_id.get(review.get("assessment_id"))
        relevance_group = ai_relevance_group(assessment, sources_by_id.get(review["source_id"]))
        count_decision(group["by_ai_relevant"][relevance_group], review)

        ai_values = ai_field_values(assessment)
        final = review.get("final", {})
        for field in review.get("compared_fields", []):
            if field not in COMPARED_FIELDS:
                continue
            stats = group["fields"][field]
            stats["compared"] += 1
            if field in review.get("changed_fields", []):
                stats["changed"] += 1
            if field in review.get("ai_values_used", []):
                stats["ai_values_used"] += 1
            pair = (value_key(ai_values.get(field)), value_key(final.get(field)))
            stats["pairs"][pair] = stats["pairs"].get(pair, 0) + 1

    results = []
    for group_key in sorted(groups):
        group = groups[group_key]
        add_approval_rate(group)
        for relevance_group in RELEVANCE_GROUPS:
            add_approval_rate(group["by_ai_relevant"][relevance_group])
        for field in COMPARED_FIELDS:
            stats = group["fields"][field]
            pairs = []
            for (ai_key, final_key), count in stats["pairs"].items():
                pairs.append({"ai": value_from_key(ai_key), "final": value_from_key(final_key), "count": count})
            pairs.sort(key=lambda pair: pair["count"], reverse=True)
            stats["pairs"] = pairs
            stats["change_rate"] = None
            if stats["compared"] > 0:
                stats["change_rate"] = round(stats["changed"] / stats["compared"], 3)
        results.append(group)

    return {
        "fields": list(COMPARED_FIELDS),
        "ai_relevant_groups": list(RELEVANCE_GROUPS),
        "by_prompt_version": results,
    }
