"""Small pieces the milestone and post editors share (milestones.py, posts.py)."""

import uuid
from dataclasses import dataclass

from sf_shared.db import now

# Shown as the author of seeded and imported records.
SEED_USER = {"email": "seed", "name": "content/ seed"}
IMPORT_USER = {"email": "import", "name": "Import from content/"}


class ImportProblems(Exception):
    """A file or folder can't be imported. `problems` has one line per problem."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__(f"{len(problems)} problems")
        self.problems = problems


@dataclass
class ImportResult:
    added: int = 0
    replaced: int = 0
    kept: int = 0  # already in the database, and replacing wasn't asked for


def new_revision_id() -> str:
    """e.g. revision-20261027-1a2b3c4d5e"""
    return "revision-" + now().strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:10]
