"""Pipeline status, starting runs (local and GitHub runners), run history and the search config."""

import json
import sys
import threading
import time

import httpx
import pytest
from api_helpers import REVIEWER_EMAIL, bearer, insert_candidate, make_config, minutes_ago
from sf_shared.db import now

from sf_api import create_app, runner
from sf_api.documents import to_document
from sf_shared.pipeline_models import PipelineRun

WAIT_SECONDS = 5


class FakePipeline:
    """Stands in for sf_pipeline.run.run_pipeline, so these tests don't need the real one."""

    def __init__(self, finish: bool = True, hold: bool = False, error: Exception | None = None) -> None:
        self.calls: list[dict] = []
        self.called = threading.Event()
        self.release = threading.Event()
        self.done = threading.Event()
        self.finish = finish
        self.hold = hold
        self.error = error

    def __call__(self, db, **options) -> str:
        self.calls.append({"db": db, **options})
        self.called.set()
        try:
            if self.hold:
                self.release.wait(WAIT_SECONDS)
            if self.error is not None:
                raise self.error
            if self.finish:
                db["pipeline_runs"].update_one({"_id": options["run_id"]}, {"$set": {"status": "succeeded"}})
            return options["run_id"]
        finally:
            self.done.set()


@pytest.fixture
def fake_pipeline(monkeypatch) -> FakePipeline:
    fake = FakePipeline()
    monkeypatch.setattr(runner, "load_run_pipeline", lambda: fake)
    return fake


def insert_run(db, run_id: str, status: str, heartbeat_minutes_ago: int, runner_name: str = "github") -> None:
    run = PipelineRun(
        id=run_id,
        trigger="schedule",
        runner=runner_name,
        status=status,
        stages=["collect", "triage"],
        started_at=minutes_ago(heartbeat_minutes_ago + 1),
        heartbeat_at=minutes_ago(heartbeat_minutes_ago),
        log=["a line"],
    )
    db["pipeline_runs"].insert_one(to_document(run))


# ---------- Status ----------


def test_status_counts_sources_by_review_status(client, db, headers):
    insert_candidate(db, "arxiv-1", status="new")
    insert_candidate(db, "arxiv-2")
    insert_candidate(db, "arxiv-3")
    insert_candidate(db, "arxiv-4", status="approved")

    body = client.get("/api/pipeline/status", headers=headers).get_json()

    assert body["counts"] == {"new": 1, "triaged_out": 0, "pending_review": 2, "approved": 1, "rejected": 0}
    assert body["latest_run"] is None
    assert body["running"] is False
    assert body["runner"] == "local"
    assert body["triage_configured"] is False


def test_status_shows_the_latest_run_and_whether_one_is_going(client, db, headers):
    insert_run(db, "run-old", "succeeded", heartbeat_minutes_ago=120)
    insert_run(db, "run-now", "running", heartbeat_minutes_ago=1)

    body = client.get("/api/pipeline/status", headers=headers).get_json()

    assert body["latest_run"]["id"] == "run-now"
    assert body["running"] is True
    assert body["active_run_id"] == "run-now"


def test_status_fails_a_queued_run_that_never_started(client, db, headers):
    # e.g. the GitHub job failed before Python started, so nothing ever
    # updated the run. It used to stay "queued" and lock the Start button.
    insert_run(db, "run-lost", "queued", heartbeat_minutes_ago=30)

    for _ in range(2):
        body = client.get("/api/pipeline/status", headers=headers).get_json()
        assert body["running"] is False
        assert body["active_run_id"] is None
        assert body["latest_run"]["status"] == "failed"

    run = db["pipeline_runs"].find_one({"_id": "run-lost"})
    assert run["finished_at"] is not None
    assert run["errors"] == [
        "This run was queued but didn't start within 10 minutes, so it was marked failed. "
        "The job's log in the repo's Actions tab on GitHub says why."
    ]


def test_a_local_run_that_never_started_gets_no_github_hint(client, db, headers):
    insert_run(db, "run-lost", "queued", heartbeat_minutes_ago=30, runner_name="local")
    client.get("/api/pipeline/status", headers=headers)
    run = db["pipeline_runs"].find_one({"_id": "run-lost"})
    assert run["status"] == "failed"
    assert "GitHub" not in run["errors"][-1]


def test_run_history_and_run_detail_fail_dead_runs_too(client, db, headers):
    insert_run(db, "run-crashed", "running", heartbeat_minutes_ago=11)
    runs = client.get("/api/pipeline/runs", headers=headers).get_json()["runs"]
    assert runs[0]["status"] == "failed"
    assert "No heartbeat" in runs[0]["errors"][-1]

    insert_run(db, "run-lost", "queued", heartbeat_minutes_ago=15)
    run = client.get("/api/pipeline/runs/run-lost", headers=headers).get_json()["run"]
    assert run["status"] == "failed"


def test_reading_runs_leaves_live_ones_alone(client, db, headers):
    insert_run(db, "run-queued", "queued", heartbeat_minutes_ago=2)
    insert_run(db, "run-going", "running", heartbeat_minutes_ago=1)

    client.get("/api/pipeline/status", headers=headers)
    client.get("/api/pipeline/runs", headers=headers)

    assert db["pipeline_runs"].find_one({"_id": "run-queued"})["status"] == "queued"
    assert db["pipeline_runs"].find_one({"_id": "run-going"})["status"] == "running"


def test_status_says_triage_is_unknown_with_the_github_runner():
    app, client, headers = github_app(triage_configured=None)
    body = client.get("/api/pipeline/status", headers=headers).get_json()
    assert body["runner"] == "github"
    assert body["triage_configured"] is None


# ---------- Starting a run with the local runner ----------


def test_run_now_calls_the_local_pipeline_with_the_new_run_id(client, db, headers, fake_pipeline):
    response = client.post("/api/pipeline/runs", json={"stages": ["triage", "collect"], "limit": 20, "dry_run": True}, headers=headers)

    assert response.status_code == 202
    run = response.get_json()["run"]
    assert run["status"] == "queued"
    assert run["stages"] == ["collect", "triage"]
    assert run["requested_by"] == REVIEWER_EMAIL

    assert fake_pipeline.done.wait(WAIT_SECONDS)
    call = fake_pipeline.calls[0]
    assert call["db"] is db
    assert call["run_id"] == run["id"]
    assert call["stages"] == ["collect", "triage"]
    assert call["limit"] == 20
    assert call["dry_run"] is True
    assert call["trigger"] == "admin"
    assert call["runner"] == "local"
    assert call["requested_by"] == REVIEWER_EMAIL


def test_run_now_defaults_to_both_stages(client, headers, fake_pipeline):
    response = client.post("/api/pipeline/runs", json={}, headers=headers)
    assert response.status_code == 202
    assert fake_pipeline.done.wait(WAIT_SECONDS)
    assert fake_pipeline.calls[0]["stages"] == ["collect", "triage"]
    assert fake_pipeline.calls[0]["limit"] is None


@pytest.mark.parametrize("body", [{"stages": []}, {"stages": ["crawl"]}, {"limit": 0}, {"dry_run": "maybe"}])
def test_run_now_validates_its_body(client, headers, fake_pipeline, body):
    response = client.post("/api/pipeline/runs", json=body, headers=headers)
    assert response.status_code == 400
    assert fake_pipeline.calls == []


def test_run_now_is_409_while_a_run_is_going(client, db, headers, monkeypatch):
    fake = FakePipeline(hold=True)
    monkeypatch.setattr(runner, "load_run_pipeline", lambda: fake)

    first = client.post("/api/pipeline/runs", json={}, headers=headers)
    assert first.status_code == 202
    assert fake.called.wait(WAIT_SECONDS)

    second = client.post("/api/pipeline/runs", json={}, headers=headers)
    assert second.status_code == 409
    assert second.get_json()["error"]["code"] == "run_in_progress"
    assert second.get_json()["error"]["details"]["run_id"] == first.get_json()["run"]["id"]
    assert len(fake.calls) == 1
    assert db["pipeline_runs"].count_documents({}) == 1

    fake.release.set()
    assert fake.done.wait(WAIT_SECONDS)


def test_two_workers_cant_both_start_a_run(config, client, db, headers, fake_pipeline, monkeypatch):
    # A second app on the same database stands in for another gunicorn
    # worker. Its request arrives while the first is creating its run.
    other_worker = create_app(config).test_client()
    original_create = runner.create_queued_run
    responses = []

    def create_while_the_other_worker_tries(db, config, request):
        responses.append(other_worker.post("/api/pipeline/runs", json={}, headers=headers))
        return original_create(db, config, request)

    monkeypatch.setattr(runner, "create_queued_run", create_while_the_other_worker_tries)

    first = client.post("/api/pipeline/runs", json={}, headers=headers)

    assert first.status_code == 202
    assert responses[0].status_code == 409
    assert responses[0].get_json()["error"]["code"] == "run_in_progress"
    assert db["pipeline_runs"].count_documents({}) == 1
    assert fake_pipeline.done.wait(WAIT_SECONDS)


def test_the_start_lock_is_released_after_each_start(client, db, headers, monkeypatch):
    fake = FakePipeline()
    monkeypatch.setattr(runner, "load_run_pipeline", lambda: fake)
    assert client.post("/api/pipeline/runs", json={}, headers=headers).status_code == 202
    assert fake.done.wait(WAIT_SECONDS)
    wait_for_status(db, db["pipeline_runs"].find_one()["_id"], "succeeded")

    assert db["locks"].find_one({"_id": "start_run"})["holder"] is None
    fake.done.clear()
    assert client.post("/api/pipeline/runs", json={}, headers=headers).status_code == 202
    assert fake.done.wait(WAIT_SECONDS)


def test_the_start_lock_is_released_when_starting_fails(client, db, headers, monkeypatch):
    monkeypatch.setitem(sys.modules, "sf_pipeline", None)
    monkeypatch.setitem(sys.modules, "sf_pipeline.run", None)
    assert client.post("/api/pipeline/runs", json={}, headers=headers).status_code == 503
    assert db["locks"].find_one({"_id": "start_run"})["holder"] is None


def test_a_start_lock_left_by_a_dead_worker_expires(client, db, headers, fake_pipeline):
    db["locks"].insert_one({"_id": "start_run", "holder": "a-worker-that-died", "expires_at": minutes_ago(2)})

    response = client.post("/api/pipeline/runs", json={}, headers=headers)

    assert response.status_code == 202
    assert fake_pipeline.done.wait(WAIT_SECONDS)


def test_a_start_lock_someone_holds_is_a_409(client, db, headers, fake_pipeline):
    db["locks"].insert_one({"_id": "start_run", "holder": "another-worker", "expires_at": now() + runner.START_LOCK_EXPIRES})

    response = client.post("/api/pipeline/runs", json={}, headers=headers)

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "run_in_progress"
    assert db["pipeline_runs"].count_documents({}) == 0
    assert fake_pipeline.calls == []
    # Someone else's lock is left as it was.
    assert db["locks"].find_one({"_id": "start_run"})["holder"] == "another-worker"


def test_a_run_without_heartbeats_for_10_minutes_doesnt_block(client, db, headers, fake_pipeline):
    insert_run(db, "run-crashed", "running", heartbeat_minutes_ago=11)

    response = client.post("/api/pipeline/runs", json={}, headers=headers)

    assert response.status_code == 202
    crashed = db["pipeline_runs"].find_one({"_id": "run-crashed"})
    assert crashed["status"] == "failed"
    assert "No heartbeat" in crashed["errors"][-1]
    assert fake_pipeline.done.wait(WAIT_SECONDS)


def test_a_pipeline_error_is_recorded_on_the_run(client, db, headers, monkeypatch):
    fake = FakePipeline(error=RuntimeError("arXiv said no"))
    monkeypatch.setattr(runner, "load_run_pipeline", lambda: fake)

    run_id = client.post("/api/pipeline/runs", json={}, headers=headers).get_json()["run"]["id"]
    assert fake.done.wait(WAIT_SECONDS)

    run = wait_for_status(db, run_id, "failed")
    assert "arXiv said no" in run["errors"][-1]


def test_a_run_the_pipeline_left_open_is_closed(client, db, headers, monkeypatch):
    fake = FakePipeline(finish=False)
    monkeypatch.setattr(runner, "load_run_pipeline", lambda: fake)

    run_id = client.post("/api/pipeline/runs", json={}, headers=headers).get_json()["run"]["id"]
    assert fake.done.wait(WAIT_SECONDS)

    run = wait_for_status(db, run_id, "failed")
    assert "without finishing" in run["errors"][-1]


def test_a_run_the_pipeline_finished_is_left_alone(client, db, headers, fake_pipeline):
    run_id = client.post("/api/pipeline/runs", json={}, headers=headers).get_json()["run"]["id"]
    assert fake_pipeline.done.wait(WAIT_SECONDS)
    run = wait_for_status(db, run_id, "succeeded")
    assert run["errors"] == []


def wait_for_status(db, run_id: str, status: str) -> dict:
    """The run thread writes just after the fake returns, so give it a moment."""
    for _ in range(100):
        run = db["pipeline_runs"].find_one({"_id": run_id})
        if run["status"] == status:
            return run
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} never reached {status}; it is {run['status']}")


def test_run_now_without_the_pipeline_package_is_a_clear_503(client, db, headers, monkeypatch):
    # None in sys.modules makes `import sf_pipeline` fail, as if it weren't installed.
    monkeypatch.setitem(sys.modules, "sf_pipeline", None)
    monkeypatch.setitem(sys.modules, "sf_pipeline.run", None)

    response = client.post("/api/pipeline/runs", json={}, headers=headers)

    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "pipeline_not_installed"
    assert db["pipeline_runs"].count_documents({}) == 0


# ---------- Starting a run with the GitHub runner ----------


def github_app(**overrides):
    settings = {"pipeline_runner": "github", "github_token": "ghp_test", "github_repo": "someone/SentientFutures"}
    settings.update(overrides)
    app = create_app(make_config(**settings))
    return app, app.test_client(), bearer(app.extensions["sf_config"])


def fake_github(monkeypatch, status_for_dispatch: int = 204) -> list[httpx.Request]:
    sent: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        if request.url.path.endswith("/dispatches"):
            if status_for_dispatch == 204:
                return httpx.Response(204)
            return httpx.Response(status_for_dispatch, json={"message": "Unexpected inputs provided: [\"run_id\"]"})
        return httpx.Response(204)

    def client_for(config):
        return httpx.Client(
            base_url=runner.GITHUB_API,
            transport=httpx.MockTransport(handle),
            headers={"Authorization": f"Bearer {config.github_token}"},
        )

    monkeypatch.setattr(runner, "github_client", client_for)
    return sent


def test_github_runner_enables_then_dispatches_the_workflow(monkeypatch):
    sent = fake_github(monkeypatch)
    app, client, headers = github_app()

    response = client.post("/api/pipeline/runs", json={"stages": ["collect"], "limit": 5}, headers=headers)

    assert response.status_code == 202
    run = response.get_json()["run"]
    assert run["runner"] == "github"
    assert run["status"] == "queued"

    assert [(request.method, request.url.path) for request in sent] == [
        ("PUT", "/repos/someone/SentientFutures/actions/workflows/pipeline.yml/enable"),
        ("POST", "/repos/someone/SentientFutures/actions/workflows/pipeline.yml/dispatches"),
    ]
    dispatch = json.loads(sent[1].content)
    assert dispatch == {
        "ref": "main",
        "inputs": {"stages": "collect", "limit": "5", "dry_run": "false", "run_id": run["id"]},
    }
    # Workflow inputs show up in Actions logs, which can be public.
    assert "@" not in sent[1].content.decode()


def test_github_runner_refusal_fails_the_run_with_a_hint(monkeypatch):
    fake_github(monkeypatch, status_for_dispatch=422)
    app, client, headers = github_app()

    response = client.post("/api/pipeline/runs", json={}, headers=headers)

    assert response.status_code == 502
    error = response.get_json()["error"]
    assert error["code"] == "github_error"
    assert "workflow_dispatch" in error["message"]
    run = app.extensions["sf_db"]["pipeline_runs"].find_one({"_id": error["details"]["run_id"]})
    assert run["status"] == "failed"


def test_github_runner_without_a_token_is_a_clear_503(monkeypatch):
    sent = fake_github(monkeypatch)
    app, client, headers = github_app(github_token=None)

    response = client.post("/api/pipeline/runs", json={}, headers=headers)

    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "runner_not_configured"
    assert "GITHUB_TOKEN" in response.get_json()["error"]["message"]
    assert sent == []
    assert app.extensions["sf_db"]["pipeline_runs"].count_documents({}) == 0


# ---------- Run history ----------


def test_runs_are_listed_newest_first_without_logs(client, db, headers):
    insert_run(db, "run-a", "succeeded", heartbeat_minutes_ago=300)
    insert_run(db, "run-b", "failed", heartbeat_minutes_ago=200)

    runs = client.get("/api/pipeline/runs", headers=headers).get_json()["runs"]

    assert [run["id"] for run in runs] == ["run-b", "run-a"]
    assert "log" not in runs[0]


def test_one_run_comes_with_its_log(client, db, headers):
    insert_run(db, "run-a", "succeeded", heartbeat_minutes_ago=300)
    run = client.get("/api/pipeline/runs/run-a", headers=headers).get_json()["run"]
    assert run["log"] == ["a line"]
    assert client.get("/api/pipeline/runs/run-missing", headers=headers).status_code == 404


# ---------- Search config ----------


def test_search_config_starts_with_the_defaults(client, headers):
    body = client.get("/api/pipeline/config", headers=headers).get_json()
    assert body["saved"] is True  # seeded, because the test database is in memory
    assert len(body["config"]["queries"]) == 6
    assert body["config"]["model"] == "claude-haiku-5-5"


def test_search_config_lists_the_models_the_pipeline_can_price(client, headers):
    pricing = pytest.importorskip("sf_pipeline.pricing")
    body = client.get("/api/pipeline/config", headers=headers).get_json()
    assert body["models"] == list(pricing.PRICES)
    assert "claude-haiku-5-5" in body["models"]


def test_search_config_shows_defaults_when_nothing_is_saved(client, db, headers):
    db["search_config"].delete_many({})
    body = client.get("/api/pipeline/config", headers=headers).get_json()
    assert body["saved"] is False
    assert len(body["config"]["queries"]) == 6


def test_search_config_can_be_replaced(client, headers):
    config = client.get("/api/pipeline/config", headers=headers).get_json()["config"]
    config["queries"] = [{"label": "Only this", "text": "connectome", "collectors": ["arxiv"]}]
    config["lookback_days"] = 30
    config["updated_by"] = "someone-else@example.com"

    response = client.put("/api/pipeline/config", json=config, headers=headers)

    assert response.status_code == 200
    saved = client.get("/api/pipeline/config", headers=headers).get_json()["config"]
    assert saved["lookback_days"] == 30
    assert saved["queries"][0]["label"] == "Only this"
    assert saved["updated_by"] == REVIEWER_EMAIL


@pytest.mark.parametrize(
    "change",
    [
        {"lookback_days": 0},
        {"max_cost_usd_per_run": 500},
        {"effort": "max"},
        {"surprise": True},
        {"queries": [{"label": "A", "text": "x"}, {"label": "a", "text": "y"}]},
        {"queries": [{"label": " ", "text": "x"}]},
        {"queries": [{"label": "A", "text": "x", "collectors": []}]},
    ],
)
def test_search_config_is_validated(client, headers, change):
    config = client.get("/api/pipeline/config", headers=headers).get_json()["config"]
    config.update(change)
    response = client.put("/api/pipeline/config", json=config, headers=headers)
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_body"


def put_config_change(client, headers, change: dict):
    config = client.get("/api/pipeline/config", headers=headers).get_json()["config"]
    config.update(change)
    return client.put("/api/pipeline/config", json=config, headers=headers)


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ('"brain-computer interface" AND (alignment OR "AI safety"', "A parenthesis is never closed."),
        ("connectome AND", "The search ends with AND."),
        ("NOT mouse", "NOT has to come after a term"),
    ],
)
def test_search_text_the_pipeline_cant_translate_is_refused(client, headers, text, message):
    pytest.importorskip("sf_pipeline.collectors.query")
    queries = [{"label": "Fine", "text": "connectome"}, {"label": "Broken", "text": text}]

    response = put_config_change(client, headers, {"queries": queries})

    assert response.status_code == 400
    details = response.get_json()["error"]["details"]
    # One line per search, even though both collectors refuse it.
    assert len(details) == 1
    assert details[0].startswith("queries[1].text: " + message)


def test_an_unpriced_model_is_refused(client, headers):
    pytest.importorskip("sf_pipeline.pricing")

    response = put_config_change(client, headers, {"model": "claude-haiku-4-5"})

    assert response.status_code == 400
    details = response.get_json()["error"]["details"]
    assert len(details) == 1
    assert details[0].startswith('model: the pipeline has no price for "claude-haiku-4-5"')
    assert "claude-haiku-5-5" in details[0]


def test_a_priced_model_and_good_searches_are_saved(client, headers):
    pytest.importorskip("sf_pipeline.pricing")
    change = {"model": "claude-sonnet-5-5", "queries": [{"label": "BCI", "text": '"brain-computer interface" NOT mouse'}]}
    response = put_config_change(client, headers, change)
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["config"]["model"] == "claude-sonnet-5-5"


def test_without_the_pipeline_package_the_text_and_model_arent_checked(client, headers, monkeypatch):
    # None in sys.modules makes the import fail, as if it weren't installed.
    monkeypatch.setitem(sys.modules, "sf_pipeline.pricing", None)
    monkeypatch.setitem(sys.modules, "sf_pipeline.collectors.query", None)

    response = put_config_change(client, headers, {"model": "some-new-model", "queries": [{"label": "A", "text": "x AND"}]})

    assert response.status_code == 200
    assert response.get_json()["models"] is None
