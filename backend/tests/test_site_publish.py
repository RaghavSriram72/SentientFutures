"""Publishing the site from admin: POST and GET /api/site/publish, in local and GitHub mode."""

import json
from dataclasses import replace
from datetime import timedelta

import httpx
import pytest
from api_helpers import (
    SITE_SOURCES,
    approve_body,
    bearer,
    insert_candidate,
    make_config,
    valid_milestone,
    write_content,
)

from sf_api import create_app, reviews, runner, site_routes
from sf_api.config import Config
from sf_shared.db import now


@pytest.fixture
def content_dir(tmp_path):
    return write_content(tmp_path / "content", milestones=[valid_milestone("wbe-first")], sources=SITE_SOURCES, posts={})


@pytest.fixture
def config(content_dir):
    return make_config(content_dir=content_dir)


def status(client, headers) -> dict:
    response = client.get("/api/site/publish", headers=headers)
    assert response.status_code == 200
    return response.get_json()


def save_milestone(client, headers) -> None:
    record = client.get("/api/milestones/wbe-first", headers=headers).get_json()["milestone"]
    record["name"] = "Renamed"
    body = {"milestone": record, "version": record["version"], "published": True}
    assert client.put("/api/milestones/wbe-first", json=body, headers=headers).status_code == 200


def save_post(client, headers) -> None:
    post = {
        "slug": "notes",
        "title": "Notes",
        "date": "2026-10-27",
        "author": "Rae",
        "summary": "Short.",
        "body": "Text.",
        "status": "published",
    }
    assert client.post("/api/posts", json=post, headers=headers).status_code == 201


def approve_one(client, db, headers, candidate_id: str = "arxiv-2610.00001") -> None:
    insert_candidate(db, candidate_id)
    assert client.post(f"/api/queue/{candidate_id}/review", json=approve_body(), headers=headers).status_code == 201


def test_nothing_published_yet_and_nothing_waiting(client, headers):
    body = status(client, headers)
    assert body["last_publish"] is None
    assert body["latest_attempt"] is None
    # The seed from content/ isn't a change waiting to go out.
    assert body["waiting"] == {"sources_approved": 0, "milestones_saved": 0, "posts_saved": 0}
    assert body["mode"] == "local"
    assert "sf_shared.export_site" in body["command"]
    assert "--api http://localhost" in body["command"]


def test_changes_are_counted_until_the_next_publish(client, db, headers, monkeypatch):
    approve_one(client, db, headers)
    save_milestone(client, headers)
    save_milestone(client, headers)  # the same milestone twice counts once
    save_post(client, headers)
    assert status(client, headers)["waiting"] == {"sources_approved": 1, "milestones_saved": 1, "posts_saved": 1}

    response = client.post("/api/site/publish", headers=headers)

    assert response.status_code == 200
    body = response.get_json()
    assert body["mode"] == "local"
    assert body["command"].endswith("DATA_DIR=../.site-data npm run dev")
    assert body["publish"]["github_status"] == "not_sent"
    assert body["publish"]["requested_by_name"] == "Rae Reviewer"
    assert "requested_by" not in body["publish"]  # the email stays in the database

    after = status(client, headers)
    assert after["last_publish"]["id"] == body["publish"]["id"]
    assert after["waiting"] == {"sources_approved": 0, "milestones_saved": 0, "posts_saved": 0}

    # MongoDB keeps milliseconds, so a change in the same millisecond as the
    # publish wouldn't count. Make the next one clearly later.
    later = now() + timedelta(seconds=1)
    monkeypatch.setattr(reviews, "now", lambda: later)
    approve_one(client, db, headers, "arxiv-2610.00002")
    assert status(client, headers)["waiting"]["sources_approved"] == 1


def test_publish_mode():
    assert site_routes.publish_mode(make_config(github_token="t", github_repo="a/b")) == "local"  # in-memory
    real = Config(mongo_uri="mongodb://localhost:27017", jwt_secret="x" * 40)
    assert site_routes.publish_mode(real) == "local"  # no token
    assert site_routes.publish_mode(replace(real, github_token="t", github_repo="a/b")) == "github"


def fake_github(monkeypatch, status_for_dispatch: int = 204) -> list[httpx.Request]:
    sent: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        if request.url.path.endswith("/dispatches") and status_for_dispatch != 204:
            return httpx.Response(status_for_dispatch, json={"message": "Resource not accessible by integration"})
        return httpx.Response(204)

    def client_for(config):
        return httpx.Client(base_url=runner.GITHUB_API, transport=httpx.MockTransport(handle))

    monkeypatch.setattr(runner, "github_client", client_for)
    monkeypatch.setattr(site_routes, "publish_mode", lambda config: "github")
    return sent


@pytest.fixture
def github_config(content_dir):
    return make_config(content_dir=content_dir, github_token="ghp_test", github_repo="someone/SentientFutures")


def test_github_mode_starts_the_deploy_workflow(monkeypatch, github_config):
    sent = fake_github(monkeypatch)
    app = create_app(github_config)
    client = app.test_client()
    headers = bearer(app.extensions["sf_config"])

    response = client.post("/api/site/publish", headers=headers)

    assert response.status_code == 202, response.get_json()
    assert response.get_json()["publish"]["github_status"] == "dispatched"
    assert response.get_json()["command"] is None
    assert [(request.method, request.url.path) for request in sent] == [
        ("PUT", "/repos/someone/SentientFutures/actions/workflows/deploy-site.yml/enable"),
        ("POST", "/repos/someone/SentientFutures/actions/workflows/deploy-site.yml/dispatches"),
    ]
    assert json.loads(sent[1].content) == {"ref": "main", "inputs": {}}


def test_a_github_refusal_is_502_and_doesnt_count_as_a_publish(monkeypatch, github_config):
    fake_github(monkeypatch, status_for_dispatch=403)
    app = create_app(github_config)
    client = app.test_client()
    headers = bearer(app.extensions["sf_config"])

    response = client.post("/api/site/publish", headers=headers)

    assert response.status_code == 502
    error = response.get_json()["error"]
    assert error["code"] == "github_error"
    assert "Actions: write" in error["message"]
    body = status(client, headers)
    assert body["last_publish"] is None
    assert body["latest_attempt"]["github_status"] == "failed"
    assert body["latest_attempt"]["id"] == error["details"]["publish_id"]
