"""The pipeline_runs document: one per run, kept current while the run goes.

The admin dashboard reads these documents to show what a run is doing, so
the recorder writes as it goes: log lines, counts, tokens, cost, and a
heartbeat at least every few seconds while there's progress.

Only one run goes at a time. A run counts as going while its status is
"running" and its heartbeat is less than 10 minutes old. Anything older is a
run that crashed or was killed, and it's marked failed so the next run can
start.
"""

import logging
import secrets
from datetime import datetime, timedelta
from typing import Literal

from sf_shared.db import now
from sf_shared.pipeline_models import PipelineRun, StageCounts, TokenUsage

from sf_pipeline.config import Runner
from sf_pipeline.store import to_doc

logger = logging.getLogger("sf_pipeline")

Trigger = Literal["schedule", "admin", "cli"]
Stage = Literal["collect", "triage"]

STALE_AFTER = timedelta(minutes=10)
HEARTBEAT_EVERY = timedelta(seconds=5)
MAX_LOG_LINES = 500  # older lines are dropped so the document stays small
STALE_MESSAGE = (
    "This run stopped sending heartbeats for 10 minutes, so it was marked failed. It probably crashed or was stopped."
)


class RunAlreadyRunning(Exception):
    """Another run is going. Its id is in `run_id`."""

    def __init__(self, run_id: str) -> None:
        super().__init__(
            f"Another pipeline run ({run_id}) is still going. "
            "Wait for it to finish, or for it to go 10 minutes without a heartbeat."
        )
        self.run_id = run_id


def new_run_id(timestamp: datetime | None = None) -> str:
    """e.g. "run-20261027-183005-4f1a9c": sortable, readable, and unique."""
    timestamp = timestamp or now()
    return f"run-{timestamp:%Y%m%d-%H%M%S}-{secrets.token_hex(3)}"


def mark_stale_runs_failed(db, current: datetime) -> int:
    cutoff = current - STALE_AFTER
    result = db["pipeline_runs"].update_many(
        {
            "status": "running",
            "$or": [
                {"heartbeat_at": {"$lt": cutoff}},
                {"heartbeat_at": None, "started_at": {"$lt": cutoff}},
            ],
        },
        {"$set": {"status": "failed", "finished_at": current}, "$push": {"errors": STALE_MESSAGE}},
    )
    return result.modified_count


def active_runs(db, current: datetime, exclude: str) -> list[dict]:
    """Runs marked running with a recent heartbeat, other than `exclude`."""
    cutoff = current - STALE_AFTER
    query = {"status": "running", "heartbeat_at": {"$gte": cutoff}, "id": {"$ne": exclude}}
    return list(db["pipeline_runs"].find(query, {"id": 1, "started_at": 1}))


def start_run(
    db,
    run_id: str,
    *,
    trigger: Trigger,
    runner: Runner,
    requested_by: str | None,
    stages: list[Stage],
    options: dict,
) -> None:
    """Mark the run as running, or raise RunAlreadyRunning.

    When the API created the document already (status "queued"), it's
    updated in place. Otherwise a new one is inserted.
    """
    runs = db["pipeline_runs"]
    current = now()
    mark_stale_runs_failed(db, current)

    others = active_runs(db, current, exclude=run_id)
    if others:
        refuse_run(db, run_id, others[0]["id"], current)

    existing = runs.find_one({"id": run_id})
    if existing is None:
        run = PipelineRun(
            id=run_id,
            trigger=trigger,
            runner=runner,
            requested_by=requested_by,
            status="running",
            stages=stages,
            options=options,
            started_at=current,
            heartbeat_at=current,
        )
        runs.insert_one(to_doc(run))
    else:
        runs.update_one(
            {"id": run_id},
            {
                "$set": {
                    "status": "running",
                    "trigger": trigger,
                    "runner": runner,
                    "requested_by": requested_by or existing.get("requested_by"),
                    "stages": stages,
                    "options": options,
                    "heartbeat_at": current,
                }
            },
        )

    # Two runs can pass the check above at the same moment. Both are written
    # by now, so look again: the one that started first keeps going.
    mine = runs.find_one({"id": run_id}, {"started_at": 1})
    my_order = (mine["started_at"], run_id)
    for other in active_runs(db, now(), exclude=run_id):
        if (other["started_at"], other["id"]) < my_order:
            refuse_run(db, run_id, other["id"], now())


def refuse_run(db, run_id: str, other_id: str, current: datetime) -> None:
    """Record why this run didn't start (if it has a document), then raise."""
    db["pipeline_runs"].update_one(
        {"id": run_id},
        {
            "$set": {"status": "failed", "finished_at": current},
            "$push": {"errors": f"Didn't start: run {other_id} was already going."},
        },
    )
    raise RunAlreadyRunning(other_id)


class RunRecorder:
    """Writes a run's progress to its pipeline_runs document as it happens."""

    def __init__(self, db, run_id: str) -> None:
        self.collection = db["pipeline_runs"]
        self.run_id = run_id
        self.counts = StageCounts()
        self.usage = TokenUsage()
        self.cost_usd = 0.0
        self.errors: list[str] = []
        self.last_heartbeat = now()

    def _update(self, update: dict) -> None:
        current = now()
        update.setdefault("$set", {})["heartbeat_at"] = current
        self.collection.update_one({"id": self.run_id}, update)
        self.last_heartbeat = current

    def log(self, message: str) -> None:
        logger.info(message)
        line = f"{now():%H:%M:%S} {message}"
        self._update({"$push": {"log": {"$each": [line], "$slice": -MAX_LOG_LINES}}})

    def error(self, message: str) -> None:
        logger.warning(message)
        self.errors.append(message)
        line = f"{now():%H:%M:%S} {message}"
        self._update({"$push": {"errors": message, "log": {"$each": [line], "$slice": -MAX_LOG_LINES}}})

    def add_counts(self, **counts: int) -> None:
        increments: dict[str, int] = {}
        for name, amount in counts.items():
            setattr(self.counts, name, getattr(self.counts, name) + amount)  # raises on a misspelled count
            increments[f"counts.{name}"] = amount
        self._update({"$inc": increments})

    def add_usage(self, usage: TokenUsage, cost: float) -> None:
        increments: dict[str, float] = {"cost_usd": cost}
        for name in TokenUsage.model_fields:
            amount = getattr(usage, name)
            setattr(self.usage, name, getattr(self.usage, name) + amount)
            increments[f"usage.{name}"] = amount
        self.cost_usd += cost
        self._update({"$inc": increments})

    def heartbeat(self) -> None:
        """Called often; writes at most every few seconds."""
        if now() - self.last_heartbeat >= HEARTBEAT_EVERY:
            self._update({})

    def finish(self, status: str) -> None:
        self._update({"$set": {"status": status, "finished_at": now()}})
