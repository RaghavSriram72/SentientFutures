"""One way to open the database, shared by the pipeline and the API.

MONGO_URI picks the database:
    mongodb+srv://...      Atlas (production)
    mongodb://localhost    a local MongoDB
    mongomock://local      an in-memory fake, for development and tests. It lives
                           only inside the current process, so the API and the
                           pipeline only share it when the API runs the pipeline
                           itself (PIPELINE_RUNNER=local).
"""

import os
from datetime import UTC, datetime

DEFAULT_URI = "mongomock://local"
DB_NAME = os.environ.get("MONGO_DB", "sentient_futures")

_clients: dict[str, object] = {}


def get_db(uri: str | None = None):
    """Return the database for this URI, reusing one client per process."""
    uri = uri or os.environ.get("MONGO_URI", DEFAULT_URI)
    if uri not in _clients:
        if uri.startswith("mongomock://"):
            import mongomock

            _clients[uri] = mongomock.MongoClient(tz_aware=True)
        else:
            from pymongo import MongoClient

            _clients[uri] = MongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=5000, maxPoolSize=10)
    return _clients[uri][DB_NAME]


def is_in_memory(uri: str | None = None) -> bool:
    uri = uri or os.environ.get("MONGO_URI", DEFAULT_URI)
    return uri.startswith("mongomock://")


def now() -> datetime:
    """Timezone-aware UTC now, so stored times compare cleanly."""
    return datetime.now(UTC)


def create_index_once(collection, keys, name: str, **options) -> None:
    """Create an index unless one with this name is already there.

    Real MongoDB treats a repeated create_index as a no-op. mongomock instead
    rebuilds the index over the existing documents and ignores
    partialFilterExpression while it does, so the second call fails as soon
    as two sources have no DOI. Every pipeline run calls ensure_indexes, so
    without this check every local run after the first would fail.
    """
    if name in collection.index_information():
        return
    collection.create_index(keys, name=name, **options)


def ensure_indexes(db) -> None:
    """Indexes for dedupe, the queue, the editors and sign-out. Safe to call on every start."""
    sources = db["sources"]
    # Partial unique indexes: only documents where the field is a string take
    # part, so many sources with no DOI don't collide on null.
    for field in ("doi", "arxiv_id", "s2_id"):
        create_index_once(
            sources,
            field,
            name=f"unique_{field}",
            unique=True,
            partialFilterExpression={field: {"$type": "string"}},
        )
    create_index_once(sources, "title_key", name="title_key")
    create_index_once(sources, [("review_status", 1), ("found_at", 1)], name="queue_order")
    create_index_once(db["ai_assessments"], "source_id", name="by_source")
    create_index_once(db["reviews"], "source_id", name="by_source")
    create_index_once(db["pipeline_runs"], [("started_at", -1)], name="newest_first")

    # The milestone and post editors (editor_models.py).
    create_index_once(db["milestones"], [("position", 1), ("_id", 1)], name="list_order")
    create_index_once(db["milestone_revisions"], [("milestone_id", 1), ("saved_at", -1)], name="by_milestone")
    create_index_once(db["post_revisions"], [("post_slug", 1), ("saved_at", -1)], name="by_post")
    create_index_once(db["site_publishes"], [("requested_at", -1)], name="newest_first")
    # Signed-out tokens only matter until they would have expired anyway, so
    # MongoDB deletes each one at its expires_at. mongomock can't compare its
    # own naive clock with our timezone-aware times, so it would never expire
    # them and would warn on every read. An in-memory database is gone at the
    # next restart anyway, so it gets no TTL index.
    if not is_mongomock_database(db):
        create_index_once(db["revoked_tokens"], "expires_at", name="expire_at_token_expiry", expireAfterSeconds=0)


def is_mongomock_database(db) -> bool:
    return type(db).__module__.startswith("mongomock")
