"""Reviews, AI assessments, milestone and post revisions, and site publishes are
insert-only. This reads the API's own source and fails if any code could
update, replace or delete them."""

import re
from pathlib import Path

API_SOURCE = Path(__file__).resolve().parents[1] / "sf_api"

PROTECTED = r"(reviews|ai_assessments|milestone_revisions|post_revisions|site_publishes)"
WRITE_METHODS = (
    r"(update_one|update_many|replace_one|delete_one|delete_many|bulk_write|drop"
    r"|find_one_and_update|find_one_and_replace|find_one_and_delete)"
)
# db["reviews"].update_one(...), db.reviews.delete_many(...)
DIRECT_WRITE = re.compile(r"""(\[\s*["']""" + PROTECTED + r"""["']\s*\]|\.""" + PROTECTED + r")\s*\.\s*" + WRITE_METHODS)
# collection = db["reviews"]: a handle like this could be written through later,
# so the API never keeps one.
HANDLE = re.compile(r"""=\s*\w+\s*\[\s*["']""" + PROTECTED + r"""["']\s*\]\s*$""")


def test_api_never_updates_or_deletes_reviews_or_assessments():
    files = sorted(API_SOURCE.glob("*.py"))
    assert len(files) > 5
    problems = []
    for path in files:
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if DIRECT_WRITE.search(line) or HANDLE.search(line):
                problems.append(f"{path.name}:{number}: {line.strip()}")
    assert problems == []


def test_the_check_catches_a_write():
    assert DIRECT_WRITE.search('db["reviews"].update_one({"_id": x}, {})')
    assert DIRECT_WRITE.search("db.ai_assessments.delete_many({})")
    assert HANDLE.search('reviews = db["reviews"]')
    assert not DIRECT_WRITE.search('db["reviews"].insert_one(document)')
    assert DIRECT_WRITE.search('db["milestone_revisions"].replace_one({}, {})')
    assert DIRECT_WRITE.search('db["site_publishes"].delete_one({})')
    assert not DIRECT_WRITE.search('db["post_revisions"].insert_one(document)')
