"""Run the pipeline: collect, then triage. From the command line or from the API.

    python -m sf_pipeline.run                     # collect and triage
    python -m sf_pipeline.run --stage collect     # just collect
    python -m sf_pipeline.run --limit 20 --dry-run

The API's "Run now" calls run_pipeline() in a background thread (runner
"local"), or starts .github/workflows/pipeline.yml, which runs this command
(runner "github").

Each run moves every candidate one step and keeps that state on the
candidate, so a run that crashes halfway leaves nothing to clean up: the
next run carries on from there.
"""

import argparse
import logging
import sys
from collections.abc import Iterable

import anthropic
from sf_shared.db import get_db, is_in_memory, now
from sf_shared.pipeline_models import DEFAULT_QUERIES, SearchConfig

from sf_pipeline.collect import build_collectors, run_collect_stage
from sf_pipeline.collectors.base import Collector
from sf_pipeline.config import Runner, Settings, load_settings
from sf_pipeline.runs import RunAlreadyRunning, RunRecorder, Stage, Trigger, new_run_id, start_run
from sf_pipeline.store import ensure_pipeline_indexes, from_doc, to_doc
from sf_pipeline.triage import load_prompt, make_client, run_triage_stage

logger = logging.getLogger("sf_pipeline")

STAGE_ORDER: list[Stage] = ["collect", "triage"]

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_ALREADY_RUNNING = 3

__all__ = ["RunAlreadyRunning", "load_search_config", "parse_stages", "run_pipeline"]


def parse_stages(value: str | Iterable[str]) -> list[Stage]:
    """Stage names in run order, from "all", "collect", "triage", "collect,triage" or a list."""
    if isinstance(value, str):
        names = [part.strip().lower() for part in value.replace(" ", ",").split(",") if part.strip()]
    else:
        names = [str(part).strip().lower() for part in value]
    if not names or "all" in names:
        return list(STAGE_ORDER)
    unknown = [name for name in names if name not in STAGE_ORDER]
    if unknown:
        raise ValueError(f"Unknown stage {', '.join(unknown)}. Use collect, triage or all.")
    return [stage for stage in STAGE_ORDER if stage in names]


def load_search_config(db) -> SearchConfig:
    """The team's search config. The first time, it's created with the default searches."""
    collection = db["search_config"]
    doc = collection.find_one({"id": "default"})
    if doc is None:
        default = SearchConfig(queries=list(DEFAULT_QUERIES), updated_at=now())
        # $setOnInsert, so an admin saving the config at the same moment wins.
        collection.update_one({"id": "default"}, {"$setOnInsert": to_doc(default)}, upsert=True)
        doc = collection.find_one({"id": "default"})
    return from_doc(doc, SearchConfig)


def run_pipeline(
    db,
    *,
    stages: Iterable[str],
    limit: int | None = None,
    dry_run: bool = False,
    trigger: Trigger,
    runner: Runner,
    requested_by: str | None = None,
    run_id: str | None = None,
    settings: Settings | None = None,
    collectors: dict[str, Collector] | None = None,
    anthropic_client: anthropic.Anthropic | None = None,
) -> str:
    """Run the given stages and return the run id.

    Raises RunAlreadyRunning when another run is going. Every other problem is
    recorded on the run (status "failed" or "partial", with the error) instead
    of raised, so the caller can always read the outcome from pipeline_runs.

    `settings`, `collectors` and `anthropic_client` are for tests; by default
    they come from the environment.
    """
    settings = settings or load_settings()
    stage_list = parse_stages(stages)
    run_id = run_id or new_run_id()

    options: dict = {"limit": limit, "dry_run": dry_run}
    start_run(db, run_id, trigger=trigger, runner=runner, requested_by=requested_by, stages=stage_list, options=options)
    recorder = RunRecorder(db, run_id)

    status = "failed"
    try:
        # Inside the try, so a database user that can't list or create
        # indexes fails the run with a message instead of leaving it queued.
        ensure_pipeline_indexes(db)
        config = load_search_config(db)
        db["pipeline_runs"].update_one({"id": run_id}, {"$set": {"options.lookback_days": config.lookback_days}})
        what = " and ".join(stage_list)
        recorder.log(f"Started ({what}{', dry run' if dry_run else ''}{f', limit {limit}' if limit else ''}).")

        stage_ok: list[bool] = []
        would_be_new = 0
        if "collect" in stage_list:
            collectors = collectors or build_collectors(settings, heartbeat=recorder.heartbeat)
            collected = run_collect_stage(db, config, settings, collectors, recorder, limit=limit, dry_run=dry_run)
            stage_ok.append(collected.ok)
            if dry_run:
                would_be_new = collected.new

        if "triage" in stage_list:
            client = anthropic_client or (None if dry_run else make_client(settings))
            prompt = load_prompt(settings.content_dir, db=db)
            triaged_ok = run_triage_stage(
                db,
                client,
                config,
                recorder,
                prompt=prompt,
                run_id=run_id,
                limit=limit,
                dry_run=dry_run,
                would_be_new=would_be_new,
            )
            stage_ok.append(triaged_ok)
            if dry_run and not settings.triage_configured:
                recorder.log("ANTHROPIC_API_KEY isn't set, so a real run would skip triage.")

        if not any(stage_ok):
            status = "failed"
        elif recorder.errors:
            status = "partial"
        else:
            status = "succeeded"
    except Exception as error:  # noqa: BLE001  recorded on the run, so the dashboard shows it
        logger.exception("Pipeline run %s crashed", run_id)
        recorder.error(f"The run stopped with an error: {type(error).__name__}: {error}")
        status = "failed"
    finally:
        recorder.log(f"Finished: {status}. Cost ${recorder.cost_usd:.4f}.")
        recorder.finish(status)
    return run_id


# ---------------------------------------------------------------------------
# Command line


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m sf_pipeline.run", description="Collect and triage new papers.")
    parser.add_argument("--stage", default="all", help="collect, triage, all (the default), or collect,triage")
    parser.add_argument("--limit", type=int, help="fetch at most N papers per search and collector, and triage at most N")
    parser.add_argument("--dry-run", action="store_true", help="fetch and count, but write no candidates and call no model")
    parser.add_argument("--trigger", choices=["cli", "schedule", "admin"], default="cli", help="what started the run (default cli)")
    parser.add_argument("--runner", choices=["local", "github"], help="defaults to PIPELINE_RUNNER, or local")
    parser.add_argument("--run-id", help="use this pipeline_runs document, e.g. one the API created as queued")
    parser.add_argument("--requested-by", help="email of the person who started the run")
    return parser


def print_summary(db, run_id: str) -> str:
    run = db["pipeline_runs"].find_one({"id": run_id}) or {}
    counts = run.get("counts", {})
    status = run.get("status", "unknown")
    print()
    print(f"Run {run_id}: {status}")
    print("  " + ", ".join(f"{name} {value}" for name, value in counts.items()))
    print(f"  cost ${run.get('cost_usd', 0.0):.4f}")
    for message in run.get("errors", []):
        print(f"  error: {message}")
    return status


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    args = build_parser().parse_args(argv)
    settings = load_settings()
    try:
        stages = parse_stages(args.stage)
    except ValueError as error:
        print(error, file=sys.stderr)
        return EXIT_FAILED
    if args.limit is not None and args.limit < 1:
        print("--limit has to be 1 or more.", file=sys.stderr)
        return EXIT_FAILED

    if is_in_memory(settings.mongo_uri):
        logger.info("MONGO_URI isn't set, so this run uses an in-memory database that's gone when the command ends.")
    if not settings.triage_configured and "triage" in stages and not args.dry_run:
        logger.info("ANTHROPIC_API_KEY isn't set, so triage will be skipped.")

    db = get_db(settings.mongo_uri)
    try:
        run_id = run_pipeline(
            db,
            stages=stages,
            limit=args.limit,
            dry_run=args.dry_run,
            trigger=args.trigger,
            runner=args.runner or settings.runner,
            requested_by=args.requested_by,
            run_id=args.run_id,
            settings=settings,
        )
    except RunAlreadyRunning as error:
        print(error, file=sys.stderr)
        return EXIT_ALREADY_RUNNING

    status = print_summary(db, run_id)
    return EXIT_FAILED if status == "failed" else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
