"""Settings for the API, read from environment variables.

Every variable is listed with a comment in .env.example at the repo root. The
rules that keep production safe live in check_config():

    JWT_SECRET must be set, and at least 32 characters
    DEV_LOGIN must be off
    MONGO_URI must be a real database (an in-memory one would lose every
    review on restart, and each gunicorn worker would get its own copy)

One rule applies everywhere: DEV_LOGIN only works with an in-memory database
or a MongoDB on this machine. It signs anyone in by email alone, so a
developer who points a local server at Atlas mustn't open the real data to
whoever can reach that server.
"""

import logging
import os
import secrets
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path

from sf_shared.db import DEFAULT_URI, is_in_memory

log = logging.getLogger(__name__)

DEFAULT_CORS_ORIGINS = ("http://localhost:3000", "http://localhost:4173")
# The repo's content/ folder. The Docker image sets CONTENT_DIR instead.
DEFAULT_CONTENT_DIR = Path(__file__).resolve().parents[2] / "content"
RUNNERS = ("local", "github")
MIN_JWT_SECRET_LENGTH = 32
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")

# APP_ENV (or FLASK_ENV) values we accept. Anything else is a typo, and a typo
# must not quietly turn production into development.
PRODUCTION_NAMES = ("production", "prod")
DEVELOPMENT_NAMES = ("development", "dev", "test", "testing")


class ConfigError(Exception):
    """The environment can't run the API. The message lists every problem."""


@dataclass(frozen=True)
class Config:
    env: str = "development"  # "development" or "production"
    mongo_uri: str = DEFAULT_URI
    pipeline_runner: str = "local"
    jwt_secret: str | None = None
    dev_login: bool = False
    dev_users: tuple[tuple[str, str], ...] = ()  # (email, display name)
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    github_token: str | None = None
    github_repo: str | None = None  # "owner/name"
    github_branch: str = "main"
    google_client_id: str | None = None
    # Whether runs started from admin can triage. None means the API can't
    # tell (see read_triage_configured).
    triage_configured: bool | None = False
    git_sha: str | None = None
    # content/: the source catalog includes content/sources.json, and an
    # in-memory database fills its milestones and posts from here at start.
    content_dir: Path = DEFAULT_CONTENT_DIR

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def db_in_memory(self) -> bool:
        return is_in_memory(self.mongo_uri)

    @staticmethod
    def from_env(environ: Mapping[str, str] | None = None) -> "Config":
        """Read the config from os.environ, or from the mapping given (tests pass one)."""
        if environ is None:
            environ = os.environ
        pipeline_runner = (read_text(environ, "PIPELINE_RUNNER") or "local").lower()
        return Config(
            env=read_env_name(environ),
            mongo_uri=read_text(environ, "MONGO_URI") or DEFAULT_URI,
            pipeline_runner=pipeline_runner,
            jwt_secret=read_text(environ, "JWT_SECRET"),
            dev_login=read_flag(environ, "DEV_LOGIN"),
            dev_users=parse_dev_users(environ.get("DEV_USERS", "")),
            cors_origins=parse_list(environ.get("CORS_ORIGINS", "")) or DEFAULT_CORS_ORIGINS,
            github_token=read_text(environ, "GITHUB_TOKEN"),
            github_repo=read_text(environ, "GITHUB_REPO"),
            github_branch=read_text(environ, "GITHUB_BRANCH") or "main",
            google_client_id=read_text(environ, "GOOGLE_CLIENT_ID"),
            triage_configured=read_triage_configured(environ, pipeline_runner),
            git_sha=read_text(environ, "GIT_SHA"),
            content_dir=read_content_dir(environ),
        )


def read_text(environ: Mapping[str, str], name: str) -> str | None:
    """The variable's value with spaces trimmed, or None when it's unset or blank."""
    value = environ.get(name, "").strip()
    if value == "":
        return None
    return value


def read_content_dir(environ: Mapping[str, str]) -> Path:
    value = read_text(environ, "CONTENT_DIR")
    if value is None:
        return DEFAULT_CONTENT_DIR
    return Path(value)


def read_flag(environ: Mapping[str, str], name: str) -> bool:
    value = environ.get(name, "").strip().lower()
    return value in ("1", "true", "yes", "on")


def read_triage_configured(environ: Mapping[str, str], pipeline_runner: str) -> bool | None:
    """Whether runs started from admin will triage, or None when the API can't know.

    The local runner triages with this server's ANTHROPIC_API_KEY. The GitHub
    runner uses the key stored as a GitHub Actions secret, which the API never
    sees, so any yes or no would be a guess.
    """
    if pipeline_runner == "github":
        return None
    return read_text(environ, "ANTHROPIC_API_KEY") is not None


def host_name(host: str) -> str:
    """'localhost:27017' -> 'localhost', '[::1]:27017' -> '::1'"""
    host = host.strip().lower()
    if host.startswith("["):
        return host[1:].partition("]")[0]
    return host.partition(":")[0]


def is_local_database(uri: str) -> bool:
    """True for an in-memory database or a MongoDB on this machine.

    mongodb+srv:// always means a remote cluster (Atlas). A mongodb:// URI can
    list several hosts for a replica set, and every one has to be local. A
    Unix socket path (percent-encoded, ending in .sock) is local too.
    """
    if is_in_memory(uri):
        return True
    prefix = "mongodb://"
    if not uri.lower().startswith(prefix):
        return False
    authority = uri[len(prefix) :]
    # The hosts end at the database name ("/") or the options ("?").
    authority = authority.split("/", 1)[0].split("?", 1)[0]
    # A user and password come first, ending at the last "@". MongoDB requires
    # an "@" inside the password to be percent-encoded.
    hosts = authority.rpartition("@")[2]
    for host in hosts.split(","):
        name = host_name(host)
        if name.endswith(".sock"):
            continue
        if name not in LOCAL_HOSTS:
            return False
    return True


def read_env_name(environ: Mapping[str, str]) -> str:
    """"production" if APP_ENV or FLASK_ENV says so, otherwise "development".

    If either one says production, production wins: it's the safer mistake.
    """
    names = []
    for variable in ("APP_ENV", "FLASK_ENV"):
        value = (read_text(environ, variable) or "").lower()
        if value != "":
            names.append((variable, value))

    for variable, value in names:
        if value in PRODUCTION_NAMES:
            return "production"
    for variable, value in names:
        if value not in DEVELOPMENT_NAMES:
            raise ConfigError(
                f'{variable}="{value}" isn\'t a setting we know. Use "production" or "development".'
            )
    return "development"


def parse_list(text: str) -> tuple[str, ...]:
    """'a, b,,c' -> ('a', 'b', 'c')"""
    items = []
    for part in text.split(","):
        part = part.strip()
        if part != "":
            items.append(part)
    return tuple(items)


def parse_dev_users(text: str) -> tuple[tuple[str, str], ...]:
    """'raghav@example.com:Raghav,vilija@example.com:Vilija' -> ((email, name), ...)"""
    users = []
    for entry in parse_list(text):
        email, separator, name = entry.partition(":")
        email = email.strip().lower()
        name = name.strip()
        if separator == "" or name == "" or "@" not in email:
            raise ConfigError(
                f'DEV_USERS entry "{entry}" should look like "email:Name", for example "raghav@example.com:Raghav".'
            )
        users.append((email, name))
    return tuple(users)


def check_config(config: Config) -> Config:
    """Raise ConfigError listing every problem, or return the config ready to use.

    In development a missing JWT_SECRET is replaced with a random one, so
    sign-in works out of the box. Tokens then last only until the server
    restarts, which is fine locally.
    """
    problems = []

    if config.env not in ("development", "production"):
        problems.append(f'env must be "development" or "production", not "{config.env}".')
    if config.pipeline_runner not in RUNNERS:
        problems.append(f'PIPELINE_RUNNER must be "local" or "github", not "{config.pipeline_runner}".')

    if config.is_production:
        if config.jwt_secret is None:
            problems.append("JWT_SECRET is required in production. Generate one with: openssl rand -hex 32")
        elif len(config.jwt_secret) < MIN_JWT_SECRET_LENGTH:
            problems.append(
                f"JWT_SECRET is {len(config.jwt_secret)} characters; use at least {MIN_JWT_SECRET_LENGTH}. "
                "Generate one with: openssl rand -hex 32"
            )
        if config.dev_login:
            problems.append("DEV_LOGIN signs people in without Google, so it can't be on in production.")
        if config.db_in_memory:
            problems.append(
                "MONGO_URI points at an in-memory database. In production that would lose every review "
                "on restart. Set it to your Atlas connection string."
            )
    elif config.dev_login and not is_local_database(config.mongo_uri):
        # The URI isn't repeated in the message: it usually holds a password.
        problems.append(
            "DEV_LOGIN signs people in without Google, so it only works with an in-memory database "
            "(mongomock://local) or a MongoDB on this machine (mongodb://localhost or 127.0.0.1). "
            "MONGO_URI points somewhere else. Turn DEV_LOGIN off to use that database."
        )

    if len(problems) > 0:
        raise ConfigError("The API can't start:\n  - " + "\n  - ".join(problems))

    if config.jwt_secret is None:
        log.warning("JWT_SECRET isn't set, so sign-in tokens only last until this server restarts.")
        config = replace(config, jwt_secret=secrets.token_hex(32))

    if config.pipeline_runner == "github" and (config.github_token is None or config.github_repo is None):
        log.warning("PIPELINE_RUNNER is github but GITHUB_TOKEN or GITHUB_REPO isn't set. Run now will fail.")
    if config.google_client_id is None and not config.dev_login:
        log.warning("GOOGLE_CLIENT_ID isn't set and DEV_LOGIN is off, so nobody can sign in.")

    return config
