"""Check everything in content/ before it reaches the site.

Run: python -m sf_shared.validate content/

Prints "OK: ..." with counts, or every problem it found (it never stops at the
first one) and exits with status 1. Each problem names where it is, e.g.
    milestones[3] (wbe-sample-human-emulation).forecasts[0].quote: required ...

What it checks:
  1. Each file parses and each record matches its model in models.py.
  2. Cross-record rules: unique ids, every source id exists, every
     depends_on exists, no dependency cycles, and nothing real links to a
     sample (the public site leaves samples out).
  3. Blog posts: valid frontmatter, unique slugs, at least one post.
  4. No em dashes (U+2014) in any content file.

It also prints warnings, which don't fail the check: right now, a count of the
AI-suggested claims in sample records that nobody has reviewed yet.
"""

import difflib
import json
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

import yaml
from pydantic import BaseModel, ValidationError

from sf_shared.claims import RULES_ERROR_TYPE, find_claims, is_blank, join_path
from sf_shared.enums import Provenance
from sf_shared.models import ALL_MODELS, Milestone, PostFrontmatter, Source, TechnologyPage

TECHNOLOGY_PAGE_IDS = ["wbe", "bci", "neuromorphic"]
EM_DASH = "\u2014"


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
    for record in report.technologies:
        if isinstance(record.model, TechnologyPage) and not record.model.sample:
            report.errors.extend(sample_source_problems(record.model, sample_source_ids, record.label))


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


# ---------------------------------------------------------------------------
# Warnings


def count_unreviewed_sample_claims(records: list[Record]) -> int:
    """AI claims with no reviewer in sample records. The models let samples
    skip review, so this is the only place they get counted."""
    count = 0
    for record in records:
        model = record.model
        if model is None or not getattr(model, "sample", False):
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
            "Warning: 1 AI-suggested claim in a sample record has no reviewer. The site shows it as unchecked, "
            "and it must be reviewed before the sample flag comes off."
        )
    else:
        report.warnings.append(
            f"Warning: {count} AI-suggested claims in sample records have no reviewer. The site shows them as "
            "unchecked, and they must be reviewed before the sample flag comes off."
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


def has_em_dash(text: str) -> bool:
    """True for the character itself or its JSON escape."""
    return EM_DASH in text or "\\u2014" in text.lower()


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
    """Site copy never uses em dashes. Catches the character and its JSON escape."""
    files = sorted(list(content_dir.rglob("*.json")) + list(content_dir.rglob("*.md")))
    for path in files:
        for line_number in em_dash_line_numbers(path.read_text(encoding="utf-8")):
            errors.append(f"{path} line {line_number}: has an em dash. {EM_DASH_FIX}")


# ---------------------------------------------------------------------------
# Putting it together


def validate_content(content_dir: Path) -> Report:
    report = Report()

    milestones = load_records(content_dir / "milestones.json", "milestones", Milestone, report.errors)
    sources = load_records(content_dir / "sources.json", "sources", Source, report.errors)
    technologies_path = content_dir / "technologies.json"
    technologies = load_records(technologies_path, "technologies", TechnologyPage, report.errors)
    report.milestones = milestones if milestones is not None else []
    report.sources = sources if sources is not None else []
    report.technologies = technologies if technologies is not None else []
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

    check_dependencies(report.milestones, report.errors)
    if technologies is not None:
        check_technology_pages(report.technologies, technologies_path, report.errors)
    check_em_dashes(content_dir, report.errors)
    check_unreviewed_sample_claims(report)
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
    ]
    print("OK: " + ", ".join(counts))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
