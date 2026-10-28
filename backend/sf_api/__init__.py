"""The admin API for the source pipeline (see docs/pipeline-architecture.md).

Run it locally with an in-memory database and dev sign-in:

    DEV_LOGIN=1 DEV_USERS="you@example.com:Your Name" flask --app sf_api run --port 5050 --debug

In production gunicorn serves backend/wsgi.py.
"""

import logging

from flask import Flask
from flask_cors import CORS

from sf_api import (
    auth,
    content_routes,
    health_routes,
    pipeline_routes,
    public_routes,
    queue_routes,
    site_routes,
    sources_routes,
)
from sf_api.cli import register_cli
from sf_api.config import Config, check_config
from sf_api.documents import ApiJSONProvider
from sf_api.errors import register_error_handlers
from sf_api.seed import seed_content, seed_dev_users, seed_search_config
from sf_shared.db import ensure_indexes, get_db

log = logging.getLogger(__name__)

# The biggest real body is a milestone or a blog post, tens of kilobytes at most.
MAX_BODY_BYTES = 1024 * 1024


def create_app(config: Config | None = None) -> Flask:
    """Build the app. With no config, settings come from the environment.

    Raises ConfigError (listing every problem) if the settings can't run safely,
    for example DEV_LOGIN in production.
    """
    if config is None:
        config = Config.from_env()
    config = check_config(config)

    # An API only: no static folder, so no /static route to guard.
    app = Flask(__name__, static_folder=None)
    app.json = ApiJSONProvider(app)
    app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

    # The admin pages are on another site (github.io, or localhost:3000), so
    # the browser needs CORS headers. Tokens go in a header, not a cookie, so
    # credentials stay off.
    CORS(
        app,
        resources={r"/api/*": {"origins": list(config.cors_origins)}},
        allow_headers=["Authorization", "Content-Type"],
        methods=["GET", "POST", "PUT", "OPTIONS"],
        max_age=600,
    )

    db = get_db(config.mongo_uri)
    # Fails here, at start, if the database can't be reached: a clear error in
    # the deploy log beats a server that starts and then fails every request.
    ensure_indexes(db)
    if config.db_in_memory:
        # Nothing survives a restart, so seed what a fresh database needs.
        seed_search_config(db)
        seed_dev_users(db, config.dev_users)
        seed_content(db, config.content_dir)
        log.warning("Using an in-memory database. Everything in it is lost when the server stops.")

    app.extensions["sf_db"] = db
    app.extensions["sf_config"] = config

    register_error_handlers(app)
    auth.init_auth(app)
    app.register_blueprint(health_routes.blueprint)
    app.register_blueprint(pipeline_routes.blueprint)
    app.register_blueprint(queue_routes.blueprint)
    app.register_blueprint(public_routes.blueprint)
    app.register_blueprint(content_routes.blueprint)
    app.register_blueprint(sources_routes.blueprint)
    app.register_blueprint(site_routes.blueprint)
    register_cli(app)
    return app
