"""The health route, and the JSON shape of errors."""

from api_helpers import make_config

from sf_api import create_app


def test_health_is_open_and_reports_the_setup(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["db"] == "ok"
    assert body["db_in_memory"] is True
    assert body["runner"] == "local"
    assert body["dev_login"] is False
    assert body["triage_configured"] is False
    assert body["google_client_id"] is None
    assert body["rubric_version"]
    assert "git_sha" in body


def test_health_shows_dev_login_triage_and_the_public_google_client_id():
    config = make_config(dev_login=True, triage_configured=True, google_client_id="abc.apps.googleusercontent.com", git_sha="1a2b3c")
    body = create_app(config).test_client().get("/api/health").get_json()
    assert body["dev_login"] is True
    assert body["triage_configured"] is True
    assert body["google_client_id"] == "abc.apps.googleusercontent.com"
    assert body["git_sha"] == "1a2b3c"


def test_health_says_triage_is_unknown_with_the_github_runner():
    config = make_config(pipeline_runner="github", github_token="ghp_test", github_repo="someone/SentientFutures", triage_configured=None)
    body = create_app(config).test_client().get("/api/health").get_json()
    assert body["runner"] == "github"
    assert body["triage_configured"] is None


def test_unknown_routes_answer_in_json(client):
    response = client.get("/nothing-here")
    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "not_found"


def test_wrong_method_answers_in_json(client):
    response = client.delete("/api/health")
    assert response.status_code == 405
    error = response.get_json()["error"]
    assert error["code"] == "method_not_allowed"
    assert set(error) == {"code", "message", "details"}


def test_a_body_that_isnt_json_gets_a_clear_400(client, headers):
    response = client.put("/api/pipeline/config", data="not json", headers=headers, content_type="application/json")
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_json"


def test_a_crash_answers_in_json_without_details(app, client, headers, monkeypatch):
    from sf_api import queue_routes

    def explode(db):
        raise RuntimeError("mongodb://user:secret@host")

    monkeypatch.setattr(queue_routes, "review_stats", explode)
    response = client.get("/api/reviews/stats", headers=headers)
    assert response.status_code == 500
    assert response.get_json()["error"]["code"] == "internal_error"
    assert "secret" not in response.get_data(as_text=True)
