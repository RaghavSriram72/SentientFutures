"""Milestones in MongoDB: checking, saving, importing, and the public copy.

The milestone editor in admin saves through here. Every save:

  1. validates the milestone with the shared Milestone model (models.py), so
     it follows the same rules as content/milestones.json, em dashes included
  2. checks it against the other milestones: every depends_on exists and
     there are no dependency cycles
  3. checks every source id (source_ids, each forecast's source_id, and the
     source_ids on its claims) against the source catalog (catalog.py). A
     real milestone can't cite a sample source or depend on a sample
     milestone, because the public site leaves samples out
  4. keeps the published set complete: a published milestone can only depend
     on published ones, and a milestone that published ones depend on can't
     be unpublished
  5. writes it with version + 1, but only if nobody saved it since the editor
     opened it (otherwise 409, like a review conflict)
  6. inserts a full copy into milestone_revisions, which is insert-only

Problems come back as a 422 with one line per problem, each starting with its
path in the request body, like "milestone.forecasts[0].quote: required".
"""

from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError
from pymongo.errors import DuplicateKeyError

from sf_api.catalog import catalog_ids, catalog_sample_ids
from sf_api.documents import from_document, iso, to_document
from sf_api.editing import ImportProblems, ImportResult, new_revision_id
from sf_api.errors import ApiError, validation_problems
from sf_shared.claims import compact_dump, find_claims, join_path
from sf_shared.db import now
from sf_shared.editor_models import MILESTONE_EDITOR_FIELDS, MilestoneRevision, RevisionAction
from sf_shared.models import Milestone
from sf_shared.validate import (
    EM_DASH_FIX,
    Record,
    check_claim_sources,
    check_dependencies,
    check_milestone_sources,
    check_unique_ids,
    em_dash_paths,
    find_cycles,
    format_validation_error,
    record_label,
    sample_ids,
    sample_link_problems,
)


class NewMilestoneBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    milestone: dict
    # New milestones start as drafts unless this says otherwise.
    published: bool = False


class SaveMilestoneBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    milestone: dict
    version: int  # the version the editor started from
    published: bool


# ---------- Moving between the stored document and the public shape ----------


def milestone_fields(document: dict) -> dict:
    """The public Milestone fields of a stored milestone: no _id and no editor fields."""
    fields = {}
    for key, value in document.items():
        if key == "_id" or key in MILESTONE_EDITOR_FIELDS:
            continue
        fields[key] = value
    return fields


def record_json(document: dict) -> dict:
    """A stored milestone as the admin pages get it: the Milestone fields plus the editor fields."""
    return from_document(document)


def milestone_document(milestone: Milestone, published: bool, version: int, position: int, user: dict) -> dict:
    document = milestone.model_dump(mode="json")
    document["_id"] = milestone.id
    document["published"] = published
    document["version"] = version
    document["position"] = position
    document["updated_by"] = user["email"]
    document["updated_by_name"] = user["name"]
    document["updated_at"] = now()
    return document


def insert_revision(db, document: dict, action: RevisionAction) -> None:
    revision = MilestoneRevision(
        id=new_revision_id(),
        milestone_id=document["_id"],
        version=document["version"],
        published=document["published"],
        action=action,
        milestone=milestone_fields(document),
        saved_by=document["updated_by"],
        saved_by_name=document["updated_by_name"],
        saved_at=document["updated_at"],
    )
    db["milestone_revisions"].insert_one(to_document(revision))


def next_position(db) -> int:
    """One past the last position, so a new milestone is listed last."""
    last = db["milestones"].find_one(sort=[("position", -1)], projection={"position": 1})
    if last is None:
        return 0
    return int(last.get("position", 0)) + 1


# ---------- Checking ----------


def invalid(problems: list[str]) -> ApiError:
    return ApiError(422, "invalid_milestone", "Some fields aren't valid.", problems)


def without_editor_fields(raw: dict) -> dict:
    """The editor may send a record back as it got it. Its editor fields are ignored."""
    fields = {}
    for key, value in raw.items():
        if key not in MILESTONE_EDITOR_FIELDS:
            fields[key] = value
    return fields


def parse_milestone(raw: dict) -> Milestone:
    try:
        return Milestone.model_validate(raw)
    except ValidationError as error:
        raise invalid(validation_problems(error, "milestone")) from None


def em_dash_problems(milestone: Milestone, prefix: str = "milestone") -> list[str]:
    problems = []
    for path in em_dash_paths(milestone.model_dump(mode="json"), prefix):
        problems.append(f"{path}: has an em dash. {EM_DASH_FIX}")
    return problems


def link_problems(milestone: Milestone, published: bool, others: list[dict]) -> list[str]:
    """Problems with depends_on and with publishing, given every other milestone."""
    known_ids = set()
    published_ids = set()
    for other in others:
        known_ids.add(other["_id"])
        if other.get("published"):
            published_ids.add(other["_id"])

    problems = []
    edges = []
    for index, dependency in enumerate(milestone.depends_on):
        path = f"milestone.depends_on[{index}]"
        if dependency == milestone.id:
            problems.append(f"{path}: a milestone can't depend on itself")
        elif dependency not in known_ids:
            problems.append(f'{path}: no milestone with id "{dependency}"')
        else:
            edges.append(dependency)
            if published and dependency not in published_ids:
                problems.append(
                    f'{path}: "{dependency}" isn\'t published yet. Publish it first, or keep this milestone as a draft'
                )

    # The whole graph with this milestone's new links swapped in.
    graph: dict[str, list[str]] = {}
    for other in others:
        links = []
        for dependency in other.get("depends_on", []):
            if dependency in known_ids or dependency == milestone.id:
                links.append(dependency)
        graph[other["_id"]] = links
    graph[milestone.id] = edges
    for cycle in find_cycles(graph):
        if milestone.id in cycle:
            problems.append(
                f"milestone.depends_on: dependency cycle: {' -> '.join(cycle)}. Remove one of these links"
            )

    if not published:
        dependents = []
        for other in others:
            if other.get("published") and milestone.id in other.get("depends_on", []):
                dependents.append(other["_id"])
        if len(dependents) > 0:
            problems.append(
                f"published: published milestones depend on this one ({', '.join(sorted(dependents))}). "
                "Unpublish them or remove their links first"
            )
    return problems


def source_problems(milestone: Milestone, known_source_ids: set[str], prefix: str = "milestone") -> list[str]:
    """Every source id the milestone uses that isn't in the source catalog."""
    hint = "Pick one from the source catalog (content/sources.json or a source approved in admin)"
    problems = []
    for index, source_id in enumerate(milestone.source_ids):
        if source_id not in known_source_ids:
            problems.append(f'{join_path(prefix, f"source_ids[{index}]")}: no source with id "{source_id}". {hint}')
    for index, forecast in enumerate(milestone.forecasts):
        if forecast.source_id not in known_source_ids:
            location = join_path(prefix, f"forecasts[{index}].source_id")
            problems.append(f'{location}: no source with id "{forecast.source_id}". {hint}')
    for path, claim in find_claims(milestone):
        for index, source_id in enumerate(claim.source_ids):
            if source_id not in known_source_ids:
                location = join_path(join_path(prefix, path), f"source_ids[{index}]")
                problems.append(f'{location}: no source with id "{source_id}". {hint}')
    return problems


def other_milestones(db, milestone_id: str) -> list[dict]:
    return list(
        db["milestones"].find(
            {"_id": {"$ne": milestone_id}}, projection={"depends_on": 1, "published": 1, "sample": 1}
        )
    )


def sample_milestone_ids(others: list[dict]) -> set[str]:
    ids = set()
    for other in others:
        if other.get("sample") is True:
            ids.add(other["_id"])
    return ids


def check_milestone(db, content_dir: Path, raw: dict, published: bool) -> Milestone:
    """The validated milestone, or a 422 listing every problem."""
    milestone = parse_milestone(without_editor_fields(raw))
    others = other_milestones(db, milestone.id)
    problems = em_dash_problems(milestone)
    problems.extend(link_problems(milestone, published, others))
    problems.extend(source_problems(milestone, catalog_ids(db, content_dir)))
    problems.extend(
        sample_link_problems(
            milestone, catalog_sample_ids(db, content_dir), sample_milestone_ids(others), "milestone"
        )
    )
    if len(problems) > 0:
        raise invalid(problems)
    return milestone


def version_conflict(current: dict | None) -> ApiError:
    if current is None:
        return ApiError(409, "version_conflict", "This milestone was deleted after you opened it.")
    details = {
        "current_version": current.get("version"),
        "updated_by_name": current.get("updated_by_name"),
        "updated_at": iso(current["updated_at"]) if current.get("updated_at") else None,
    }
    message = (
        f"This milestone was saved again after you opened it (by {current.get('updated_by_name')}, "
        f"now version {current.get('version')}). Reload to see that version, then make your change again."
    )
    return ApiError(409, "version_conflict", message, details)


# ---------- Saving ----------


def create_milestone(db, content_dir: Path, body: NewMilestoneBody, user: dict) -> dict:
    """Insert a new milestone (version 1) and its first revision. Returns the stored document."""
    milestone = parse_milestone(without_editor_fields(body.milestone))
    if db["milestones"].find_one({"_id": milestone.id}, projection={"_id": 1}) is not None:
        raise ApiError(409, "id_taken", f'A milestone with the id "{milestone.id}" already exists. Pick another id.')
    milestone = check_milestone(db, content_dir, body.milestone, body.published)

    document = milestone_document(milestone, body.published, 1, next_position(db), user)
    try:
        db["milestones"].insert_one(document)
    except DuplicateKeyError:
        raise ApiError(409, "id_taken", f'A milestone with the id "{milestone.id}" already exists. Pick another id.') from None
    insert_revision(db, document, "create")
    # Read back, so times come out as stored (MongoDB keeps milliseconds).
    return db["milestones"].find_one({"_id": milestone.id})


def save_milestone(db, content_dir: Path, milestone_id: str, body: SaveMilestoneBody, user: dict) -> dict:
    """Replace a milestone, if body.version is still its version. Returns the stored document."""
    existing = db["milestones"].find_one({"_id": milestone_id})
    if existing is None:
        raise ApiError(404, "not_found", f"No milestone with id {milestone_id}.")
    if body.version != existing.get("version"):
        raise version_conflict(existing)

    raw = dict(body.milestone)
    if "id" not in raw:
        raw["id"] = milestone_id
    if raw["id"] != milestone_id:
        raise invalid(
            [
                f'milestone.id: can\'t change from "{milestone_id}". A milestone keeps its id, '
                "because links, the timeline and other milestones use it"
            ]
        )
    milestone = check_milestone(db, content_dir, raw, body.published)

    document = milestone_document(milestone, body.published, body.version + 1, existing.get("position", 0), user)
    result = db["milestones"].replace_one({"_id": milestone_id, "version": body.version}, document)
    if result.matched_count == 0:
        # Someone saved between our read and our write.
        raise version_conflict(db["milestones"].find_one({"_id": milestone_id}))
    insert_revision(db, document, "update")
    return db["milestones"].find_one({"_id": milestone_id})


# ---------- Importing (the CLI, and the in-memory seed) ----------


def import_problems(db, content_dir: Path, records: list) -> tuple[list[Record], list[str]]:
    """Validate a whole milestones file the way validate.py does. Returns the records and any problems."""
    problems: list[str] = []
    checked: list[Record] = []
    for index, raw in enumerate(records):
        label = record_label("milestones", index, raw)
        model = None
        try:
            model = Milestone.model_validate(raw)
        except ValidationError as error:
            problems.extend(format_validation_error(label, error))
        checked.append(Record(label=label, raw=raw, model=model))

    check_unique_ids(checked, problems)
    check_dependencies(checked, problems)
    known_source_ids = catalog_ids(db, content_dir)
    sample_source_ids = catalog_sample_ids(db, content_dir)
    sample_record_ids = sample_ids(checked)
    for record in checked:
        check_claim_sources(record, known_source_ids, problems)
        if isinstance(record.model, Milestone):
            check_milestone_sources(record.model, record.label, known_source_ids, problems)
            problems.extend(
                sample_link_problems(record.model, sample_source_ids, sample_record_ids, record.label)
            )
    return checked, problems


def import_milestones(
    db,
    content_dir: Path,
    records: list,
    action: RevisionAction,
    user: dict,
    replace_existing: bool = False,
) -> ImportResult:
    """Save every milestone in a content/milestones.json-style list as published.

    Nothing is saved unless the whole list is valid. A milestone already in
    the database is kept as it is unless replace_existing is set; then it
    gets a new version (its earlier versions stay in milestone_revisions).
    Sample milestones keep their sample flag; the public site hides them.
    """
    if not isinstance(records, list):
        raise ImportProblems(["The file should be a list of milestones, starting with [ and ending with ]"])
    checked, problems = import_problems(db, content_dir, records)
    if len(problems) > 0:
        raise ImportProblems(problems)

    result = ImportResult()
    for position, record in enumerate(checked):
        milestone = record.model
        assert isinstance(milestone, Milestone)  # every record validated above
        existing = db["milestones"].find_one({"_id": milestone.id}, projection={"version": 1})
        if existing is not None and not replace_existing:
            result.kept += 1
            continue
        version = 1 if existing is None else int(existing.get("version", 0)) + 1
        document = milestone_document(milestone, True, version, position, user)
        db["milestones"].replace_one({"_id": milestone.id}, document, upsert=True)
        insert_revision(db, document, action)
        if existing is None:
            result.added += 1
        else:
            result.replaced += 1
    return result


# ---------- The public copy ----------


def is_live(db) -> bool:
    """True once milestones have been imported or created. Until then the
    publish step uses content/milestones.json."""
    return db["milestones"].find_one({}, projection={"_id": 1}) is not None


def public_milestones(db, content_dir: Path) -> tuple[list[dict], list[dict]]:
    """The published milestones in the public Milestone shape, in list order, and the ones left out.

    Saving already enforces these rules. They're checked again here so that a
    record changed some other way (a source rejected after a milestone cited
    it, say) is left out with its problems, instead of failing the whole publish.
    """
    known_source_ids = catalog_ids(db, content_dir)
    skipped: list[dict] = []
    kept: list[Milestone] = []
    for document in db["milestones"].find({"published": True}).sort([("position", 1), ("_id", 1)]):
        try:
            milestone = Milestone.model_validate(milestone_fields(document))
        except ValidationError as error:
            skipped.append({"id": document["_id"], "problems": validation_problems(error)})
            continue
        problems = source_problems(milestone, known_source_ids, prefix="")
        problems.extend(em_dash_problems(milestone, prefix=""))
        if len(problems) > 0:
            skipped.append({"id": milestone.id, "problems": problems})
            continue
        kept.append(milestone)

    # Leaving one out can break another's depends_on, so repeat until nothing changes.
    changed = True
    while changed:
        changed = False
        kept_ids = set()
        for milestone in kept:
            kept_ids.add(milestone.id)
        still_kept = []
        for milestone in kept:
            missing = []
            for dependency in milestone.depends_on:
                if dependency not in kept_ids:
                    missing.append(dependency)
            if len(missing) > 0:
                problem = f"depends_on: {', '.join(missing)} isn't published or was left out"
                skipped.append({"id": milestone.id, "problems": [problem]})
                changed = True
            else:
                still_kept.append(milestone)
        kept = still_kept

    milestones = []
    for milestone in kept:
        milestones.append(compact_dump(milestone))
    return milestones, skipped
