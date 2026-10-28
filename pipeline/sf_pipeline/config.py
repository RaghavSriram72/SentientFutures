"""Settings read from the environment.

    MONGO_URI                  which database (read by sf_shared.db.get_db)
    ANTHROPIC_API_KEY          triage is skipped when it isn't set
    SEMANTIC_SCHOLAR_API_KEY   optional; raises the Semantic Scholar rate limit
    PIPELINE_RUNNER            "local" or "github"; recorded on each run
    PIPELINE_CONTACT           an email or URL for the User-Agent header, so the
                               people running arXiv and Semantic Scholar can reach
                               us if the pipeline misbehaves
    CONTENT_DIR                the content/ folder (milestones.json, sources.json).
                               Defaults to the one in this repo.

Everything the team tunes (searches, limits, model, effort) lives in the
search_config document instead, so it can be changed from the admin pages.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

from sf_shared.db import DEFAULT_URI

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONTENT_DIR = REPO_ROOT / "content"

# Replace with a real address through PIPELINE_CONTACT before running against
# the live APIs. arXiv and Semantic Scholar both ask for a way to reach you.
CONTACT_PLACEHOLDER = "contact-not-set@example.invalid"

PIPELINE_VERSION = "0.1.0"

Runner = Literal["local", "github"]


@dataclass(frozen=True)
class Settings:
    mongo_uri: str
    anthropic_api_key: str | None
    semantic_scholar_api_key: str | None
    runner: Runner
    contact: str
    content_dir: Path

    @property
    def user_agent(self) -> str:
        return f"SentientFuturesPipeline/{PIPELINE_VERSION} (research literature search; contact: {self.contact})"

    @property
    def triage_configured(self) -> bool:
        return bool(self.anthropic_api_key)


def read_env(name: str) -> str | None:
    """The variable's value, or None when it's unset or blank."""
    value = os.environ.get(name, "").strip()
    return value or None


def load_settings() -> Settings:
    runner = read_env("PIPELINE_RUNNER") or "local"
    if runner not in ("local", "github"):
        raise ValueError(f'PIPELINE_RUNNER must be "local" or "github", not "{runner}"')

    content_dir = read_env("CONTENT_DIR")
    return Settings(
        mongo_uri=read_env("MONGO_URI") or DEFAULT_URI,
        anthropic_api_key=read_env("ANTHROPIC_API_KEY"),
        semantic_scholar_api_key=read_env("SEMANTIC_SCHOLAR_API_KEY"),
        runner=cast(Runner, runner),  # checked just above
        contact=read_env("PIPELINE_CONTACT") or CONTACT_PLACEHOLDER,
        content_dir=Path(content_dir) if content_dir else DEFAULT_CONTENT_DIR,
    )
