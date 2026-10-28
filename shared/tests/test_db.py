"""ensure_indexes runs at every API start and every pipeline run, so it has to be safe to repeat."""

import mongomock

from sf_shared.db import ensure_indexes


def test_ensure_indexes_can_run_again_once_sources_exist():
    db = mongomock.MongoClient(tz_aware=True)["sf_test"]
    ensure_indexes(db)
    # Two sources with no DOI and no Semantic Scholar id: fine for the partial
    # unique indexes, but mongomock trips over them if the index is rebuilt.
    db["sources"].insert_many(
        [
            {"_id": "arxiv-1", "doi": None, "arxiv_id": "2610.00001", "s2_id": None, "title_key": "one"},
            {"_id": "arxiv-2", "doi": None, "arxiv_id": "2610.00002", "s2_id": None, "title_key": "two"},
        ]
    )

    ensure_indexes(db)

    names = set(db["sources"].index_information())
    assert {"unique_doi", "unique_arxiv_id", "unique_s2_id", "title_key", "queue_order"} <= names


class RecordingCollection:
    def __init__(self) -> None:
        self.created: list[tuple[object, dict]] = []

    def index_information(self) -> dict:
        return {}

    def create_index(self, keys, **options) -> None:
        self.created.append((keys, options))


class RecordingDatabase:
    """Stands in for a real MongoDB database, recording the indexes asked for."""

    def __init__(self) -> None:
        self.collections: dict[str, RecordingCollection] = {}

    def __getitem__(self, name: str) -> RecordingCollection:
        if name not in self.collections:
            self.collections[name] = RecordingCollection()
        return self.collections[name]


def test_signed_out_tokens_expire_at_their_own_expiry_on_a_real_database():
    db = RecordingDatabase()
    ensure_indexes(db)
    assert db["revoked_tokens"].created == [("expires_at", {"name": "expire_at_token_expiry", "expireAfterSeconds": 0})]


def test_an_in_memory_database_gets_no_ttl_index():
    # mongomock can't expire timezone-aware times and warns on every read when it tries.
    db = mongomock.MongoClient(tz_aware=True)["sf_test_ttl"]
    ensure_indexes(db)
    assert "expire_at_token_expiry" not in db["revoked_tokens"].index_information()
    assert "by_milestone" in db["milestone_revisions"].index_information()
