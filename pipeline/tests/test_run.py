"""The run loop: the run document, the one-run-at-a-time lock, dry runs, and failures."""

from dataclasses import replace
from datetime import timedelta

import httpx
import mongomock
import pytest
from fakes import FakeAnthropic, message, no_json, paper, triage_json
from pymongo.errors import OperationFailure
from sf_shared.db import ensure_indexes, now
from sf_shared.pipeline_models import PipelineRun, SearchConfig, SearchQuery

from sf_pipeline import run as run_module
from sf_pipeline import runs
from sf_pipeline.run import load_search_config, main, parse_stages, run_pipeline
from sf_pipeline.runs import RunAlreadyRunning, RunRecorder, start_run
from sf_pipeline.store import ensure_pipeline_indexes, from_doc, to_doc


class FakeCollector:
    def __init__(self, name: str, papers=None, error: Exception | None = None) -> None:
        self.name = name
        self.display_name = name
        self.papers = papers or []
        self.error = error
        self.calls: list[tuple[str, int]] = []

    def search(self, query, window, max_results):
        self.calls.append((query.label, max_results))
        for found in self.papers[:max_results]:
            yield found.model_copy(update={"query_label": query.label, "collector": self.name})
        if self.error:
            raise self.error


def one_search_config(db) -> None:
    config = SearchConfig(queries=[SearchQuery(label="Test search", text="brain AND alignment")])
    db["search_config"].insert_one(to_doc(config))


def fake_collectors(arxiv_papers=None, scholar_papers=None, scholar_error=None):
    return {
        "arxiv": FakeCollector("arxiv", arxiv_papers),
        "semantic_scholar": FakeCollector("semantic_scholar", scholar_papers, scholar_error),
    }


def get_run(db, run_id: str) -> PipelineRun:
    return from_doc(db["pipeline_runs"].find_one({"id": run_id}), PipelineRun)


def running_run(db, run_id: str, minutes_since_heartbeat: int) -> None:
    beat = now() - timedelta(minutes=minutes_since_heartbeat)
    run = PipelineRun(
        id=run_id, trigger="cli", runner="local", status="running", stages=["collect"], started_at=beat, heartbeat_at=beat
    )
    db["pipeline_runs"].insert_one(to_doc(run))


# ---------------------------------------------------------------------------
# Whole runs


def test_a_full_run_collects_triages_and_records_everything(db, settings):
    one_search_config(db)
    collectors = fake_collectors(
        arxiv_papers=[paper(arxiv_id="2610.11111"), paper(arxiv_id="2610.22222", title="Motor imagery decoding")],
        scholar_papers=[paper(collector="semantic_scholar", arxiv_id="2610.11111", s2_id="s2aaa")],
    )
    client = FakeAnthropic([message(triage_json()), message(no_json("Motor imagery"))])

    run_id = run_pipeline(
        db, stages=["collect", "triage"], trigger="admin", runner="local", requested_by="raghav@example.com",
        settings=settings, collectors=collectors, anthropic_client=client,
    )

    run = get_run(db, run_id)
    assert run.status == "succeeded"
    assert run.trigger == "admin" and run.requested_by == "raghav@example.com"
    assert run.stages == ["collect", "triage"]
    assert run.counts.fetched == 3 and run.counts.new == 2 and run.counts.duplicates == 1
    assert run.counts.triaged == 2 and run.counts.relevant == 1 and run.counts.triaged_out == 1
    assert run.usage.output_tokens == 1200
    assert run.cost_usd > 0
    assert run.finished_at is not None and run.heartbeat_at is not None
    assert run.options["lookback_days"] == 14
    assert any("Finished: succeeded" in line for line in run.log)
    assert db["sources"].count_documents({"review_status": "pending_review"}) == 1


def test_the_search_config_is_seeded_with_the_default_searches(db):
    config = load_search_config(db)
    assert len(config.queries) == 6
    assert db["search_config"].find_one({"id": "default"})["_id"] == "default"
    assert load_search_config(db) == config  # the second call reads the same document


def test_a_dry_run_writes_no_candidates_and_calls_no_model(db, settings):
    one_search_config(db)
    collectors = fake_collectors(arxiv_papers=[paper(arxiv_id="2610.11111"), paper(arxiv_id="2610.22222", title="Other")])
    client = FakeAnthropic([])

    run_id = run_pipeline(
        db, stages="all", dry_run=True, trigger="cli", runner="local", settings=settings, collectors=collectors, anthropic_client=client
    )

    run = get_run(db, run_id)
    assert run.status == "succeeded"
    assert run.options["dry_run"] is True
    assert run.counts.new == 2 and run.counts.triaged == 2
    assert db["sources"].count_documents({}) == 0
    assert db["ai_assessments"].count_documents({}) == 0
    assert client.messages.calls == []


def test_limit_caps_each_search(db, settings):
    one_search_config(db)
    collectors = fake_collectors(arxiv_papers=[paper(arxiv_id=f"2610.{30000 + n}", title=f"P{n}") for n in range(5)])
    run_pipeline(db, stages="collect", limit=2, trigger="cli", runner="local", settings=settings, collectors=collectors)
    assert collectors["arxiv"].calls == [("Test search", 2)]
    assert db["sources"].count_documents({}) == 2


def test_a_second_run_on_the_same_database_works(db, settings):
    # Each run calls ensure_indexes again. On mongomock that used to fail once
    # two candidates had no DOI, so every local run after the first failed.
    one_search_config(db)
    first_papers = [paper(arxiv_id=f"2610.{40000 + n}", title=f"First {n}") for n in range(2)]
    first = run_pipeline(
        db, stages="collect", trigger="cli", runner="local", settings=settings, collectors=fake_collectors(first_papers)
    )
    second_papers = [paper(arxiv_id="2610.49999", title="Second")]
    second = run_pipeline(
        db, stages="collect", trigger="cli", runner="local", settings=settings, collectors=fake_collectors(second_papers)
    )
    assert get_run(db, first).status == "succeeded"
    assert get_run(db, second).status == "succeeded"
    assert db["sources"].count_documents({}) == 3


def test_a_failing_collector_does_not_stop_the_run(db, settings):
    one_search_config(db)
    collectors = fake_collectors(
        arxiv_papers=[paper(arxiv_id="2610.11111")],
        scholar_papers=[paper(collector="semantic_scholar", s2_id="s2keep", arxiv_id=None, title="Kept")],
        scholar_error=httpx.ConnectError("no route"),
    )
    run_id = run_pipeline(db, stages="collect", trigger="cli", runner="local", settings=settings, collectors=collectors)

    run = get_run(db, run_id)
    assert run.status == "partial"
    assert "semantic_scholar failed" in run.errors[0] and "Kept the 1 paper it returned" in run.errors[0]
    assert db["sources"].count_documents({}) == 2


def test_every_collector_failing_fails_the_run(db, settings):
    one_search_config(db)
    collectors = {
        "arxiv": FakeCollector("arxiv", error=httpx.ConnectError("down")),
        "semantic_scholar": FakeCollector("semantic_scholar", error=httpx.ConnectError("down")),
    }
    run_id = run_pipeline(db, stages="collect", trigger="cli", runner="local", settings=settings, collectors=collectors)
    assert get_run(db, run_id).status == "failed"


def test_triage_without_a_key_is_skipped_and_the_run_still_succeeds(db, settings):
    one_search_config(db)
    no_key = replace(settings, anthropic_api_key=None)
    collectors = fake_collectors(arxiv_papers=[paper(arxiv_id="2610.11111")])
    run_id = run_pipeline(db, stages="all", trigger="schedule", runner="github", settings=no_key, collectors=collectors)

    run = get_run(db, run_id)
    assert run.status == "succeeded"
    assert run.counts.skipped == 1
    assert any("ANTHROPIC_API_KEY isn't set" in line for line in run.log)


def test_an_unexpected_error_is_recorded_on_the_run(db, settings):
    db["search_config"].insert_one({"_id": "default", "id": "default", "queries": "not a list"})
    run_id = run_pipeline(db, stages="collect", trigger="cli", runner="local", settings=settings, collectors=fake_collectors())
    run = get_run(db, run_id)
    assert run.status == "failed"
    assert "The run stopped with an error: ValidationError" in run.errors[0]


# ---------------------------------------------------------------------------
# Indexes and the database user


class PipelineOnlyDatabase:
    """Stands in for a database user that can only reach the pipeline's own collections."""

    ALLOWED = {"sources", "ai_assessments", "pipeline_runs", "search_config"}

    def __init__(self, db) -> None:
        self.db = db

    def __getitem__(self, name: str):
        if name not in self.ALLOWED:
            raise OperationFailure(f"not authorized on {name}")
        return self.db[name]


def test_a_run_needs_only_the_pipelines_own_collections(db, settings):
    one_search_config(db)
    collectors = fake_collectors(arxiv_papers=[paper(arxiv_id="2610.11111")])
    client = FakeAnthropic([message(triage_json())])
    run_id = run_pipeline(
        PipelineOnlyDatabase(db), stages="all", trigger="cli", runner="local",
        settings=settings, collectors=collectors, anthropic_client=client,
    )
    assert get_run(db, run_id).status == "succeeded"


def test_the_pipeline_indexes_match_the_shared_ones():
    shared = mongomock.MongoClient(tz_aware=True)["shared_indexes"]
    ensure_indexes(shared)
    pipeline = mongomock.MongoClient(tz_aware=True)["pipeline_indexes"]
    ensure_pipeline_indexes(pipeline)
    for name in ("sources", "ai_assessments", "pipeline_runs"):
        assert pipeline[name].index_information() == shared[name].index_information(), name
    assert "reviews" not in pipeline.list_collection_names()


def test_an_index_failure_fails_the_queued_run_instead_of_leaving_it_queued(db, settings, monkeypatch):
    def no_permission(database) -> None:
        raise OperationFailure("not authorized to create indexes")

    monkeypatch.setattr(run_module, "ensure_pipeline_indexes", no_permission)
    queued = PipelineRun(id="run-from-api", trigger="admin", runner="github", status="queued", stages=["collect"], started_at=now())
    db["pipeline_runs"].insert_one(to_doc(queued))

    run_pipeline(db, stages="collect", trigger="admin", runner="github", run_id="run-from-api", settings=settings, collectors=fake_collectors())
    run = get_run(db, "run-from-api")
    assert run.status == "failed"
    assert "OperationFailure: not authorized to create indexes" in run.errors[0]


# ---------------------------------------------------------------------------
# One run at a time


def test_a_second_run_is_refused_while_one_is_going(db, settings):
    running_run(db, "run-busy", minutes_since_heartbeat=1)
    with pytest.raises(RunAlreadyRunning) as raised:
        run_pipeline(db, stages="collect", trigger="cli", runner="local", settings=settings, collectors=fake_collectors())
    assert raised.value.run_id == "run-busy"
    assert db["pipeline_runs"].count_documents({}) == 1


def test_a_queued_run_that_cannot_start_is_marked_failed(db, settings):
    running_run(db, "run-busy", minutes_since_heartbeat=1)
    queued = PipelineRun(id="run-queued", trigger="admin", runner="local", status="queued", stages=["collect"], started_at=now())
    db["pipeline_runs"].insert_one(to_doc(queued))
    with pytest.raises(RunAlreadyRunning):
        run_pipeline(db, stages="collect", trigger="admin", runner="local", run_id="run-queued", settings=settings, collectors=fake_collectors())
    run = get_run(db, "run-queued")
    assert run.status == "failed"
    assert "run-busy was already going" in run.errors[0]


def test_a_run_with_a_stale_heartbeat_is_marked_failed_and_a_new_one_starts(db, settings):
    running_run(db, "run-crashed", minutes_since_heartbeat=11)
    run_id = run_pipeline(db, stages="collect", trigger="cli", runner="local", settings=settings, collectors=fake_collectors())
    crashed = get_run(db, "run-crashed")
    assert crashed.status == "failed"
    assert crashed.errors == [runs.STALE_MESSAGE]
    assert get_run(db, run_id).status == "succeeded"


def test_a_queued_run_document_is_used_in_place(db, settings):
    queued = PipelineRun(
        id="run-from-api", trigger="admin", runner="local", status="queued", stages=["collect"], started_at=now(),
        requested_by="vilija@example.com",
    )
    db["pipeline_runs"].insert_one(to_doc(queued))
    run_id = run_pipeline(db, stages="collect", trigger="admin", runner="local", run_id="run-from-api", settings=settings, collectors=fake_collectors())
    assert run_id == "run-from-api"
    assert db["pipeline_runs"].count_documents({}) == 1
    run = get_run(db, run_id)
    assert run.status == "succeeded" and run.requested_by == "vilija@example.com"


def test_when_two_runs_start_together_the_earlier_one_wins(db, monkeypatch):
    running_run(db, "run-earlier", minutes_since_heartbeat=0)
    # The race: run-later's first check happened before run-earlier was written.
    real_active_runs = runs.active_runs
    checks: list[str] = []

    def first_check_sees_nothing(database, current, exclude):
        checks.append(exclude)
        return [] if len(checks) == 1 else real_active_runs(database, current, exclude)

    monkeypatch.setattr(runs, "active_runs", first_check_sees_nothing)
    with pytest.raises(RunAlreadyRunning) as raised:
        start_run(db, "run-later", trigger="cli", runner="local", requested_by=None, stages=["collect"], options={})
    assert raised.value.run_id == "run-earlier"
    assert len(checks) == 2
    assert get_run(db, "run-later").status == "failed"
    assert get_run(db, "run-earlier").status == "running"


# ---------------------------------------------------------------------------
# The recorder and the command line


def test_the_recorder_keeps_counts_usage_and_a_bounded_log(db, monkeypatch):
    monkeypatch.setattr(runs, "MAX_LOG_LINES", 3)
    start_run(db, "run-log", trigger="cli", runner="local", requested_by=None, stages=["collect"], options={})
    recorder = RunRecorder(db, "run-log")
    for number in range(5):
        recorder.log(f"line {number}")
    recorder.add_counts(fetched=2)
    recorder.add_counts(fetched=3, new=1)
    run = get_run(db, "run-log")
    assert [line.split(" ", 1)[1] for line in run.log] == ["line 2", "line 3", "line 4"]
    assert run.counts.fetched == 5 and run.counts.new == 1
    with pytest.raises(AttributeError):
        recorder.add_counts(fetchd=1)


def test_heartbeats_are_throttled(db, monkeypatch):
    start_run(db, "run-beat", trigger="cli", runner="local", requested_by=None, stages=["collect"], options={})
    recorder = RunRecorder(db, "run-beat")
    writes = []
    monkeypatch.setattr(recorder, "_update", lambda update: writes.append(update))
    for _ in range(100):
        recorder.heartbeat()
    assert writes == []
    recorder.last_heartbeat = now() - timedelta(seconds=6)
    recorder.heartbeat()
    assert len(writes) == 1


def test_parse_stages():
    assert parse_stages("all") == ["collect", "triage"]
    assert parse_stages("triage,collect") == ["collect", "triage"]
    assert parse_stages(["triage"]) == ["triage"]
    assert parse_stages("collect triage") == ["collect", "triage"]
    with pytest.raises(ValueError):
        parse_stages("publish")


def test_the_command_line_runs_against_the_in_memory_database(monkeypatch, capsys, content_dir):
    monkeypatch.setenv("MONGO_URI", "mongomock://cli-test")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("CONTENT_DIR", str(content_dir))
    monkeypatch.setattr(run_module, "build_collectors", lambda settings, heartbeat=None: fake_collectors())

    assert main(["--stage", "collect", "--limit", "5"]) == 0
    assert ": succeeded" in capsys.readouterr().out
    assert main(["--stage", "publish"]) == 1
