"""One-time move of content/ from the scorecard v0.1 shapes to v0.4. Kept for the record.

Run from the repo root:

    python -m sf_shared.migrate_v04 --content content/ --removed-text removed-text.json

What it does to content/technologies.json, on each page that still has the
v0.1 "sample" flag (a page without it counts as moved already, so a second
run changes nothing):

  - "sample" becomes "unreviewed_ai_sections" (same value). BCI and NM keep
    true: their intro and outline sections are AI drafts nobody has reviewed.
  - Removes the v0.1 sections the workbook (v0.4) replaces: theory_of_change,
    evidence_register, evidence_gap, artificial_minds_assessment, the v0.1
    scope and alignment_assessment (their v0.4 shapes need fields v0.1 never
    had), the v0.1 questions of intelligence_curse_assessment, and the
    welfare_governance fields v0.4 drops (severity, detectability, control,
    confidence).
  - Risk rows (scale "risk") take the v0.4 shape: rating null, severity and
    likelihood null, applicable true, basis null. unclear_reason and
    potential_severity go. The workbook never gives a single risk rating.
  - Case rows are left as they are; python -m sf_shared.import_workbook
    writes their v0.4 rating, confidence and basis.

If content/scorecard.json is missing it writes a placeholder with empty
tables, so the folder validates before the first import replaces it.

Every removed value is printed and, with --removed-text, written to that JSON
file as {"removed": [{"where": ..., "text": ...}]} for the team to review.
The result is checked with the validator before anything is written.
"""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from sf_shared.models import ScorecardFile, ScorecardRow, TechnologyPage
from sf_shared.validate import validate_content

# v0.1 page keys the v0.4 model no longer has.
REMOVED_PAGE_KEYS = ("theory_of_change", "evidence_register", "evidence_gap", "artificial_minds_assessment")
# v0.1 welfare_governance fields; v0.4 keeps exposed, harms and rationale.
REMOVED_WELFARE_KEYS = ("severity", "detectability", "control", "confidence")
# v0.1 risk row fields; v0.4 has severity and likelihood instead.
REMOVED_RISK_ROW_KEYS = ("unclear_reason", "potential_severity")

PLACEHOLDER_NOTE = (
    "Placeholder written by python -m sf_shared.migrate_v04 until the first import. "
    "python -m sf_shared.import_workbook replaces this file. Do not edit by hand."
)
# The workbook's Overview title, word for word.
WORKBOOK_TITLE = "Neuroengineering proposal scorecard framework"
WORKBOOK_VERSION = "0.4"

# One removed value: where it was, and what it said.
Removed = dict[str, str]


def removed_leaves(value: object, where: str, found: list[Removed]) -> None:
    """Every text or value inside a removed part, with its path. Provenance
    labels are left out: they only say whose words the text was."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "provenance":
                continue
            removed_leaves(child, f"{where}.{key}", found)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            removed_leaves(child, f"{where}[{index}]", found)
    elif value is not None:
        found.append({"where": where, "text": value if isinstance(value, str) else json.dumps(value)})


def in_model_order(data: dict, model_class: type) -> dict:
    """The same keys, in the model's field order (the order the importer writes)."""
    ordered: dict = {}
    for name in model_class.model_fields:
        if name in data:
            ordered[name] = data[name]
    for name, value in data.items():
        if name not in ordered:
            ordered[name] = value
    return ordered


def migrate_risk_row(row: dict, where: str, removed: list[Removed]) -> dict:
    """A v0.1 risk row in the v0.4 shape, with its old rating and basis listed as removed."""
    for key in ("rating", *REMOVED_RISK_ROW_KEYS, "basis"):
        if row.get(key) is not None:
            removed_leaves(row[key], f"{where}.{key}", removed)
    migrated = dict(row)
    for key in REMOVED_RISK_ROW_KEYS:
        migrated.pop(key, None)
    migrated["rating"] = None
    migrated["basis"] = None
    migrated.setdefault("severity", None)
    migrated.setdefault("likelihood", None)
    migrated.setdefault("applicable", True)
    return in_model_order(migrated, ScorecardRow)


def migrate_page(page: dict, where: str, removed: list[Removed]) -> dict:
    """One technology page moved to v0.4. A page without "sample" is already moved."""
    if "sample" not in page:
        return page
    migrated: dict = {}
    for key, value in page.items():
        if key == "sample":
            migrated["unreviewed_ai_sections"] = value
        else:
            migrated[key] = value

    for key in REMOVED_PAGE_KEYS:
        if key in migrated:
            removed_leaves(migrated.pop(key), f"{where}.{key}", removed)

    # The v0.4 Scope needs problems_claimed, and the alignment assessment
    # needs problem_addressed: a v0.1 section has neither, so it goes whole.
    scope = migrated.get("scope")
    if isinstance(scope, dict) and "problems_claimed" not in scope:
        removed_leaves(migrated.pop("scope"), f"{where}.scope", removed)
    alignment = migrated.get("alignment_assessment")
    if isinstance(alignment, dict) and "problem_addressed" not in alignment:
        removed_leaves(migrated.pop("alignment_assessment"), f"{where}.alignment_assessment", removed)

    curse = migrated.get("intelligence_curse_assessment")
    if isinstance(curse, dict) and "agency" not in curse and len(curse.get("questions", [])) > 0:
        curse = dict(curse)
        removed_leaves(curse.pop("questions"), f"{where}.intelligence_curse_assessment.questions", removed)
        migrated["intelligence_curse_assessment"] = curse

    welfare = migrated.get("welfare_governance")
    if isinstance(welfare, dict):
        welfare = dict(welfare)
        for key in REMOVED_WELFARE_KEYS:
            if key in welfare:
                removed_leaves(welfare.pop(key), f"{where}.welfare_governance.{key}", removed)
        migrated["welfare_governance"] = welfare

    rows = migrated.get("scorecard")
    if isinstance(rows, list):
        new_rows = []
        for index, row in enumerate(rows):
            if isinstance(row, dict) and row.get("scale") == "risk":
                row_where = f"{where}.scorecard[{index}] ({row.get('id')})"
                new_rows.append(migrate_risk_row(row, row_where, removed))
            else:
                new_rows.append(row)
        migrated["scorecard"] = new_rows

    return in_model_order(migrated, TechnologyPage)


def placeholder_scorecard() -> dict:
    """An empty scorecard.json that validates, until the first import."""
    data = {
        "generated": PLACEHOLDER_NOTE,
        "workbook": {"title": WORKBOOK_TITLE, "version": WORKBOOK_VERSION, "source_sha256": None},
    }
    return ScorecardFile.model_validate(data).model_dump(mode="json")


def json_text(data: object) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def migrate(content_dir: Path) -> tuple[dict[str, str], list[Removed]]:
    """The files to write (name -> text) and everything removed. Writes nothing."""
    removed: list[Removed] = []
    to_write: dict[str, str] = {}

    technologies_path = content_dir / "technologies.json"
    pages = json.loads(technologies_path.read_text(encoding="utf-8"))
    migrated_pages = []
    for index, page in enumerate(pages):
        where = f"technologies.json {page.get('id', index)}"
        migrated_pages.append(migrate_page(page, where, removed) if isinstance(page, dict) else page)
    if migrated_pages != pages:
        to_write["technologies.json"] = json_text(migrated_pages)

    if not (content_dir / "scorecard.json").exists():
        to_write["scorecard.json"] = json_text(placeholder_scorecard())
    return to_write, removed


def check_and_write(content_dir: Path, to_write: dict[str, str]) -> list[str]:
    """Validates a copy of the folder with the new files in it, then writes
    them for real. Returns the validator's errors (nothing is written if any)."""
    with tempfile.TemporaryDirectory() as scratch:
        copy = Path(scratch) / "content"
        copy.mkdir()
        for path in content_dir.iterdir():
            target = copy / path.name
            if path.is_dir():
                target.mkdir()
                for child in path.iterdir():
                    if child.is_file():
                        (target / child.name).write_bytes(child.read_bytes())
            elif path.is_file():
                target.write_bytes(path.read_bytes())
        for name, text in to_write.items():
            (copy / name).write_text(text, encoding="utf-8")
        report = validate_content(copy)
        if not report.ok:
            return report.errors

    for name, text in to_write.items():
        final = content_dir / name
        temporary = content_dir / f".{name}.migrating"
        temporary.write_text(text, encoding="utf-8")
        os.replace(temporary, final)
    return []


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Move content/ from the scorecard v0.1 shapes to v0.4 (one time).")
    parser.add_argument("--content", default="content", help="the content/ folder (default: content)")
    parser.add_argument("--removed-text", default=None, help="write every removed value to this JSON file")
    args = parser.parse_args(argv[1:])

    content_dir = Path(args.content)
    if not content_dir.is_dir():
        print(f"{content_dir}: folder not found")
        return 1

    to_write, removed = migrate(content_dir)
    if len(to_write) == 0:
        print("Nothing to do: content/ is already in the v0.4 shapes.")
        return 0

    errors = check_and_write(content_dir, to_write)
    if len(errors) > 0:
        for line in errors:
            print(line)
        print("FAILED: the migrated content doesn't validate, so nothing was written.")
        return 1

    for item in removed:
        print(f"Removed {item['where']}: {item['text']}")
    if args.removed_text is not None:
        Path(args.removed_text).write_text(json_text({"removed": removed}), encoding="utf-8")
        print(f"Wrote the {len(removed)} removed values to {args.removed_text}")
    print(f"OK: wrote {', '.join(sorted(to_write))}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
