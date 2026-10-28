"""Run now with the real pipeline package, to check the two agree on the run document.

Skipped when sf_pipeline isn't installed. Only the triage stage runs, with no
ANTHROPIC_API_KEY, so nothing goes over the network: triage is skipped and logged.
"""

import time

import pytest

pytest.importorskip("sf_pipeline.run")


def wait_until_finished(db, run_id: str) -> dict:
    for _ in range(250):
        run = db["pipeline_runs"].find_one({"_id": run_id})
        if run["status"] not in ("queued", "running"):
            return run
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} didn't finish; it is {run['status']}")


def test_the_pipeline_fills_in_the_run_the_api_created(client, db, headers, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    response = client.post("/api/pipeline/runs", json={"stages": ["triage"]}, headers=headers)

    assert response.status_code == 202
    run_id = response.get_json()["run"]["id"]
    run = wait_until_finished(db, run_id)
    assert db["pipeline_runs"].count_documents({}) == 1
    assert run["status"] in ("succeeded", "partial"), run["errors"]
    assert run["requested_by"] == "rae@example.com"
    assert run["trigger"] == "admin"
    assert len(run["log"]) > 1

    detail = client.get(f"/api/pipeline/runs/{run_id}", headers=headers).get_json()["run"]
    assert detail["status"] == run["status"]
