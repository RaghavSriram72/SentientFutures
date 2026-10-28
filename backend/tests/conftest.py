"""Fixtures: an app with its own in-memory database, a test client, and a signed-in header."""

import pytest
from api_helpers import bearer, make_config

from sf_api import create_app


@pytest.fixture
def config():
    return make_config()


@pytest.fixture
def app(config):
    return create_app(config)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def db(app):
    return app.extensions["sf_db"]


@pytest.fixture
def headers(app):
    """Authorization for the seeded reviewer, Rae."""
    return bearer(app.extensions["sf_config"])
