"""The database and config for the app handling the current request.

create_app() puts both on app.extensions; routes reach them through these two
functions instead of module globals, so tests can run several apps side by side.
"""

from flask import current_app

from sf_api.config import Config


def app_db():
    return current_app.extensions["sf_db"]


def app_config() -> Config:
    return current_app.extensions["sf_config"]
