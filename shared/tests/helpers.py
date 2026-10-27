"""Plain helpers shared by the tests (fixtures live in conftest.py)."""

import json
from pathlib import Path

from pydantic import BaseModel, ValidationError

from sf_shared.validate import format_validation_error, validate_content

REPO_ROOT = Path(__file__).resolve().parents[2]
REAL_CONTENT = REPO_ROOT / "content"

POST_TEXT = """---
title: "About this blog"
slug: about-this-blog
date: "2026-10-26"
author: Sample author
summary: What we'll write about here.
---

A short placeholder post.
"""


def team_claim(text: str) -> dict:
    return {"text": text, "provenance": "team"}


def technology_page(tech_id: str) -> dict:
    return {
        "id": tech_id,
        "name": f"Test page for {tech_id}",
        "short_name": tech_id.upper(),
        "headline": "Could this *keep humans* in the loop?",
        "intro": team_claim("Fixture intro."),
        "claims_to_solve": [team_claim("Fixture claim.")],
        "mechanism": [team_claim("Fixture mechanism.")],
        "strongest_case": [team_claim("Fixture case.")],
        "strongest_objections": [team_claim("Fixture objection.")],
        "scorecard": [
            {
                "dimension": "Alignment benefit",
                "problem": "alignment",
                "scale": "case",
                "rating": "weak",
                "confidence": "low",
                "basis": team_claim("Fixture basis."),
            }
        ],
        "artificial_minds_questions": [],
        "sample": True,
    }


def read_json(path: Path) -> list:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def run(content_dir: Path) -> list[str]:
    """Validate a content folder and return its error lines."""
    return validate_content(content_dir).errors


def milestone_index(milestones: list, milestone_id: str) -> int:
    for index, milestone in enumerate(milestones):
        if milestone["id"] == milestone_id:
            return index
    raise KeyError(milestone_id)


def model_errors(model_class: type[BaseModel], data: dict) -> list[str]:
    """Validate one record and return its error lines, labelled "record"."""
    try:
        model_class.model_validate(data)
    except ValidationError as problem:
        return format_validation_error("record", problem)
    return []


def sample_milestone(milestone_id: str = "wbe-sample-mouse-connectome") -> dict:
    """A fresh copy of one of the worked examples in content/milestones.json."""
    milestones = read_json(REAL_CONTENT / "milestones.json")
    return milestones[milestone_index(milestones, milestone_id)]


def sample_source(source_id: str = "sample-roadmap-report") -> dict:
    for source in read_json(REAL_CONTENT / "sources.json"):
        if source["id"] == source_id:
            return source
    raise KeyError(source_id)
