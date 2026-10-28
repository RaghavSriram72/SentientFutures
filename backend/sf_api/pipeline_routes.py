"""The admin dashboard's pipeline routes: status, runs and the search config."""

from typing import Literal

from flask import Blueprint, jsonify
from pydantic import BaseModel, ConfigDict, Field

from sf_api.app_state import app_config, app_db
from sf_api.auth import current_user
from sf_api.documents import from_document, to_document
from sf_api.errors import ApiError, parse_body, query_int
from sf_api.pipeline_rules import model_problem, priced_models, search_text_problems
from sf_api.runner import RunRequest, fail_stale_runs, find_active_run, start_run
from sf_api.seed import default_search_config
from sf_shared.db import now
from sf_shared.pipeline_models import ReviewStatus, SearchConfig

blueprint = Blueprint("pipeline", __name__, url_prefix="/api/pipeline")

STAGE_ORDER = ("collect", "triage")


class StartRunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stages: list[Literal["collect", "triage"]] = ["collect", "triage"]
    limit: int | None = Field(default=None, ge=1, le=5000)
    dry_run: bool = False


def run_json(run: dict, include_log: bool = True) -> dict:
    result = from_document(run)
    if not include_log:
        result.pop("log", None)
    return result


def review_status_counts(db) -> dict[str, int]:
    counts = {}
    for status in ReviewStatus:
        counts[status.value] = 0
    rows = db["sources"].aggregate([{"$group": {"_id": "$review_status", "count": {"$sum": 1}}}])
    for row in rows:
        status = str(row["_id"])
        if status in counts:
            counts[status] = row["count"]
    return counts


def stages_in_order(stages: list[str]) -> list[str]:
    """['triage', 'collect', 'triage'] -> ['collect', 'triage']"""
    ordered = []
    for stage in STAGE_ORDER:
        if stage in stages:
            ordered.append(stage)
    return ordered


def search_config_problems(config: SearchConfig) -> list[str]:
    """Rules SearchConfig can't express.

    Labels are stored on candidates, so they must be unique. The search text
    and the model are checked with the pipeline's own code (see
    pipeline_rules.py), so settings the next run would refuse aren't saved.
    """
    problems = []
    seen_labels = set()
    for index, query in enumerate(config.queries):
        label = query.label.strip()
        if label == "":
            problems.append(f"queries[{index}].label: must not be empty")
        elif label.lower() in seen_labels:
            problems.append(f'queries[{index}].label: "{label}" is already used by another search')
        seen_labels.add(label.lower())
        if query.text.strip() == "":
            problems.append(f"queries[{index}].text: must not be empty")
        else:
            for message in search_text_problems(query.text, query.collectors):
                problems.append(f"queries[{index}].text: {message}")
        if len(query.collectors) == 0:
            problems.append(f"queries[{index}].collectors: pick at least one (arxiv, semantic_scholar)")

    problem = model_problem(config.model)
    if problem is not None:
        problems.append(f"model: {problem}")
    return problems


def search_config_json(config: dict, saved: bool) -> dict:
    """The config, whether it's saved, and the models the settings page can offer (null if unknown)."""
    return {"config": config, "saved": saved, "models": priced_models()}


@blueprint.get("/status")
def pipeline_status():
    db = app_db()
    config = app_config()
    # Correct the stored status of runs that died first, so latest_run never
    # shows a dead run as queued or running.
    fail_stale_runs(db)
    latest = db["pipeline_runs"].find_one(sort=[("started_at", -1)])
    active = find_active_run(db)
    latest_json = None
    if latest is not None:
        latest_json = run_json(latest, include_log=False)
    active_id = None
    if active is not None:
        active_id = active["_id"]
    return jsonify(
        {
            "counts": review_status_counts(db),
            "latest_run": latest_json,
            "running": active is not None,
            "active_run_id": active_id,
            "runner": config.pipeline_runner,
            "triage_configured": config.triage_configured,
        }
    )


@blueprint.get("/runs")
def list_runs():
    limit = query_int("limit", default=20, minimum=1, maximum=100)
    db = app_db()
    fail_stale_runs(db)
    runs = db["pipeline_runs"].find().sort("started_at", -1).limit(limit)
    items = []
    for run in runs:
        items.append(run_json(run, include_log=False))
    return jsonify({"runs": items})


@blueprint.get("/runs/<run_id>")
def get_run(run_id: str):
    db = app_db()
    fail_stale_runs(db)
    run = db["pipeline_runs"].find_one({"_id": run_id})
    if run is None:
        raise ApiError(404, "not_found", f"No run with id {run_id}.")
    return jsonify({"run": run_json(run)})


@blueprint.post("/runs")
def create_run():
    body = parse_body(StartRunBody)
    stages = stages_in_order(body.stages)
    if len(stages) == 0:
        raise ApiError(400, "invalid_body", "Pick at least one stage: collect, triage or both.")
    run_request = RunRequest(
        stages=stages,
        limit=body.limit,
        dry_run=body.dry_run,
        requested_by=current_user()["email"],
    )
    run = start_run(app_db(), app_config(), run_request)
    return jsonify({"run": run_json(run)}), 202


@blueprint.get("/config")
def get_search_config():
    document = app_db()["search_config"].find_one({"_id": "default"})
    if document is None:
        # Nothing saved yet: show the defaults, and say so.
        return jsonify(search_config_json(default_search_config().model_dump(mode="json"), saved=False))
    return jsonify(search_config_json(from_document(document), saved=True))


@blueprint.put("/config")
def put_search_config():
    config = parse_body(SearchConfig)
    problems = search_config_problems(config)
    if len(problems) > 0:
        raise ApiError(400, "invalid_body", "Some searches aren't valid.", problems)

    # Who saved it and when come from the server, whatever the body says.
    config.updated_by = current_user()["email"]
    config.updated_at = now()
    document = to_document(config)
    app_db()["search_config"].replace_one({"_id": "default"}, document, upsert=True)
    return jsonify(search_config_json(from_document(document), saved=True))
