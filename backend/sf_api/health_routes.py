"""GET /api/health: open to anyone. DigitalOcean's health check calls it, and the
admin pages read it before sign-in to know which sign-in buttons to show."""

import logging

from flask import Blueprint, jsonify
from pymongo.errors import PyMongoError

from sf_api.app_state import app_config, app_db
from sf_shared.enums import RUBRIC_VERSION

log = logging.getLogger(__name__)

blueprint = Blueprint("health", __name__, url_prefix="/api")


def database_reachable(db) -> bool:
    try:
        db.command("ping")
    except PyMongoError as error:
        log.warning("Database ping failed: %s", error)
        return False
    return True


@blueprint.get("/health")
def health():
    """Always 200 while the server runs, so a database outage doesn't make
    DigitalOcean restart a server that's fine. "ok" and "db" say whether the
    database answered."""
    config = app_config()
    db_ok = database_reachable(app_db())
    db_state = "ok" if db_ok else "unreachable"
    return jsonify(
        {
            "ok": db_ok,
            "git_sha": config.git_sha,
            "rubric_version": RUBRIC_VERSION,
            "runner": config.pipeline_runner,
            "db": db_state,
            "db_in_memory": config.db_in_memory,
            "dev_login": config.dev_login,
            "triage_configured": config.triage_configured,
            "google_client_id": config.google_client_id,
        }
    )
