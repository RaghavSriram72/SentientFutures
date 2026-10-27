"""Fixtures: a complete content folder in tmp_path that tests can break on purpose.

It uses the real content/milestones.json and content/sources.json, plus our own
technologies.json and one post, so the tests don't depend on those files
existing in content/ yet.
"""

import shutil
from pathlib import Path

import pytest
from helpers import POST_TEXT, REAL_CONTENT, technology_page, write_json


@pytest.fixture
def content_dir(tmp_path: Path) -> Path:
    folder = tmp_path / "content"
    folder.mkdir()
    shutil.copy(REAL_CONTENT / "milestones.json", folder / "milestones.json")
    shutil.copy(REAL_CONTENT / "sources.json", folder / "sources.json")

    pages = []
    for tech_id in ["wbe", "bci", "neuromorphic"]:
        pages.append(technology_page(tech_id))
    write_json(folder / "technologies.json", pages)

    (folder / "posts").mkdir()
    (folder / "posts" / "about-this-blog.md").write_text(POST_TEXT, encoding="utf-8")
    return folder
