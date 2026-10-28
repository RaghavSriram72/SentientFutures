"""Plain helpers for the API tests (fixtures live in conftest.py).

Test records are built with the shared Pydantic models, so they have exactly
the shape the pipeline writes.
"""

import json
import uuid
from dataclasses import replace
from datetime import datetime, timedelta

from sf_api.auth import issue_token
from sf_api.config import Config
from sf_api.documents import to_document
from sf_shared.db import now
from sf_shared.enums import RUBRIC_VERSION
from sf_shared.pipeline_models import AiAssessment, Candidate, TokenUsage, TriageResult

REVIEWER_EMAIL = "rae@example.com"
REVIEWER_NAME = "Rae Reviewer"
TEST_SECRET = "a-test-secret-that-is-long-enough-for-hs256-0123456789"
PROMPT_VERSION = "triage_v1-abcd1234"


def make_config(**overrides) -> Config:
    """A config with its own fresh in-memory database, so tests never share data."""
    base = Config(
        mongo_uri=f"mongomock://test-{uuid.uuid4().hex}",
        jwt_secret=TEST_SECRET,
        dev_users=((REVIEWER_EMAIL, REVIEWER_NAME),),
    )
    return replace(base, **overrides)


def bearer(config: Config, email: str = REVIEWER_EMAIL) -> dict:
    token, _ = issue_token(config, email)
    return {"Authorization": f"Bearer {token}"}


def insert_candidate(
    db,
    candidate_id: str,
    status: str = "pending_review",
    found_at: datetime | None = None,
    **fields,
) -> dict:
    moment = found_at or now()
    data = {
        "id": candidate_id,
        "origin": "pipeline",
        "collector": "arxiv",
        "title": f"A paper called {candidate_id}",
        "authors": ["Ada Author", "Ben Author"],
        "year": 2025,
        "url": f"https://arxiv.org/abs/{candidate_id}",
        "source_type": "preprint",
        "abstract": "We argue that brain computer interfaces could help with alignment.",
        "title_key": f"a paper called {candidate_id}",
        "review_status": status,
        "found_at": moment,
        "updated_at": moment,
    }
    data.update(fields)
    document = to_document(Candidate(**data))
    db["sources"].insert_one(document)
    return document


def triage_result(**overrides) -> TriageResult:
    data = {
        "relevant": "yes",
        "kind": "argument",
        "technology": ["bci"],
        "problem": "alignment",
        "claim_directions": ["ai_alignment"],
        "milestone_ids": [],
        "evidence": [],
    }
    data.update(overrides)
    return TriageResult(**data)


def insert_assessment(
    db,
    source_id: str,
    parsed: TriageResult | None = None,
    failed: bool = False,
    prompt_version: str = PROMPT_VERSION,
    created_at: datetime | None = None,
    make_current: bool = True,
) -> dict:
    """Store an AI assessment, and (by default) make it the source's current one."""
    if parsed is None and not failed:
        parsed = triage_result()
    assessment = AiAssessment(
        id=f"assessment-{uuid.uuid4().hex[:10]}",
        source_id=source_id,
        run_id=None,
        model="claude-haiku-5-5",
        effort="low",
        prompt_version=prompt_version,
        rubric_version=RUBRIC_VERSION,
        created_at=created_at or now(),
        stop_reason="end_turn",
        raw_output="{}",
        parsed=None if failed else parsed,
        quote_checks={},
        error="did not validate" if failed else None,
        usage=TokenUsage(input_tokens=900, output_tokens=150),
        cost_usd=0.0006,
    )
    document = to_document(assessment)
    db["ai_assessments"].insert_one(document)
    if make_current:
        db["sources"].update_one({"_id": source_id}, {"$set": {"current_assessment_id": document["_id"]}})
    return document


def approve_body(**overrides) -> dict:
    body = {
        "decision": "approve",
        "final": {
            "kind": "argument",
            "technology": ["bci"],
            "problem": "alignment",
            "claim_directions": ["ai_alignment"],
            "summary": "The authors argue that BCIs could give people a say in what AI systems learn.",
        },
        "ai_values_used": [],
        "notes": "",
    }
    body.update(overrides)
    return body


def minutes_ago(minutes: int) -> datetime:
    return now() - timedelta(minutes=minutes)


# ---------- A small content/ folder for the editor tests ----------

SITE_SOURCES = [
    {
        "id": "s13",
        "register_id": "S13",
        "title": "NeuroAI for AI Safety",
        "authors": ["Patrick Mineault"],
        "year": 2024,
        "url": "https://arxiv.org/abs/2411.18526",
        "arxiv_id": "2411.18526",
        "source_type": "preprint",
        "technology": ["neuromorphic"],
        "problem": "alignment",
        "summary": {"text": "A roadmap for NeuroAI safety research.", "provenance": "team"},
        "ai_suggested_fields": [],
    },
    {
        "id": "s19",
        "register_id": "S19",
        "title": "Neurosurveillance in the workplace",
        "authors": ["Someone Else"],
        "year": 2023,
        "url": "https://doi.org/10.3389/fhumd.2023.1245619",
        "doi": "10.3389/fhumd.2023.1245619",
        "source_type": "peer_reviewed",
        "technology": ["bci"],
        "problem": "intelligence_curse",
        "summary": {"text": "Workplace brain monitoring and its risks.", "provenance": "team"},
        "ai_suggested_fields": [],
    },
]


def unclear_claim(text: str = "We haven't assessed this yet.") -> dict:
    return {"text": text, "provenance": "unclear", "unclear_reason": "no_relevant_evidence"}


def valid_milestone(milestone_id: str, **overrides) -> dict:
    """A milestone that passes the shared Milestone model, like one in content/milestones.json."""
    data = {
        "id": milestone_id,
        "name": f"Milestone {milestone_id}",
        "technology": "wbe",
        "stage": "possible",
        "category": "technical_capability",
        "status": "not_demonstrated",
        "status_basis": {"text": "Nobody has shown this yet.", "provenance": "team"},
        "achieved_in": None,
        "achieved_in_basis": None,
        "confidence": None,
        "summary": {"text": "What this milestone is about.", "provenance": "team"},
        "success_criterion": {"text": "What would count as done.", "provenance": "team"},
        "main_bottleneck": unclear_claim(),
        "depends_on": [],
        "source_ids": [],
        "estimate": None,
        "forecasts": [],
        "disagreement_override": None,
        "disagreement_note": None,
        "would_move_earlier": [unclear_claim()],
        "would_move_later": [unclear_claim()],
        "artificial_minds_questions": [],
        "sample": False,
    }
    data.update(overrides)
    return data


POST_TEXT = """---
title: "About *this blog*"
slug: about-this-blog
date: "2026-10-26"
author: The team
summary: "What we'll write about here."
---

Posts here are looser than the rest of the site.
"""

SAMPLE_POST_TEXT = POST_TEXT.replace("about-this-blog", "sample-post")


def write_content(folder, milestones: list | None = None, sources: list | None = None, posts: dict | None = None):
    """Write a content/ folder: milestones.json, sources.json and posts/<name>.md."""
    folder.mkdir(parents=True, exist_ok=True)
    if milestones is not None:
        (folder / "milestones.json").write_text(json.dumps(milestones), encoding="utf-8")
    if sources is not None:
        (folder / "sources.json").write_text(json.dumps(sources), encoding="utf-8")
    if posts is not None:
        (folder / "posts").mkdir(exist_ok=True)
        for name, text in posts.items():
            (folder / "posts" / name).write_text(text, encoding="utf-8")
    return folder
