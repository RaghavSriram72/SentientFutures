"""Settings from the environment, and the rules that keep production safe."""

import pytest
from api_helpers import make_config

from sf_api import create_app
from sf_api.config import Config, ConfigError, check_config

PRODUCTION = {
    "APP_ENV": "production",
    "JWT_SECRET": "x" * 40,
    "MONGO_URI": "mongodb+srv://user:password@cluster.example.mongodb.net",
}


def test_defaults_work_for_local_development():
    config = Config.from_env({})
    assert config.env == "development"
    assert config.mongo_uri == "mongomock://local"
    assert config.pipeline_runner == "local"
    assert config.dev_login is False
    assert config.dev_users == ()
    assert config.cors_origins == ("http://localhost:3000", "http://localhost:4173")
    assert config.triage_configured is False
    assert config.google_client_id is None


def test_dev_users_are_parsed_and_emails_lowercased():
    config = Config.from_env({"DEV_USERS": "Raghav@Example.com:Raghav Sriram, vilija@example.com:Vilija"})
    assert config.dev_users == (("raghav@example.com", "Raghav Sriram"), ("vilija@example.com", "Vilija"))


@pytest.mark.parametrize("text", ["raghav@example.com", "raghav@example.com:", "not-an-email:Name"])
def test_dev_users_entries_need_an_email_and_a_name(text):
    with pytest.raises(ConfigError, match="DEV_USERS"):
        Config.from_env({"DEV_USERS": text})


def test_cors_origins_are_split_on_commas():
    config = Config.from_env({"CORS_ORIGINS": "http://localhost:3000, https://someone.github.io,"})
    assert config.cors_origins == ("http://localhost:3000", "https://someone.github.io")


def test_flags_and_keys():
    config = Config.from_env({"DEV_LOGIN": "true", "ANTHROPIC_API_KEY": "sk-test"})
    assert config.dev_login is True
    assert config.triage_configured is True
    assert config.pipeline_runner == "local"


def test_triage_is_unknown_with_the_github_runner():
    # The key is a GitHub Actions secret there, so the API can't tell either way.
    for environ in ({"PIPELINE_RUNNER": "GitHub"}, {"PIPELINE_RUNNER": "github", "ANTHROPIC_API_KEY": "sk-test"}):
        config = Config.from_env(environ)
        assert config.pipeline_runner == "github"
        assert config.triage_configured is None


def test_unknown_runner_is_refused():
    with pytest.raises(ConfigError, match="PIPELINE_RUNNER"):
        check_config(Config.from_env({"PIPELINE_RUNNER": "cron"}))


def test_unknown_env_name_is_refused():
    with pytest.raises(ConfigError, match="APP_ENV"):
        Config.from_env({"APP_ENV": "prodution"})


def test_production_wins_if_either_variable_says_so():
    config = Config.from_env({"APP_ENV": "development", "FLASK_ENV": "production"})
    assert config.is_production


def test_production_needs_a_jwt_secret():
    environ = dict(PRODUCTION)
    del environ["JWT_SECRET"]
    with pytest.raises(ConfigError, match="JWT_SECRET is required"):
        check_config(Config.from_env(environ))


def test_production_needs_a_long_jwt_secret():
    environ = dict(PRODUCTION, JWT_SECRET="short")
    with pytest.raises(ConfigError, match="at least 32"):
        check_config(Config.from_env(environ))


def test_production_refuses_an_in_memory_database():
    environ = dict(PRODUCTION, MONGO_URI="mongomock://local")
    with pytest.raises(ConfigError, match="in-memory"):
        check_config(Config.from_env(environ))


def test_production_lists_every_problem_at_once():
    environ = {"APP_ENV": "production", "DEV_LOGIN": "1"}
    with pytest.raises(ConfigError) as raised:
        check_config(Config.from_env(environ))
    message = str(raised.value)
    assert "JWT_SECRET" in message
    assert "DEV_LOGIN" in message
    assert "in-memory" in message


def test_a_good_production_config_passes():
    config = check_config(Config.from_env(PRODUCTION))
    assert config.jwt_secret == "x" * 40


def test_development_makes_up_a_secret_when_none_is_set():
    config = check_config(Config.from_env({}))
    assert config.jwt_secret is not None
    assert len(config.jwt_secret) >= 32


def test_in_memory_database_is_seeded_with_search_config_and_dev_users():
    app = create_app(make_config(dev_users=(("one@example.com", "One"), ("two@example.com", "Two"))))
    db = app.extensions["sf_db"]
    assert db["search_config"].find_one({"_id": "default"}) is not None
    emails = []
    for user in db["users"].find().sort("_id", 1):
        emails.append(user["_id"])
    assert emails == ["one@example.com", "two@example.com"]


def test_indexes_are_created_on_start(db):
    names = set(db["sources"].index_information())
    assert {"unique_doi", "unique_arxiv_id", "unique_s2_id", "queue_order"} <= names


# ---------- DEV_LOGIN only with a local database ----------


@pytest.mark.parametrize(
    "uri",
    [
        "mongomock://local",
        "mongodb://localhost",
        "mongodb://localhost:27017",
        "mongodb://127.0.0.1:27017/sentient_futures?directConnection=true",
        "mongodb://dev:p%40ss@localhost:27017/admin",
        "mongodb://[::1]:27017",
        "mongodb://localhost:27017,127.0.0.1:27018/?replicaSet=rs0",
        "mongodb://%2Ftmp%2Fmongodb-27017.sock",
    ],
)
def test_dev_login_works_with_a_local_database(uri):
    config = check_config(Config.from_env({"DEV_LOGIN": "1", "MONGO_URI": uri}))
    assert config.dev_login is True


@pytest.mark.parametrize(
    "uri",
    [
        "mongodb+srv://user:password@cluster.example.mongodb.net",
        "mongodb://user:password@db.example.com:27017",
        "mongodb://localhost.example.com:27017",
        "mongodb://localhost:27017,db.example.com:27017/?replicaSet=rs0",
        "mongodb://user:password@db.example.com/localhost",
    ],
)
def test_dev_login_is_refused_with_a_remote_database(uri):
    with pytest.raises(ConfigError, match="DEV_LOGIN") as raised:
        check_config(Config.from_env({"DEV_LOGIN": "1", "MONGO_URI": uri}))
    # The connection string usually holds a password, so it isn't repeated.
    assert "password" not in str(raised.value)


def test_a_remote_database_is_fine_without_dev_login():
    config = check_config(Config.from_env({"MONGO_URI": "mongodb+srv://user:password@cluster.example.mongodb.net"}))
    assert config.dev_login is False
