"""Sign-in for the admin pages.

1. The admin page shows Google's sign-in button and gets an ID token from Google.
2. It posts that token to /api/auth/google. We check it with Google's public
   keys, check the email is verified, and check the email is on the team list
   (the users collection).
3. We answer with our own token (a JWT, valid for 8 hours). The admin pages
   send it as "Authorization: Bearer <token>" on every request.

Cookies don't work here because the public site (github.io) and the API live
on different sites, so the browser won't send them.

The user is looked up again on every request, so removing someone from the
team list locks them out at once, even with a token that hasn't expired.

Signing out (POST /api/auth/logout) ends the token itself: its id (the "jti"
claim) goes into revoked_tokens, and every request checks that list. Each
entry is deleted by a TTL index once the token would have expired anyway.
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from flask import Blueprint, Flask, g, jsonify, request
from google.auth import exceptions as google_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, ConfigDict
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from sf_api.app_state import app_config, app_db
from sf_api.config import Config
from sf_api.documents import iso
from sf_api.errors import ApiError, parse_body
from sf_shared.claims import NonEmptyStr
from sf_shared.db import now

TOKEN_LIFETIME = timedelta(hours=8)
TOKEN_ALGORITHM = "HS256"

# Everything else under /api needs a signed-in team member.
OPEN_PATHS = ("/api/health", "/api/auth/google", "/api/auth/dev")
OPEN_PREFIXES = ("/api/public/",)

blueprint = Blueprint("auth", __name__, url_prefix="/api/auth")


class GoogleSignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential: NonEmptyStr  # the ID token from Google's sign-in button


class DevSignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: NonEmptyStr


# ---------- Users ----------


def find_active_user(db, email: str) -> dict | None:
    user = db["users"].find_one({"_id": email})
    if user is None or not user.get("active", True):
        return None
    return user


def user_json(user: dict) -> dict:
    return {"email": user["_id"], "name": user["display_name"], "role": user.get("role", "admin")}


def current_user() -> dict:
    """The signed-in user for this request: {email, name, role}."""
    return g.user


# ---------- Our tokens ----------


def issue_token(config: Config, email: str) -> tuple[str, str]:
    """A signed token for this email, and when it expires (ISO 8601).

    The jti is a random id for this one token, so signing out can end it
    without ending the person's other sign-ins.
    """
    issued_at = now()
    expires_at = issued_at + TOKEN_LIFETIME
    payload = {
        "sub": email,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, config.jwt_secret, algorithm=TOKEN_ALGORITHM)
    return token, iso(expires_at)


def read_token_claims(config: Config, token: str) -> dict:
    """The claims inside a valid token. Raises a 401 for a bad, expired or incomplete one.

    Tokens issued before sign-out existed have no jti. They're refused, which
    asks those people to sign in once more.
    """
    try:
        claims = jwt.decode(
            token,
            config.jwt_secret,
            algorithms=[TOKEN_ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise ApiError(401, "token_expired", "Your sign-in has expired. Sign in again.") from None
    except jwt.InvalidTokenError:
        raise ApiError(401, "unauthorized", "Your sign-in isn't valid. Sign in again.") from None
    # Checked after the expiry, so an old expired token still says "expired".
    if not isinstance(claims.get("jti"), str) or claims["jti"] == "":
        raise ApiError(401, "unauthorized", "Your sign-in is from an older version of the site. Sign in again.")
    return claims


def read_token(config: Config, token: str) -> str:
    """The email inside a valid token."""
    return read_token_claims(config, token)["sub"]


def is_revoked(db, token_id: str) -> bool:
    return db["revoked_tokens"].find_one({"_id": token_id}, projection={"_id": 1}) is not None


def revoke_token(db, claims: dict) -> None:
    """Record that this token has signed out. Doing it twice changes nothing."""
    expires_at = datetime.fromtimestamp(int(claims["exp"]), tz=UTC)
    db["revoked_tokens"].update_one(
        {"_id": claims["jti"]},
        {"$setOnInsert": {"email": claims["sub"], "revoked_at": now(), "expires_at": expires_at}},
        upsert=True,
    )


def signed_in_response(email: str):
    user = find_active_user(app_db(), email)
    if user is None:
        raise ApiError(
            403,
            "not_on_team_list",
            f"{email} isn't on the team list. An admin can add it with: "
            f'flask --app sf_api users add {email} "Your Name"',
        )
    token, expires_at = issue_token(app_config(), email)
    return jsonify({"token": token, "expires_at": expires_at, "user": user_json(user)})


# ---------- The guard on every /api route ----------


def is_open_path(path: str) -> bool:
    if path in OPEN_PATHS:
        return True
    for prefix in OPEN_PREFIXES:
        if path.startswith(prefix):
            return True
    return False


def require_sign_in() -> None:
    path = request.path
    if not (path == "/api" or path.startswith("/api/")):
        return None
    # Browsers send a CORS preflight (OPTIONS) without the Authorization header.
    # It carries no data, and Flask-CORS answers it.
    if request.method == "OPTIONS":
        return None
    if is_open_path(path):
        return None

    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or token == "":
        raise ApiError(401, "unauthorized", "Sign in first. Send your token as: Authorization: Bearer <token>")

    claims = read_token_claims(app_config(), token)
    db = app_db()
    if is_revoked(db, claims["jti"]):
        raise ApiError(401, "unauthorized", "You signed out with this sign-in. Sign in again.")
    user = find_active_user(db, claims["sub"])
    if user is None:
        raise ApiError(401, "unauthorized", "This account isn't on the team list anymore.")
    g.user = user_json(user)
    g.token_claims = claims
    return None


# ---------- Google ----------


# Fetching Google's public keys is a network call, so it gets retried. A token
# Google rejects (ValueError) is not retried: it won't get better.
@retry(
    retry=retry_if_exception_type(google_exceptions.TransportError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.5, max=4),
    reraise=True,
)
def fetch_google_token_info(credential: str, client_id: str) -> dict:
    return id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        audience=client_id,
        clock_skew_in_seconds=10,
    )


def verify_google_credential(credential: str, client_id: str) -> str:
    """Check a Google ID token and return its lowercased, verified email."""
    try:
        info = fetch_google_token_info(credential, client_id)
    except google_exceptions.TransportError:
        message = "We couldn't reach Google to check your sign-in. Try again."
        raise ApiError(503, "google_unreachable", message) from None
    except (ValueError, google_exceptions.GoogleAuthError):
        # Covers a bad signature, an expired token, the wrong audience and the wrong issuer.
        raise ApiError(401, "invalid_google_token", "Google didn't accept that sign-in. Try again.") from None

    if info.get("email_verified") is not True:
        raise ApiError(403, "email_not_verified", "This Google account's email isn't verified.")
    email = info.get("email")
    if not isinstance(email, str) or "@" not in email:
        raise ApiError(401, "invalid_google_token", "Google's answer didn't include an email address.")
    return email.strip().lower()


# ---------- Routes ----------


@blueprint.post("/google")
def google_sign_in():
    config = app_config()
    if config.google_client_id is None:
        message = "Google sign-in isn't set up on this server (GOOGLE_CLIENT_ID is missing)."
        raise ApiError(503, "google_not_configured", message)
    body = parse_body(GoogleSignIn)
    email = verify_google_credential(body.credential, config.google_client_id)
    return signed_in_response(email)


@blueprint.post("/dev")
def dev_sign_in():
    if not app_config().dev_login:
        raise ApiError(404, "not_found", "Dev sign-in is off. It only works locally, with DEV_LOGIN=1.")
    body = parse_body(DevSignIn)
    return signed_in_response(body.email.strip().lower())


@blueprint.get("/me")
def me():
    return jsonify({"user": current_user()})


@blueprint.post("/logout")
def logout():
    """End the token this request was sent with. It's refused from now on.

    The guard has already checked the token, so a token that was signed out
    before gets a 401 here, which the admin pages can treat as done.
    """
    revoke_token(app_db(), g.token_claims)
    return jsonify({"signed_out": True})


def init_auth(app: Flask) -> None:
    app.before_request(require_sign_in)
    app.register_blueprint(blueprint)
