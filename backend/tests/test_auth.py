"""Sign-in: the guard on every route, our tokens, dev sign-in and Google sign-in."""

from datetime import timedelta

import jwt
import pytest
from api_helpers import REVIEWER_EMAIL, REVIEWER_NAME, TEST_SECRET, bearer, make_config

from sf_api import auth, create_app
from sf_api.config import Config, ConfigError, check_config
from sf_shared.db import now

OPEN_ROUTES = {
    "/api/health",
    "/api/auth/google",
    "/api/auth/dev",
    "/api/public/sources",
    "/api/public/milestones",
    "/api/public/posts",
}


def protected_requests(app) -> list[tuple[str, str]]:
    """(method, url) for every /api route that should need a token, with ids filled in."""
    found = []
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/api"):
            continue
        url = rule.rule
        for argument in rule.arguments:
            url = url.replace(f"<{argument}>", "some-id")
        if auth.is_open_path(url):
            continue
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            found.append((method, url))
    return found


def test_every_protected_route_answers_401_without_a_token(app, client):
    requests = protected_requests(app)
    # So the sweep can't pass by finding nothing.
    assert len(requests) >= 11
    for method, url in requests:
        response = client.open(url, method=method, json={})
        assert response.status_code == 401, f"{method} {url}"
        assert response.get_json()["error"]["code"] == "unauthorized", f"{method} {url}"


def test_the_open_routes_are_exactly_health_sign_in_and_public(app):
    open_urls = set()
    for rule in app.url_map.iter_rules():
        if rule.rule.startswith("/api") and auth.is_open_path(rule.rule):
            open_urls.add(rule.rule)
    assert open_urls == OPEN_ROUTES


def test_every_protected_route_rejects_a_forged_token(app, client):
    forged = jwt.encode({"sub": REVIEWER_EMAIL, "exp": now() + timedelta(hours=1)}, "not-the-secret-" * 4, algorithm="HS256")
    for method, url in protected_requests(app):
        response = client.open(url, method=method, json={}, headers={"Authorization": f"Bearer {forged}"})
        assert response.status_code == 401, f"{method} {url}"


@pytest.mark.parametrize(
    "header",
    [
        "Bearer",
        "Bearer    ",
        "Basic abc",
        "Bearer not-a-jwt",
        "Token " + "x" * 20,
    ],
)
def test_malformed_authorization_headers_get_401(client, header):
    response = client.get("/api/auth/me", headers={"Authorization": header})
    assert response.status_code == 401


def test_expired_token_gets_401_with_its_own_code(client):
    expired = jwt.encode({"sub": REVIEWER_EMAIL, "exp": now() - timedelta(minutes=1)}, TEST_SECRET, algorithm="HS256")
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "token_expired"


@pytest.mark.parametrize("payload", [{"sub": REVIEWER_EMAIL}, {"exp": 9999999999}])
def test_token_without_exp_or_sub_gets_401(client, payload):
    token = jwt.encode(payload, TEST_SECRET, algorithm="HS256")
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_token_lasts_8_hours(config):
    token, _ = auth.issue_token(config, REVIEWER_EMAIL)
    payload = jwt.decode(token, TEST_SECRET, algorithms=["HS256"])
    assert payload["exp"] - payload["iat"] == 8 * 60 * 60
    assert payload["sub"] == REVIEWER_EMAIL


def test_me_returns_the_signed_in_user(client, headers):
    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.get_json() == {"user": {"email": REVIEWER_EMAIL, "name": REVIEWER_NAME, "role": "admin"}}


def test_removing_a_user_locks_them_out_at_once(client, db, headers):
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    db["users"].update_one({"_id": REVIEWER_EMAIL}, {"$set": {"active": False}})
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_a_valid_token_for_someone_not_on_the_list_gets_401(client, config):
    response = client.get("/api/auth/me", headers=bearer(config, "stranger@example.com"))
    assert response.status_code == 401


def test_cors_preflight_is_answered_without_a_token(client):
    response = client.options(
        "/api/queue",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "authorization" in response.headers["Access-Control-Allow-Headers"].lower()


def test_401_carries_cors_headers_so_the_browser_can_read_it(client):
    response = client.get("/api/queue", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 401
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"


def test_unknown_origins_get_no_cors_headers(client):
    response = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in response.headers


# ---------- Dev sign-in ----------


def test_dev_login_is_off_by_default():
    assert Config.from_env({}).dev_login is False


def test_dev_login_route_is_404_when_off(client):
    response = client.post("/api/auth/dev", json={"email": REVIEWER_EMAIL})
    assert response.status_code == 404


def test_dev_login_signs_in_an_allowlisted_user():
    app = create_app(make_config(dev_login=True))
    client = app.test_client()
    response = client.post("/api/auth/dev", json={"email": "  RAE@example.com "})
    assert response.status_code == 200
    body = response.get_json()
    assert body["user"]["email"] == REVIEWER_EMAIL
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200


def test_dev_login_refuses_someone_not_on_the_list():
    client = create_app(make_config(dev_login=True)).test_client()
    response = client.post("/api/auth/dev", json={"email": "stranger@example.com"})
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "not_on_team_list"


@pytest.mark.parametrize("variable", ["APP_ENV", "FLASK_ENV"])
def test_dev_login_is_refused_in_production(variable):
    environ = {
        variable: "production",
        "DEV_LOGIN": "1",
        "JWT_SECRET": "x" * 40,
        "MONGO_URI": "mongodb://localhost:27017",
    }
    with pytest.raises(ConfigError, match="DEV_LOGIN"):
        check_config(Config.from_env(environ))


def test_create_app_refuses_to_start_with_dev_login_in_production():
    config = make_config(env="production", dev_login=True, mongo_uri="mongodb://localhost:27017")
    with pytest.raises(ConfigError, match="DEV_LOGIN"):
        create_app(config)


# ---------- Google sign-in ----------

CLIENT_ID = "1234-test.apps.googleusercontent.com"


@pytest.fixture
def google_client():
    return create_app(make_config(google_client_id=CLIENT_ID)).test_client()


def fake_verifier(info: dict, calls: list):
    def verify(credential, request, audience=None, clock_skew_in_seconds=0):
        calls.append({"credential": credential, "audience": audience})
        return info

    return verify


def test_google_sign_in_returns_our_token(google_client, monkeypatch):
    calls = []
    info = {"iss": "https://accounts.google.com", "email": "Rae@Example.com", "email_verified": True}
    monkeypatch.setattr(auth.id_token, "verify_oauth2_token", fake_verifier(info, calls))

    response = google_client.post("/api/auth/google", json={"credential": "google-id-token"})

    assert response.status_code == 200
    body = response.get_json()
    assert body["user"] == {"email": REVIEWER_EMAIL, "name": REVIEWER_NAME, "role": "admin"}
    assert calls == [{"credential": "google-id-token", "audience": CLIENT_ID}]
    me = google_client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200


def test_google_sign_in_needs_a_verified_email(google_client, monkeypatch):
    info = {"email": REVIEWER_EMAIL, "email_verified": False}
    monkeypatch.setattr(auth.id_token, "verify_oauth2_token", fake_verifier(info, []))
    response = google_client.post("/api/auth/google", json={"credential": "t"})
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "email_not_verified"


def test_google_sign_in_needs_the_team_list(google_client, monkeypatch):
    info = {"email": "stranger@example.com", "email_verified": True}
    monkeypatch.setattr(auth.id_token, "verify_oauth2_token", fake_verifier(info, []))
    response = google_client.post("/api/auth/google", json={"credential": "t"})
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "not_on_team_list"


def test_google_sign_in_refuses_a_removed_user(google_client, monkeypatch):
    db = google_client.application.extensions["sf_db"]
    db["users"].update_one({"_id": REVIEWER_EMAIL}, {"$set": {"active": False}})
    info = {"email": REVIEWER_EMAIL, "email_verified": True}
    monkeypatch.setattr(auth.id_token, "verify_oauth2_token", fake_verifier(info, []))
    response = google_client.post("/api/auth/google", json={"credential": "t"})
    assert response.status_code == 403


def test_google_sign_in_with_a_token_google_rejects(google_client, monkeypatch):
    def reject(*args, **kwargs):
        raise ValueError("Token expired")

    monkeypatch.setattr(auth.id_token, "verify_oauth2_token", reject)
    response = google_client.post("/api/auth/google", json={"credential": "t"})
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "invalid_google_token"


def test_google_sign_in_without_a_client_id_is_503(client):
    response = client.post("/api/auth/google", json={"credential": "t"})
    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "google_not_configured"


def test_google_sign_in_needs_a_credential(google_client):
    response = google_client.post("/api/auth/google", json={})
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_body"


# ---------- Signing out ----------


def test_signing_out_ends_that_token_at_once(client, db, headers, config):
    other_headers = bearer(config)
    assert client.get("/api/auth/me", headers=headers).status_code == 200

    response = client.post("/api/auth/logout", headers=headers)

    assert response.status_code == 200
    assert response.get_json() == {"signed_out": True}
    after = client.get("/api/auth/me", headers=headers)
    assert after.status_code == 401
    assert after.get_json()["error"]["code"] == "unauthorized"
    # Another sign-in by the same person still works.
    assert client.get("/api/auth/me", headers=other_headers).status_code == 200
    # Signing out twice is a 401, which the admin pages treat as done.
    assert client.post("/api/auth/logout", headers=headers).status_code == 401


def test_a_revoked_token_is_kept_until_it_would_have_expired(client, db, headers):
    token = headers["Authorization"].split(" ", 1)[1]
    claims = jwt.decode(token, TEST_SECRET, algorithms=["HS256"])

    client.post("/api/auth/logout", headers=headers)

    revoked = db["revoked_tokens"].find_one({"_id": claims["jti"]})
    assert revoked["email"] == REVIEWER_EMAIL
    assert int(revoked["expires_at"].timestamp()) == claims["exp"]


def test_every_token_gets_its_own_id(config):
    first, _ = auth.issue_token(config, REVIEWER_EMAIL)
    second, _ = auth.issue_token(config, REVIEWER_EMAIL)
    first_id = jwt.decode(first, TEST_SECRET, algorithms=["HS256"])["jti"]
    second_id = jwt.decode(second, TEST_SECRET, algorithms=["HS256"])["jti"]
    assert first_id != second_id


def test_a_token_from_before_sign_out_existed_gets_401(client):
    old = jwt.encode({"sub": REVIEWER_EMAIL, "exp": now() + timedelta(hours=1)}, TEST_SECRET, algorithm="HS256")
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {old}"})
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "unauthorized"
