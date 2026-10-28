"""Reviews and AI assessments are insert-only. The pipeline is the only code
that writes ai_assessments, so this reads the pipeline's source (and the
shared package it uses) and fails if any of it could update, replace or
delete either collection. backend/tests/test_insert_only.py does the same
for the API."""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIRS = [REPO_ROOT / "pipeline" / "sf_pipeline", REPO_ROOT / "shared" / "sf_shared"]

PROTECTED = r"(reviews|ai_assessments)"
WRITE_METHODS = (
    r"(update_one|update_many|replace_one|delete_one|delete_many|bulk_write|drop"
    r"|find_one_and_update|find_one_and_replace|find_one_and_delete)"
)
# db["ai_assessments"].update_one(...), db.reviews.delete_many(...)
DIRECT_WRITE = re.compile(r"""(\[\s*["']""" + PROTECTED + r"""["']\s*\]|\.""" + PROTECTED + r")\s*\.\s*" + WRITE_METHODS)
# assessments = db["ai_assessments"]: a handle like this could be written
# through later, so the code never keeps one.
HANDLE = re.compile(r"""=\s*\w+\s*\[\s*["']""" + PROTECTED + r"""["']\s*\]\s*$""")


def python_files() -> list[Path]:
    files: list[Path] = []
    for folder in SOURCE_DIRS:
        files.extend(sorted(folder.rglob("*.py")))
    return files


def test_the_pipeline_never_updates_or_deletes_reviews_or_assessments():
    files = python_files()
    assert any(path.name == "triage.py" for path in files)
    problems = []
    for path in files:
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if DIRECT_WRITE.search(line) or HANDLE.search(line):
                problems.append(f"{path.relative_to(REPO_ROOT)}:{number}: {line.strip()}")
    assert problems == []


def test_the_check_catches_a_write():
    assert DIRECT_WRITE.search('db["ai_assessments"].update_one({"_id": x}, {})')
    assert DIRECT_WRITE.search("db.reviews.delete_many({})")
    assert HANDLE.search('assessments = db["ai_assessments"]')
    assert not DIRECT_WRITE.search('db["ai_assessments"].insert_many(documents)')
