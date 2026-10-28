"""Starting data: the default search config, the team list, and the milestones and posts in content/.

With an in-memory database (MONGO_URI=mongomock://...) create_app() seeds all
of them on every start, because nothing survives a restart. With a real
database the CLI does it once:

    flask --app sf_api seed-config
    flask --app sf_api users add <email> "<name>"
    flask --app sf_api content import-milestones ../content/milestones.json
    flask --app sf_api content import-posts ../content/posts
"""

import json
import logging
from pathlib import Path

from sf_api.documents import to_document
from sf_api.editing import SEED_USER, ImportProblems
from sf_api.milestones import import_milestones
from sf_api.posts import import_posts
from sf_shared.db import now
from sf_shared.pipeline_models import DEFAULT_QUERIES, SearchConfig, User

log = logging.getLogger(__name__)


def default_search_config() -> SearchConfig:
    return SearchConfig(queries=list(DEFAULT_QUERIES))


def seed_search_config(db, replace_existing: bool = False) -> bool:
    """Save the default search config. Returns False if one was already there and was kept."""
    collection = db["search_config"]
    if not replace_existing and collection.find_one({"_id": "default"}) is not None:
        return False
    config = default_search_config()
    config.updated_by = "seed"
    config.updated_at = now()
    collection.replace_one({"_id": "default"}, to_document(config), upsert=True)
    return True


def save_user(db, email: str, display_name: str) -> dict:
    """Add someone to the team list, or update their name and turn them back on."""
    user = User(id=email.strip().lower(), display_name=display_name.strip(), active=True)
    document = to_document(user)
    db["users"].replace_one({"_id": document["_id"]}, document, upsert=True)
    return document


def seed_dev_users(db, dev_users: tuple[tuple[str, str], ...]) -> None:
    for email, display_name in dev_users:
        save_user(db, email, display_name)


def seed_content(db, content_dir: Path) -> None:
    """Fill an in-memory database with the milestones and posts in content/.

    A missing or invalid file is logged and skipped, so the API still starts
    (the validator in CI reports content problems properly).
    """
    milestones_path = content_dir / "milestones.json"
    if milestones_path.exists():
        try:
            records = json.loads(milestones_path.read_text(encoding="utf-8"))
            import_milestones(db, content_dir, records, "seed", SEED_USER)
        except (json.JSONDecodeError, ImportProblems) as error:
            log.warning("Didn't load %s into the in-memory database: %s", milestones_path, describe(error))

    posts_dir = content_dir / "posts"
    if posts_dir.is_dir():
        try:
            import_posts(db, posts_dir, "seed", SEED_USER)
        except ImportProblems as error:
            log.warning("Didn't load %s into the in-memory database: %s", posts_dir, describe(error))


def describe(error: Exception) -> str:
    if isinstance(error, ImportProblems):
        return "; ".join(error.problems[:5])
    return str(error)
