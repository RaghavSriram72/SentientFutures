"""Fixtures: an in-memory database, a small content folder, and settings that point at both.

Everything runs offline. HTTP goes through httpx.MockTransport and the model
through the fake client in fakes.py.
"""

import json
from pathlib import Path

import mongomock
import pytest
from fakes import RecordingSleep
from sf_shared.db import ensure_indexes

from sf_pipeline.config import Settings

MILESTONES = [
    {"id": "bci-sample-medical-approval", "name": "A sample milestone", "sample": True},
    {"id": "wbe-reliability", "name": "A human brain emulation reproduces relevant behavior in controlled tests", "sample": False},
    {"id": "wbe-legal", "name": "Clear legal authorization and safeguards exist"},
]

SITE_SOURCES = [
    {"id": "s13", "title": "NeuroAI for AI Safety", "year": 2025, "arxiv_id": "2411.18526", "doi": None},
    {"id": "s19", "title": "Neurosurveillance in the workplace", "year": 2023, "arxiv_id": None, "doi": "10.3389/fhumd.2023.1245619"},
    {"id": "sample-bci-trial", "title": "Sample source", "year": 2025, "arxiv_id": "0000.00000", "sample": True},
]


@pytest.fixture
def db():
    database = mongomock.MongoClient(tz_aware=True)["sf_pipeline_test"]
    ensure_indexes(database)
    return database


@pytest.fixture
def content_dir(tmp_path: Path) -> Path:
    folder = tmp_path / "content"
    folder.mkdir()
    (folder / "milestones.json").write_text(json.dumps(MILESTONES), encoding="utf-8")
    (folder / "sources.json").write_text(json.dumps(SITE_SOURCES), encoding="utf-8")
    return folder


@pytest.fixture
def settings(content_dir: Path) -> Settings:
    return Settings(
        mongo_uri="mongomock://test",
        anthropic_api_key="test-key-not-real",
        semantic_scholar_api_key=None,
        runner="local",
        contact="tests@example.invalid",
        content_dir=content_dir,
    )


@pytest.fixture
def no_sleep() -> RecordingSleep:
    return RecordingSleep()
