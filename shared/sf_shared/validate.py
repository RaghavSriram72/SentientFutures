"""Check everything in content/ before it reaches the site.

Run: python -m sf_shared.validate content/

Prints "OK: ..." with counts, or every problem it found (it never stops at the
first one) and exits with status 1. Each problem names where it is, e.g.
    milestones[3] (wbe-sample-human-emulation).forecasts[0].quote: required ...

What it checks:
  1. Each file parses and each record matches its model in models.py.
     scorecard.json (the workbook's shared tables, written by
     python -m sf_shared.import_workbook) is one object, checked as a whole.
  2. Cross-record rules: unique ids, every source id exists, every
     depends_on exists, no dependency cycles, and nothing real links to a
     sample (the public site leaves samples out). Every technology page has
     the same scorecard rows (same ids, dimensions, scales and problems, in
     the same order), and each scorecard row's milestone links point to real
     milestones of that page's technology.
  3. The workbook's codes: entry, link, risk and checklist ids are unique;
     every entry id, link id, risk id, checklist id and milestone row that
     scorecard.json, technologies.json or milestones.json names exists; every
     evidence entry's source is in sources.json. These are existence checks
     only: two tabs that list different entries for the same thing are the
     workbook's to settle, not this check's.
  4. Scorecard history dates and last_updated aren't in the future (a typo
     guard for the year).
  5. Every milestone category belongs to exactly one milestone type.
  6. Blog posts: valid frontmatter, unique slugs, at least one post.
  7. No em dashes (U+2014) or en dashes (U+2013) in any content file.

It also prints warnings, which don't fail the check: a count of the
AI-suggested claims nobody has reviewed yet (in sample records and in pages
with unreviewed_ai_sections), and the scorecard rows whose tracker is still a
placeholder.
"""

import difflib
import json
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml
from pydantic import BaseModel, ValidationError

from sf_shared.claims import RULES_ERROR_TYPE, find_claims, is_blank, join_path
from sf_shared.enums import Provenance, milestone_type_problems
from sf_shared.models import (
    ALL_MODELS,
    FAMILY_BY_PREFIX,
    FAMILY_MILESTONE_PATTERN,
    GOVERNANCE_ID_PATTERN,
    LINK_ID_PATTERN,
    RISK_ID_PATTERN,
    Milestone,
    PostFrontmatter,
    ScorecardFile,
    ScorecardRow,
    Source,
    TechnologyPage,
    quoted_or_null,
)

TECHNOLOGY_PAGE_IDS = ["wbe", "bci", "neuromorphic"]
EM_DASH = "\u2014"
EN_DASH = "\u2013"


def all_field_names() -> list[str]:
    """Every field name in the schema, used to suggest a fix for a misspelled key."""
    names: list[str] = []
    for model_class in ALL_MODELS:
        for name in model_class.model_fields:
            if name not in names:
                names.append(name)
    return names


ALL_FIELD_NAMES = all_field_names()


@dataclass
class Record:
    """One entry from a JSON file, before and after validation."""

    label: str  # e.g. "milestones[3] (wbe-sample-human-emulation)"
    raw: object  # the parsed JSON value
    model: BaseModel | None  # None when it failed validation


@dataclass
class Post:
    label: str  # e.g. "content/posts/about-this-blog.md"
    frontmatter: PostFrontmatter


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)  # printed, but the check still passes
    milestones: list[Record] = field(default_factory=list)
    sources: list[Record] = field(default_factory=list)
    technologies: list[Record] = field(default_factory=list)
    posts: list[Post] = field(default_factory=list)
    scorecard: ScorecardFile | None = None  # None when scorecard.json is missing or invalid

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0


# ---------------------------------------------------------------------------
# Turning Pydantic errors into readable lines


def format_location(location: tuple[int | str, ...]) -> str:
    """("forecasts", 0, "quote") -> "forecasts[0].quote"."""
    path = ""
    for part in location:
        if isinstance(part, int):
            path = join_path(path, f"[{part}]")
        else:
            path = join_path(path, str(part))
    return path


def describe_input(value: object) -> str:
    """Show the offending value when it's short enough to help."""
    if value is None or isinstance(value, (str, int, float, bool)):
        shown = json.dumps(value, ensure_ascii=False)
        if len(shown) > 60:
            shown = shown[:57] + "..."
        return f" (got {shown})"
    return ""


def describe_error(error_type: str, message: str, location: tuple[int | str, ...], value: object) -> str:
    if error_type == "missing":
        return "required"
    if error_type == "extra_forbidden":
        unknown_name = str(location[-1]) if len(location) > 0 else ""
        # A name another model uses (or one the schema dropped) isn't a typo, so it gets no suggestion.
        if unknown_name in ALL_FIELD_NAMES:
            return "not a field here (remove it, or check where it belongs)"
        matches = difflib.get_close_matches(unknown_name, ALL_FIELD_NAMES, n=1, cutoff=0.7)
        if len(matches) > 0:
            return f'unknown field. Did you mean "{matches[0]}"?'
        return "unknown field (check the spelling, or remove it)"
    if message.startswith("Value error, "):
        message = message[len("Value error, ") :]
    return message + describe_input(value)


def format_validation_error(label: str, error: ValidationError) -> list[str]:
    lines: list[str] = []
    for item in error.errors(include_url=False):
        location = item["loc"]
        base = join_path(label, format_location(location))
        if item["type"] == RULES_ERROR_TYPE:
            # Our own rule errors carry several (path, message) problems.
            for path, message in item["ctx"]["problems"]:
                lines.append(f"{join_path(base, path)}: {message}")
        else:
            description = describe_error(item["type"], item["msg"], location, item.get("input"))
            lines.append(f"{base}: {description}")
    return lines


# ---------------------------------------------------------------------------
# Loading JSON files


def record_label(collection: str, index: int, raw: object) -> str:
    if isinstance(raw, dict):
        record_id = raw.get("id")
        if isinstance(record_id, str) and record_id != "":
            return f"{collection}[{index}] ({record_id})"
    return f"{collection}[{index}]"


def read_json_file(path: Path, errors: list[str]) -> object | None:
    if not path.exists():
        errors.append(f"{path}: file not found")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as problem:
        errors.append(
            f"{path}: not valid JSON (line {problem.lineno}, column {problem.colno}: {problem.msg}). "
            "Look for a missing comma, a trailing comma or a missing quote near there."
        )
        return None


def load_records(
    path: Path, collection: str, model_class: type[BaseModel], errors: list[str]
) -> list[Record] | None:
    """Validates every record in a JSON file. Returns None if the file itself couldn't be read."""
    data = read_json_file(path, errors)
    if data is None:
        return None
    if not isinstance(data, list):
        errors.append(f"{path}: should be a list of records, starting with [ and ending with ]")
        return None

    records: list[Record] = []
    for index, raw in enumerate(data):
        label = record_label(collection, index, raw)
        try:
            model = model_class.model_validate(raw)
        except ValidationError as problem:
            errors.extend(format_validation_error(label, problem))
            model = None
        records.append(Record(label=label, raw=raw, model=model))
    return records


def raw_id(record: Record) -> str | None:
    """The record's id even when it failed validation, so one broken record
    doesn't cause a cascade of "not found" errors elsewhere."""
    if isinstance(record.raw, dict):
        value = record.raw.get("id")
        if isinstance(value, str):
            return value
    return None


SCORECARD_LABEL = "scorecard"


def load_scorecard(path: Path, errors: list[str]) -> ScorecardFile | None:
    """Reads scorecard.json, one object checked as a whole. Returns None (after
    adding the errors) when it can't be read or doesn't match the model."""
    data = read_json_file(path, errors)
    if data is None:
        return None
    if not isinstance(data, dict):
        errors.append(f"{path}: should be one object, starting with {{ and ending with }}")
        return None
    try:
        return ScorecardFile.model_validate(data)
    except ValidationError as problem:
        errors.extend(format_validation_error(SCORECARD_LABEL, problem))
        return None


# ---------------------------------------------------------------------------
# Cross-record rules


def check_unique_ids(records: list[Record], errors: list[str]) -> None:
    first_label_for_id: dict[str, str] = {}
    for record in records:
        record_id = raw_id(record)
        if record_id is None:
            continue
        if record_id in first_label_for_id:
            errors.append(f'{record.label}.id: "{record_id}" is already used by {first_label_for_id[record_id]}')
        else:
            first_label_for_id[record_id] = record.label


def check_unique_register_ids(records: list[Record], errors: list[str]) -> None:
    """Two sources can't share an evidence register id like "S02"."""
    first_label_for_register_id: dict[str, str] = {}
    for record in records:
        if not isinstance(record.model, Source) or record.model.register_id is None:
            continue
        register_id = record.model.register_id
        if register_id in first_label_for_register_id:
            errors.append(
                f'{record.label}.register_id: "{register_id}" is already used by '
                f"{first_label_for_register_id[register_id]}"
            )
        else:
            first_label_for_register_id[register_id] = record.label


def check_claim_sources(record: Record, known_source_ids: set[str], errors: list[str]) -> None:
    if record.model is None:
        return
    for path, claim in find_claims(record.model):
        for index, source_id in enumerate(claim.source_ids):
            if source_id not in known_source_ids:
                location = join_path(join_path(record.label, path), f"source_ids[{index}]")
                errors.append(f'{location}: no source with id "{source_id}" in sources.json')


def check_milestone_sources(milestone: Milestone, label: str, known_source_ids: set[str], errors: list[str]) -> None:
    for index, source_id in enumerate(milestone.source_ids):
        if source_id not in known_source_ids:
            errors.append(f'{label}.source_ids[{index}]: no source with id "{source_id}" in sources.json')
    for index, forecast in enumerate(milestone.forecasts):
        if forecast.source_id not in known_source_ids:
            errors.append(
                f'{label}.forecasts[{index}].source_id: no source with id "{forecast.source_id}" in sources.json'
            )


def check_source_references(report: Report, known_source_ids: set[str]) -> None:
    for record in report.milestones:
        check_claim_sources(record, known_source_ids, report.errors)
        if isinstance(record.model, Milestone):
            check_milestone_sources(record.model, record.label, known_source_ids, report.errors)
    for record in report.sources:
        check_claim_sources(record, known_source_ids, report.errors)
    for record in report.technologies:
        check_claim_sources(record, known_source_ids, report.errors)
        if isinstance(record.model, TechnologyPage):
            for path, source_id in page_source_ids(record.model):
                if source_id not in known_source_ids:
                    location = join_path(record.label, path)
                    report.errors.append(f'{location}: no source with id "{source_id}" in sources.json')


SAMPLE_SOURCE_HINT = "The public site leaves samples out, so a real record has to cite a real source"
SAMPLE_MILESTONE_HINT = "The public site leaves samples out, so a real milestone can only depend on real ones"


def sample_ids(records: list[Record]) -> set[str]:
    """Ids of the records marked "sample": true, read from the raw JSON."""
    ids: set[str] = set()
    for record in records:
        record_id = raw_id(record)
        if record_id is not None and isinstance(record.raw, dict) and record.raw.get("sample") is True:
            ids.add(record_id)
    return ids


def sample_source_problems(record_model: BaseModel, sample_source_ids: set[str], prefix: str) -> list[str]:
    """Every claim in a real record that cites a sample source."""
    problems = []
    for path, claim in find_claims(record_model):
        for index, source_id in enumerate(claim.source_ids):
            if source_id in sample_source_ids:
                location = join_path(join_path(prefix, path), f"source_ids[{index}]")
                problems.append(f'{location}: "{source_id}" is a sample source. {SAMPLE_SOURCE_HINT}')
    return problems


def sample_link_problems(
    milestone: Milestone, sample_source_ids: set[str], sample_milestone_ids: set[str], prefix: str
) -> list[str]:
    """A real milestone can't cite a sample source or depend on a sample
    milestone: readers would get a link to something the site doesn't show.
    Samples can link to anything. The API runs this on every milestone save."""
    if milestone.sample:
        return []
    problems = []
    for index, dependency in enumerate(milestone.depends_on):
        if dependency in sample_milestone_ids:
            location = join_path(prefix, f"depends_on[{index}]")
            problems.append(f'{location}: "{dependency}" is a sample milestone. {SAMPLE_MILESTONE_HINT}')
    for index, source_id in enumerate(milestone.source_ids):
        if source_id in sample_source_ids:
            location = join_path(prefix, f"source_ids[{index}]")
            problems.append(f'{location}: "{source_id}" is a sample source. {SAMPLE_SOURCE_HINT}')
    for index, forecast in enumerate(milestone.forecasts):
        if forecast.source_id in sample_source_ids:
            location = join_path(prefix, f"forecasts[{index}].source_id")
            problems.append(f'{location}: "{forecast.source_id}" is a sample source. {SAMPLE_SOURCE_HINT}')
    problems.extend(sample_source_problems(milestone, sample_source_ids, prefix))
    return problems


def check_sample_links(report: Report) -> None:
    sample_source_ids = sample_ids(report.sources)
    sample_milestone_ids = sample_ids(report.milestones)
    for record in report.milestones:
        if isinstance(record.model, Milestone):
            report.errors.extend(
                sample_link_problems(record.model, sample_source_ids, sample_milestone_ids, record.label)
            )
    # Every page, including one with unreviewed AI sections: its ratings are the team's.
    for record in report.technologies:
        if isinstance(record.model, TechnologyPage):
            report.errors.extend(sample_source_problems(record.model, sample_source_ids, record.label))
            report.errors.extend(page_sample_source_problems(record.model, record.label, sample_source_ids))


def check_dependencies(records: list[Record], errors: list[str]) -> None:
    known_ids: set[str] = set()
    for record in records:
        record_id = raw_id(record)
        if record_id is not None:
            known_ids.add(record_id)

    # Graph of valid edges only, so the cycle search doesn't repeat the
    # "doesn't exist" and "depends on itself" errors reported here.
    graph: dict[str, list[str]] = {}
    for record in records:
        milestone = record.model
        if not isinstance(milestone, Milestone):
            continue
        edges: list[str] = []
        for index, dependency in enumerate(milestone.depends_on):
            location = f"{record.label}.depends_on[{index}]"
            if dependency == milestone.id:
                errors.append(f"{location}: a milestone can't depend on itself")
            elif dependency not in known_ids:
                errors.append(f'{location}: no milestone with id "{dependency}" in milestones.json')
            else:
                edges.append(dependency)
        graph[milestone.id] = edges

    for cycle in find_cycles(graph):
        errors.append(f"milestones: dependency cycle: {' -> '.join(cycle)}. Remove one of these depends_on links")


def find_cycles(graph: dict[str, list[str]]) -> list[list[str]]:
    """Depth-first search. Returns each cycle once, e.g. ["a", "b", "a"]."""
    not_visited, in_progress, done = 0, 1, 2
    state: dict[str, int] = {}
    for node in graph:
        state[node] = not_visited

    cycles: list[list[str]] = []
    stack: list[str] = []

    def visit(node: str) -> None:
        state[node] = in_progress
        stack.append(node)
        for neighbor in graph.get(node, []):
            neighbor_state = state.get(neighbor, done)
            if neighbor_state == in_progress:
                start = stack.index(neighbor)
                cycles.append(stack[start:] + [neighbor])
            elif neighbor_state == not_visited:
                visit(neighbor)
        stack.pop()
        state[node] = done

    for node in graph:
        if state[node] == not_visited:
            visit(node)
    return cycles


def check_technology_pages(records: list[Record], path: Path, errors: list[str]) -> None:
    present: set[str] = set()
    for record in records:
        record_id = raw_id(record)
        if record_id is not None:
            present.add(record_id)
    for tech_id in TECHNOLOGY_PAGE_IDS:
        if tech_id not in present:
            errors.append(
                f'{path}: no page with id "{tech_id}" (the site has a page for each of wbe, bci, neuromorphic)'
            )


def check_matching_scorecards(records: list[Record], errors: list[str]) -> None:
    """Every page has the same scorecard rows as the first page: the same ids, in
    the same order, each with the same dimension, scale and problem. The compare
    page lines the pages up by row id.

    The first page that passed its model check is the reference. Pages that
    failed are skipped, so one broken page doesn't cause a cascade of errors.
    """
    pages: list[tuple[str, TechnologyPage]] = []
    for record in records:
        if isinstance(record.model, TechnologyPage):
            pages.append((record.label, record.model))
    if len(pages) == 0:
        return

    reference_label, reference_page = pages[0]
    reference_ids: list[str] = []
    reference_rows: dict[str, ScorecardRow] = {}
    for row in reference_page.scorecard:
        reference_ids.append(row.id)
        reference_rows[row.id] = row
    same_rows_hint = f"Every page needs the same scorecard rows as {reference_label}, in the same order"

    for label, page in pages[1:]:
        page_ids: list[str] = []
        for row in page.scorecard:
            page_ids.append(row.id)

        for reference_id in reference_ids:
            if reference_id not in page_ids:
                errors.append(f'{label}.scorecard: no row with id "{reference_id}". {same_rows_hint}')

        for index, row in enumerate(page.scorecard):
            if row.id not in reference_rows:
                errors.append(
                    f'{label}.scorecard[{index}].id: "{row.id}" isn\'t on {reference_label}. {same_rows_hint}'
                )
                continue
            reference_row = reference_rows[row.id]
            for field_name in ("dimension", "scale", "problem"):
                value = getattr(row, field_name)
                reference_value = getattr(reference_row, field_name)
                if value != reference_value:
                    errors.append(
                        f"{label}.scorecard[{index}].{field_name}: {quoted_or_null(value)} differs from "
                        f"{reference_label}, which has {quoted_or_null(reference_value)}. A row means the same "
                        "thing on every page, so change it on all of them at once"
                    )

        # Compare only the rows both pages have, so a missing row isn't also reported as a reordering.
        shared_in_page_order: list[str] = []
        for row_id in page_ids:
            if row_id in reference_rows:
                shared_in_page_order.append(row_id)
        shared_in_reference_order: list[str] = []
        for row_id in reference_ids:
            if row_id in page_ids:
                shared_in_reference_order.append(row_id)
        if shared_in_page_order != shared_in_reference_order:
            errors.append(
                f"{label}.scorecard: the rows are in a different order from {reference_label}. "
                f"Use: {', '.join(reference_ids)}"
            )


def check_scorecard_milestones(report: Report) -> None:
    """A scorecard row's milestone_ids must be real milestones of this page's
    technology. Samples are refused on every page, since the public site leaves
    them out. Works from the raw milestones, so a milestone that failed its own
    check isn't also reported missing here."""
    technology_of: dict[str, object] = {}
    for record in report.milestones:
        milestone_id = raw_id(record)
        if milestone_id is not None and isinstance(record.raw, dict):
            technology_of[milestone_id] = record.raw.get("technology")
    sample_milestone_ids = sample_ids(report.milestones)

    for record in report.technologies:
        page = record.model
        if not isinstance(page, TechnologyPage):
            continue
        for row_index, row in enumerate(page.scorecard):
            if row.tracker is None:
                continue
            for link_index, milestone_id in enumerate(row.tracker.milestone_ids):
                location = f"{record.label}.scorecard[{row_index}].tracker.milestone_ids[{link_index}]"
                if milestone_id not in technology_of:
                    report.errors.append(f'{location}: no milestone with id "{milestone_id}" in milestones.json')
                    continue
                technology = technology_of[milestone_id]
                if isinstance(technology, str) and technology != page.id:
                    report.errors.append(
                        f'{location}: "{milestone_id}" is a {technology} milestone, and this is the {page.id} page'
                    )
                if milestone_id in sample_milestone_ids:
                    report.errors.append(
                        f'{location}: "{milestone_id}" is a sample milestone. The public site leaves samples out, '
                        "so a scorecard row can only link to real milestones"
                    )


# ---------------------------------------------------------------------------
# The workbook's codes (scorecard.json and what refers to it)


def page_source_ids(page: TechnologyPage) -> list[tuple[str, str]]:
    """(path, source id) for every source id a page lists outside its Claims."""
    found: list[tuple[str, str]] = []
    if page.scope is not None:
        for index, source_id in enumerate(page.scope.source_ids):
            found.append((f"scope.source_ids[{index}]", source_id))
    for stage_index, stage in enumerate(page.artificial_minds_by_stage):
        for index, source_id in enumerate(stage.source_ids):
            found.append((f"artificial_minds_by_stage[{stage_index}].source_ids[{index}]", source_id))
    return found


def page_sample_source_problems(page: TechnologyPage, label: str, sample_source_ids: set[str]) -> list[str]:
    """Source ids outside the page's Claims that name a sample source."""
    problems: list[str] = []
    for path, source_id in page_source_ids(page):
        if source_id in sample_source_ids:
            problems.append(f'{join_path(label, path)}: "{source_id}" is a sample source. {SAMPLE_SOURCE_HINT}')
    return problems


def page_entry_ids(page: TechnologyPage) -> list[tuple[str, str]]:
    """(path, entry id) for every evidence entry a technology page names."""
    found: list[tuple[str, str]] = []
    if page.alignment_assessment is not None:
        for scenario_index, scenario in enumerate(page.alignment_assessment.scenarios):
            base = f"alignment_assessment.scenarios[{scenario_index}]"
            for index, entry_id in enumerate(scenario.supporting):
                found.append((f"{base}.supporting[{index}]", entry_id))
            for index, entry_id in enumerate(scenario.contrary_or_qualifying):
                found.append((f"{base}.contrary_or_qualifying[{index}]", entry_id))
    if page.intelligence_curse_assessment is not None:
        for row_index, row in enumerate(page.intelligence_curse_assessment.agency):
            for index, entry_id in enumerate(row.entries):
                found.append((f"intelligence_curse_assessment.agency[{row_index}].entries[{index}]", entry_id))
    for stage_index, stage in enumerate(page.artificial_minds_by_stage):
        for index, entry_id in enumerate(stage.entries):
            found.append((f"artificial_minds_by_stage[{stage_index}].entries[{index}]", entry_id))
    return found


def report_repeated_ids(items: list[tuple[str, str]], errors: list[str]) -> None:
    """Reports every (label, id) whose id an earlier item already used."""
    first_label_for_id: dict[str, str] = {}
    for label, item_id in items:
        if item_id in first_label_for_id:
            errors.append(f'{label}.id: "{item_id}" is already used by {first_label_for_id[item_id]}')
        else:
            first_label_for_id[item_id] = label


def check_scorecard_ids(scorecard: ScorecardFile, errors: list[str]) -> None:
    """Every entry, link, risk, checklist item, framework and milestone category has its own id."""
    collections: list[tuple[str, list]] = [
        ("entries", scorecard.entries),
        ("links", scorecard.links),
        ("risks", scorecard.risks),
        ("governance", scorecard.governance),
        ("frameworks", scorecard.frameworks),
        ("milestone_categories", scorecard.milestone_categories),
    ]
    for name, items in collections:
        labelled: list[tuple[str, str]] = []
        for index, item in enumerate(items):
            labelled.append((f"{SCORECARD_LABEL}.{name}[{index}] ({item.id})", item.id))
        report_repeated_ids(labelled, errors)

    # A milestone row is named by its family and code, and BCI M1 and NM M1
    # have two rows each, told apart by what they apply to.
    first_label_for_row: dict[tuple[str, str, str], str] = {}
    for index, row in enumerate(scorecard.milestone_assessments):
        key = (row.family, row.milestone, row.applies_to)
        label = f"{SCORECARD_LABEL}.milestone_assessments[{index}] ({row.family} {row.milestone})"
        if key in first_label_for_row:
            errors.append(
                f'{label}: {row.family} {row.milestone} applying to "{row.applies_to}" is already '
                f"{first_label_for_row[key]}"
            )
        else:
            first_label_for_row[key] = label


def check_scorecard_milestone_rows(scorecard: ScorecardFile, errors: list[str]) -> None:
    """Each milestone row names a category header that exists, with the same category."""
    category_of: dict[str, str] = {}
    for info in scorecard.milestone_categories:
        category_of[info.id] = info.category
    for index, row in enumerate(scorecard.milestone_assessments):
        label = f"{SCORECARD_LABEL}.milestone_assessments[{index}] ({row.family} {row.milestone})"
        if row.milestone not in category_of:
            errors.append(f'{label}.milestone: no milestone category with id "{row.milestone}" in milestone_categories')
        elif category_of[row.milestone] != row.category:
            errors.append(
                f'{label}.category: "{row.category}" differs from milestone_categories {row.milestone} '
                f'("{category_of[row.milestone]}")'
            )


def check_entry_list(entry_ids: list[str], location: str, known_entry_ids: set[str], errors: list[str]) -> None:
    for index, entry_id in enumerate(entry_ids):
        if entry_id not in known_entry_ids:
            errors.append(f'{location}[{index}]: no evidence entry with id "{entry_id}" in scorecard.json')


def check_scorecard_references(scorecard: ScorecardFile, errors: list[str]) -> None:
    """Every id scorecard.json names inside itself exists there."""
    entry_ids: set[str] = set()
    for entry in scorecard.entries:
        entry_ids.add(entry.id)
    link_ids: set[str] = set()
    for link in scorecard.links:
        link_ids.add(link.id)
    risk_ids: set[str] = set()
    for risk in scorecard.risks:
        risk_ids.add(risk.id)
    governance_ids: set[str] = set()
    for item in scorecard.governance:
        governance_ids.add(item.id)
    milestone_rows: set[tuple[str, str]] = set()
    for row in scorecard.milestone_assessments:
        milestone_rows.add((row.family, row.milestone))

    for index, row in enumerate(scorecard.milestone_assessments):
        label = f"{SCORECARD_LABEL}.milestone_assessments[{index}] ({row.family} {row.milestone})"
        check_entry_list(row.evidence_entries, f"{label}.evidence_entries", entry_ids, errors)
    for index, link in enumerate(scorecard.links):
        label = f"{SCORECARD_LABEL}.links[{index}] ({link.id})"
        check_entry_list(link.supporting, f"{label}.supporting", entry_ids, errors)
        check_entry_list(link.contrary, f"{label}.contrary", entry_ids, errors)
        check_entry_list(link.qualifying, f"{label}.qualifying", entry_ids, errors)
    for index, risk in enumerate(scorecard.risks):
        check_entry_list(risk.entries, f"{SCORECARD_LABEL}.risks[{index}] ({risk.id}).entries", entry_ids, errors)
    for index, item in enumerate(scorecard.governance):
        check_entry_list(item.entries, f"{SCORECARD_LABEL}.governance[{index}] ({item.id}).entries", entry_ids, errors)

    for index, entry in enumerate(scorecard.entries):
        label = f"{SCORECARD_LABEL}.entries[{index}] ({entry.id})"
        # Column E also holds words that aren't ids ("AM", "Intelligence Curse comparator").
        # Only the tokens shaped like an id are checked; the rest stay plain text.
        for code_index, code in enumerate(entry.codes):
            location = f"{label}.codes[{code_index}]"
            milestone_match = FAMILY_MILESTONE_PATTERN.fullmatch(code)
            if LINK_ID_PATTERN.fullmatch(code) and code not in link_ids:
                errors.append(f'{location}: no causal link with id "{code}" in scorecard.json')
            elif RISK_ID_PATTERN.fullmatch(code) and code not in risk_ids:
                errors.append(f'{location}: no risk with id "{code}" in scorecard.json')
            elif GOVERNANCE_ID_PATTERN.fullmatch(code) and code not in governance_ids:
                errors.append(f'{location}: no governance checklist item with id "{code}" in scorecard.json')
            elif milestone_match is not None:
                family = FAMILY_BY_PREFIX[milestone_match.group("prefix")]
                if (family, milestone_match.group("milestone")) not in milestone_rows:
                    errors.append(f'{location}: no {family} milestone row "{milestone_match.group("milestone")}" in scorecard.json')
        for feed_index, feed in enumerate(entry.feeds):
            if feed.target.startswith("M") and (feed.family, feed.target) not in milestone_rows:
                errors.append(
                    f'{label}.feeds[{feed_index}].target: no {feed.family} milestone row "{feed.target}" in scorecard.json'
                )


def check_entry_sources(report: Report, sources: list[Record]) -> None:
    """Each evidence entry cites a real source in sources.json, under its register id."""
    if report.scorecard is None:
        return
    register_id_of: dict[str, str | None] = {}
    for record in sources:
        source_id = raw_id(record)
        if source_id is None:
            continue
        register_id = record.raw.get("register_id") if isinstance(record.raw, dict) else None
        register_id_of[source_id] = register_id if isinstance(register_id, str) else None
    sample_source_ids = sample_ids(sources)

    for index, entry in enumerate(report.scorecard.entries):
        location = f"{SCORECARD_LABEL}.entries[{index}] ({entry.id})"
        if entry.source_id not in register_id_of:
            report.errors.append(f'{location}.source_id: no source with id "{entry.source_id}" in sources.json')
            continue
        if entry.source_id in sample_source_ids:
            report.errors.append(f'{location}.source_id: "{entry.source_id}" is a sample source. {SAMPLE_SOURCE_HINT}')
        if register_id_of[entry.source_id] != entry.register_id:
            report.errors.append(
                f'{location}.register_id: "{entry.register_id}", but source "{entry.source_id}" has register id '
                f"{quoted_or_null(register_id_of[entry.source_id])} in sources.json"
            )

    if report.scorecard.cross_family_scope is not None:
        for index, source_id in enumerate(report.scorecard.cross_family_scope.source_ids):
            if source_id not in register_id_of:
                report.errors.append(
                    f'{SCORECARD_LABEL}.cross_family_scope.source_ids[{index}]: no source with id "{source_id}" '
                    "in sources.json"
                )


def check_entry_references(report: Report) -> None:
    """Milestones and technology pages name evidence entries that exist in scorecard.json."""
    if report.scorecard is None:
        return
    entry_ids: set[str] = set()
    for entry in report.scorecard.entries:
        entry_ids.add(entry.id)
    for record in report.milestones:
        if isinstance(record.model, Milestone):
            check_entry_list(record.model.evidence_entries, f"{record.label}.evidence_entries", entry_ids, report.errors)
    for record in report.technologies:
        if not isinstance(record.model, TechnologyPage):
            continue
        for path, entry_id in page_entry_ids(record.model):
            if entry_id not in entry_ids:
                report.errors.append(
                    f'{join_path(record.label, path)}: no evidence entry with id "{entry_id}" in scorecard.json'
                )


# One day of slack, so a date written in a time zone ahead of the checker's isn't refused.
FUTURE_DATE_SLACK = timedelta(days=1)


def check_tracker_dates(report: Report, today: date) -> None:
    """A history date or last_updated after tomorrow is almost always a typo in the year."""
    latest_allowed = today + FUTURE_DATE_SLACK
    for record in report.technologies:
        page = record.model
        if not isinstance(page, TechnologyPage):
            continue
        for row_index, row in enumerate(page.scorecard):
            if row.tracker is None:
                continue
            dated: list[tuple[str, str]] = []
            for change_index, change in enumerate(row.tracker.history):
                dated.append((f"history[{change_index}].date", change.date))
            if row.tracker.last_updated is not None:
                dated.append(("last_updated", row.tracker.last_updated))
            for path, value in dated:
                if date.fromisoformat(value) > latest_allowed:
                    location = f"{record.label}.scorecard[{row_index}].tracker.{path}"
                    report.errors.append(f"{location}: {value} is in the future. Check the year")


# ---------------------------------------------------------------------------
# Warnings


def skips_ai_review(model: BaseModel) -> bool:
    """Samples, and technology pages with unreviewed AI sections, may hold AI claims nobody has checked."""
    if isinstance(model, TechnologyPage):
        return model.unreviewed_ai_sections
    if isinstance(model, (Milestone, Source)):
        return model.sample
    return False


def count_unreviewed_sample_claims(records: list[Record]) -> int:
    """AI claims with no reviewer in records that may skip review (see
    skips_ai_review). The models let them through, so this is the only place
    they get counted."""
    count = 0
    for record in records:
        model = record.model
        if model is None or not skips_ai_review(model):
            continue
        for _path, claim in find_claims(model):
            if claim.provenance == Provenance.AI and is_blank(claim.reviewed_by):
                count += 1
    return count


def check_unreviewed_sample_claims(report: Report) -> None:
    count = 0
    count += count_unreviewed_sample_claims(report.milestones)
    count += count_unreviewed_sample_claims(report.sources)
    count += count_unreviewed_sample_claims(report.technologies)
    if count == 0:
        return
    if count == 1:
        report.warnings.append(
            "Warning: 1 AI-suggested claim in a sample record or a page with unreviewed AI sections has no "
            "reviewer. The site shows it as unchecked, and it must be reviewed before the flag comes off."
        )
    else:
        report.warnings.append(
            f"Warning: {count} AI-suggested claims in sample records or pages with unreviewed AI sections have no "
            "reviewer. The site shows them as unchecked, and they must be reviewed before the flag comes off."
        )


def check_placeholder_trackers(report: Report) -> None:
    """Scorecard rows whose tracker is an example the team hasn't checked. The
    site marks them, so this is only a reminder that the flag is still on."""
    locations: list[str] = []
    for record in report.technologies:
        page = record.model
        if not isinstance(page, TechnologyPage):
            continue
        for index, row in enumerate(page.scorecard):
            if row.tracker is not None and row.tracker.placeholder:
                locations.append(f"{record.label}.scorecard[{index}] ({row.id})")
    if len(locations) == 0:
        return
    if len(locations) == 1:
        report.warnings.append(
            f"Warning: 1 scorecard row has a placeholder tracker: {locations[0]}. "
            "The site labels it as a placeholder until the flag comes off."
        )
    else:
        report.warnings.append(
            f"Warning: {len(locations)} scorecard rows have placeholder trackers: {', '.join(locations)}. "
            "The site labels them as placeholders until the flag comes off."
        )


# ---------------------------------------------------------------------------
# Blog posts


# Posts are read with gray-matter at build time, which parses the frontmatter
# as YAML. Reading it with a real YAML parser here means the validator sees
# the same values the site will: an unquoted 2026-10-26 becomes a date, a
# value starting with # becomes nothing, and "a: b" can't be read at all.


class RepeatedKeyError(yaml.constructor.ConstructorError):
    pass


class FrontmatterLoader(yaml.SafeLoader):
    """yaml.safe_load, except a key that appears twice is an error (as it is
    for gray-matter) instead of the last one silently winning."""


def construct_mapping_without_repeats(loader: FrontmatterLoader, node: yaml.MappingNode) -> dict:
    seen_keys: list[object] = []
    for key_node, _value_node in node.value:
        key = loader.construct_object(key_node)
        if key in seen_keys:
            raise RepeatedKeyError(None, None, f'"{key}" appears twice', key_node.start_mark)
        seen_keys.append(key)
    return loader.construct_mapping(node)


FrontmatterLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_mapping_without_repeats)


@dataclass
class Frontmatter:
    values: dict[str, object]  # passed to PostFrontmatter as is
    skipped_keys: list[str]  # fields left out because their value wasn't text (already reported)
    body: str


def describe_unreadable_line(line: str) -> str:
    """What to do about a frontmatter line the YAML parser couldn't read."""
    key, separator, _rest = line.partition(":")
    key = key.strip()
    if separator == "" or key == "" or " " in key:
        return f'expected "key: value", got "{line.strip()}"'
    return f'put the value of "{key}" in double quotes, like {key}: "..."'


def describe_non_text_value(key: str, value: object) -> str:
    """Every post field is text. Say what YAML read instead, and how to fix it."""
    if value is None:
        return (
            f"{key}: has no value. Write one after the colon, and put it in double quotes "
            "if it starts with # (otherwise it counts as a comment)"
        )
    if isinstance(value, date) and not isinstance(value, datetime):
        # The common one: an unquoted date like 2026-10-26.
        return f'{key}: put the value in double quotes, like {key}: "{value.isoformat()}"'

    if isinstance(value, datetime):
        what = "a timestamp"
    elif isinstance(value, bool):
        what = "true or false"
    elif isinstance(value, (int, float)):
        what = "a number"
    elif isinstance(value, list):
        what = "a list"
    else:
        what = "a nested block"
    return f'{key}: put the value in double quotes, like {key}: "...". Without quotes it reads as {what}, not text'


def parse_frontmatter(text: str, label: str, errors: list[str]) -> Frontmatter | None:
    """Reads the key: value block between --- lines at the top of a post.

    Returns None (after adding an error) when the block can't be read at all.
    """
    lines = text.splitlines()
    if len(lines) == 0 or lines[0].strip() != "---":
        errors.append(f"{label}: must start with a --- line, then title, slug, date, author and summary, then ---")
        return None

    closing_line = -1
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            closing_line = index
            break
    if closing_line == -1:
        errors.append(f"{label}: the frontmatter is never closed. Add a --- line after the summary")
        return None

    block_lines = lines[1:closing_line]
    try:
        data = yaml.load("\n".join(block_lines), Loader=FrontmatterLoader)
    except yaml.MarkedYAMLError as problem:
        # The problem mark is where the parser gave up. A line with no colon
        # is only noticed on the next line, so use the context mark for that.
        mark = problem.problem_mark
        if problem.context == "while scanning a simple key" and problem.context_mark is not None:
            mark = problem.context_mark
        if mark is None or mark.line >= len(block_lines):
            errors.append(f"{label}: the frontmatter can't be read ({problem.problem}). Check the quotes and colons")
            return None
        line_number = mark.line + 2  # the block starts on line 2 of the file
        if isinstance(problem, RepeatedKeyError):
            errors.append(f"{label} line {line_number}: {problem.problem}")
        else:
            errors.append(f"{label} line {line_number}: {describe_unreadable_line(block_lines[mark.line])}")
        return None
    except yaml.YAMLError as problem:
        errors.append(f"{label}: the frontmatter can't be read ({problem}). Check the quotes and colons")
        return None

    if data is None:
        data = {}
    if not isinstance(data, dict):
        errors.append(f'{label}: the frontmatter should be "key: value" lines (title, slug, date, author and summary)')
        return None

    values: dict[str, object] = {}
    skipped_keys: list[str] = []
    for key, value in data.items():
        key_text = str(key)
        if key_text in PostFrontmatter.model_fields and not isinstance(value, str):
            errors.append(f"{label}: {describe_non_text_value(key_text, value)}")
            skipped_keys.append(key_text)
        else:
            values[key_text] = value

    body = "\n".join(lines[closing_line + 1 :])
    return Frontmatter(values=values, skipped_keys=skipped_keys, body=body)


def load_posts(posts_dir: Path, report: Report) -> None:
    if not posts_dir.is_dir():
        report.errors.append(f"{posts_dir}/: folder not found. The blog needs at least one post in it")
        return

    post_files = sorted(posts_dir.glob("*.md"))
    if len(post_files) == 0:
        report.errors.append(f"{posts_dir}/: no posts found. The blog needs at least one .md post to build")
        return

    for post_file in post_files:
        label = str(post_file)
        parsed = parse_frontmatter(post_file.read_text(encoding="utf-8"), label, report.errors)
        if parsed is None:
            continue

        if parsed.body.strip() == "":
            report.errors.append(f"{label}: the post has no text after the frontmatter")

        # Values that weren't text were reported and left out above, so don't
        # also call them missing.
        already_reported: list[str] = []
        for key in parsed.skipped_keys:
            already_reported.append(f"{label}.{key}: required")

        try:
            frontmatter = PostFrontmatter.model_validate(parsed.values)
        except ValidationError as problem:
            for line in format_validation_error(label, problem):
                if line not in already_reported:
                    report.errors.append(line)
            continue
        if len(parsed.skipped_keys) > 0:
            continue
        report.posts.append(Post(label=label, frontmatter=frontmatter))

    first_label_for_slug: dict[str, str] = {}
    for post in report.posts:
        slug = post.frontmatter.slug
        if slug in first_label_for_slug:
            report.errors.append(f'{post.label}: slug "{slug}" is already used by {first_label_for_slug[slug]}')
        else:
            first_label_for_slug[slug] = post.label


# ---------------------------------------------------------------------------
# Em dashes


EM_DASH_FIX = "Use a period, comma, colon or parentheses instead"
EN_DASH_FIX = "Use a hyphen for a range, or a comma, colon or parentheses instead"


def has_em_dash(text: str) -> bool:
    """True for the character itself or its JSON escape."""
    return EM_DASH in text or "\\u2014" in text.lower()


def has_en_dash(text: str) -> bool:
    """True for the character itself, its JSON escape or its HTML entity."""
    return EN_DASH in text or "\\u2013" in text.lower() or "&ndash;" in text.lower()


def en_dash_line_numbers(text: str) -> list[int]:
    """The line numbers (from 1) of the lines with an en dash."""
    numbers: list[int] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if has_en_dash(line):
            numbers.append(line_number)
    return numbers


def em_dash_line_numbers(text: str) -> list[int]:
    """The line numbers (from 1) of the lines with an em dash."""
    numbers: list[int] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if has_em_dash(line):
            numbers.append(line_number)
    return numbers


def em_dash_paths(value: object, path: str = "") -> list[str]:
    """The path of every string with an em dash inside a dict or list, like "summary.text".

    The API checks milestones with this when they're saved, so an edit in
    admin follows the same rule as a file in content/.
    """
    found: list[str] = []
    if isinstance(value, str):
        if has_em_dash(value):
            found.append(path)
    elif isinstance(value, dict):
        for key, item in value.items():
            found.extend(em_dash_paths(item, join_path(path, str(key))))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(em_dash_paths(item, join_path(path, f"[{index}]")))
    return found


def check_em_dashes(content_dir: Path, errors: list[str]) -> None:
    """Site copy never uses em dashes or en dashes. Catches the characters and their escapes."""
    files = sorted(list(content_dir.rglob("*.json")) + list(content_dir.rglob("*.md")))
    for path in files:
        text = path.read_text(encoding="utf-8")
        for line_number in em_dash_line_numbers(text):
            errors.append(f"{path} line {line_number}: has an em dash. {EM_DASH_FIX}")
        for line_number in en_dash_line_numbers(text):
            errors.append(f"{path} line {line_number}: has an en dash. {EN_DASH_FIX}")


# ---------------------------------------------------------------------------
# Putting it together


def validate_content(content_dir: Path, today: date | None = None) -> Report:
    """Check a content folder. `today` is for tests; it defaults to the real date."""
    if today is None:
        today = date.today()
    report = Report()

    # Deploys run this check but not export_schema --check, so the type grouping is guarded here too.
    for problem in milestone_type_problems():
        report.errors.append(f"shared/sf_shared/enums.py: {problem}")

    milestones = load_records(content_dir / "milestones.json", "milestones", Milestone, report.errors)
    sources = load_records(content_dir / "sources.json", "sources", Source, report.errors)
    technologies_path = content_dir / "technologies.json"
    technologies = load_records(technologies_path, "technologies", TechnologyPage, report.errors)
    report.milestones = milestones if milestones is not None else []
    report.sources = sources if sources is not None else []
    report.technologies = technologies if technologies is not None else []
    report.scorecard = load_scorecard(content_dir / "scorecard.json", report.errors)
    load_posts(content_dir / "posts", report)

    check_unique_ids(report.milestones, report.errors)
    check_unique_ids(report.sources, report.errors)
    check_unique_register_ids(report.sources, report.errors)
    check_unique_ids(report.technologies, report.errors)

    # If sources.json couldn't be read, every reference would look broken, and
    # that's already been reported once.
    if sources is not None:
        known_source_ids: set[str] = set()
        for record in report.sources:
            source_id = raw_id(record)
            if source_id is not None:
                known_source_ids.add(source_id)
        check_source_references(report, known_source_ids)
        check_sample_links(report)

    # If scorecard.json couldn't be read, its problems are already reported,
    # and every entry id would look missing.
    if report.scorecard is not None:
        check_scorecard_ids(report.scorecard, report.errors)
        check_scorecard_milestone_rows(report.scorecard, report.errors)
        check_scorecard_references(report.scorecard, report.errors)
        if sources is not None:
            check_entry_sources(report, report.sources)
        check_entry_references(report)

    check_dependencies(report.milestones, report.errors)
    if technologies is not None:
        check_technology_pages(report.technologies, technologies_path, report.errors)
        check_matching_scorecards(report.technologies, report.errors)
        check_tracker_dates(report, today)
    # If milestones.json couldn't be read, every link would look broken.
    if milestones is not None:
        check_scorecard_milestones(report)
    check_em_dashes(content_dir, report.errors)
    check_unreviewed_sample_claims(report)
    check_placeholder_trackers(report)
    return report


def plural(count: int, singular: str, plural_form: str) -> str:
    return f"{count} {singular if count == 1 else plural_form}"


def main(argv: list[str]) -> int:
    content_dir = Path(argv[1]) if len(argv) > 1 else Path("content")
    if not content_dir.is_dir():
        print(f"{content_dir}: folder not found")
        return 1

    report = validate_content(content_dir)
    if not report.ok:
        for line in report.errors:
            print(line)
        print()
        for line in report.warnings:
            print(line)
        print(f"FAILED: {plural(len(report.errors), 'problem', 'problems')} in {content_dir}")
        return 1

    for line in report.warnings:
        print(line)
    counts = [
        plural(len(report.milestones), "milestone", "milestones"),
        plural(len(report.sources), "source", "sources"),
        plural(len(report.technologies), "technology", "technologies"),
        plural(len(report.posts), "post", "posts"),
        plural(len(report.scorecard.entries) if report.scorecard is not None else 0, "evidence entry", "evidence entries"),
    ]
    print("OK: " + ", ".join(counts))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
