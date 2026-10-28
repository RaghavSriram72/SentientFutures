"""Test triage against the hand-labeled gold set before trusting it.

    python -m sf_pipeline.eval --gold pipeline/eval/gold_v1.csv --reps 3

For each paper in the gold file this fetches the title and abstract (arXiv
for arXiv ids, Semantic Scholar for DOIs), runs the same triage the pipeline
runs, `--reps` times, and compares the answers with the labels. Nothing is
written to the database, and abstracts are only held in memory: the gold
file stores ids and labels, never abstracts.

The report covers:
  recall        share of relevant papers the model passed on (yes or unsure),
                for the dev and holdout splits separately. The target is 90%.
  near misses   precision over relevant papers plus near misses, and how many
                near misses got through
  fields        how often kind, technology and problem match the labels
  reliability   refusals, replies that validated first time, failures
  cost          in total and per call

See pipeline/eval/README.md for how to fill in the gold file.
"""

import argparse
import csv
import json
import sys
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Literal, cast

import anthropic
from sf_shared.enums import Problem, SourceKind, Technology
from sf_shared.normalize import normalize_arxiv_id, normalize_doi
from sf_shared.pipeline_models import Relevant, SearchConfig, TriageResult

from sf_pipeline.collectors.arxiv import ArxivCollector
from sf_pipeline.collectors.base import CollectedPaper, describe_error, make_http_client
from sf_pipeline.collectors.semantic_scholar import SemanticScholarCollector
from sf_pipeline.config import Settings, load_settings
from sf_pipeline.triage import (
    Effort,
    PaperToTriage,
    TriagePrompt,
    TriageSettings,
    assess_paper,
    load_prompt,
    make_client,
)

GOLD_COLUMNS = ["id", "title", "label", "kind", "technology", "problem", "is_near_miss", "split"]
EXAMPLE_PREFIX = "example"  # rows whose id starts with this are the filled-in examples, and are skipped
TRUE_VALUES = {"true", "yes", "y", "1"}
FALSE_VALUES = {"false", "no", "n", "0", ""}
RECALL_TARGET = 0.9
DEFAULT_MAX_COST_USD = 2.0

Label = Literal["relevant", "not_relevant"]
Split = Literal["dev", "holdout"]


class GoldFileError(Exception):
    """The gold file has problems. The message lists every one, by row."""


@dataclass(frozen=True)
class GoldItem:
    id: str  # an arXiv id or a DOI, as written in the file
    title: str
    label: Label
    kind: SourceKind | None
    technology: frozenset[Technology]
    problem: Problem | None
    is_near_miss: bool
    split: Split
    arxiv_id: str | None
    doi: str | None

    @property
    def is_relevant(self) -> bool:
        return self.label == "relevant"


# ---------------------------------------------------------------------------
# Reading the gold file


def parse_bool(text: str) -> bool | None:
    value = text.strip().lower()
    if value in TRUE_VALUES:
        return True
    if value in FALSE_VALUES:
        return False
    return None


def enum_value[EnumT: StrEnum](enum_class: type[EnumT], text: str) -> EnumT | None:
    """The member whose value is `text`, or None."""
    try:
        return enum_class(text)
    except ValueError:
        return None


def parse_technologies(text: str) -> tuple[frozenset[Technology], list[str]]:
    """Technologies separated by ; or |. Returns the values and any it didn't recognize."""
    values: set[Technology] = set()
    unknown: list[str] = []
    for part in text.replace("|", ";").split(";"):
        part = part.strip().lower()
        if not part:
            continue
        technology = enum_value(Technology, part)
        if technology is None:
            unknown.append(part)
        else:
            values.add(technology)
    return frozenset(values), unknown


def parse_row(row: dict[str, str]) -> tuple[GoldItem | None, list[str]]:
    """One row, or None and the problems with it."""
    problems: list[str] = []
    raw_id = (row.get("id") or "").strip()
    arxiv_id = normalize_arxiv_id(raw_id)
    doi = None if arxiv_id else normalize_doi(raw_id)
    if not arxiv_id and not doi:
        problems.append(f'id "{raw_id}" is neither an arXiv id nor a DOI')

    label = (row.get("label") or "").strip().lower()
    if label not in ("relevant", "not_relevant"):
        problems.append(f'label must be relevant or not_relevant, not "{label}"')

    kind_text = (row.get("kind") or "").strip().lower()
    kind = enum_value(SourceKind, kind_text) if kind_text else None
    if kind_text and kind is None:
        problems.append(f'kind must be argument, milestone_evidence or empty, not "{kind_text}"')

    technology, unknown = parse_technologies(row.get("technology") or "")
    if unknown:
        problems.append(f"unknown technology: {', '.join(unknown)} (use wbe, bci, neuromorphic, hybrid)")

    problem_text = (row.get("problem") or "").strip().lower()
    problem = enum_value(Problem, problem_text) if problem_text else None
    if problem_text and problem is None:
        problems.append(f'problem must be alignment, intelligence_curse, both or empty, not "{problem_text}"')

    near_miss = parse_bool(row.get("is_near_miss") or "")
    if near_miss is None:
        problems.append("is_near_miss must be true or false")

    split = (row.get("split") or "").strip().lower()
    if split not in ("dev", "holdout"):
        problems.append(f'split must be dev or holdout, not "{split}"')

    if problems:
        return None, problems
    return (
        GoldItem(
            id=raw_id,
            title=(row.get("title") or "").strip(),
            label=cast(Label, label),  # checked above
            kind=kind,
            technology=technology,
            problem=problem,
            is_near_miss=bool(near_miss),
            split=cast(Split, split),  # checked above
            arxiv_id=arxiv_id,
            doi=doi,
        ),
        [],
    )


def read_gold(path: Path) -> tuple[list[GoldItem], int]:
    """The gold items and how many example rows were skipped. Raises GoldFileError listing every bad row."""
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = [column for column in GOLD_COLUMNS if column not in (reader.fieldnames or [])]
        if missing:
            raise GoldFileError(f"{path.name} is missing the column(s): {', '.join(missing)}")

        items: list[GoldItem] = []
        problems: list[str] = []
        examples = 0
        seen: set[str] = set()
        # Row 1 is the header, so data starts on row 2, matching what a spreadsheet shows.
        for row_number, row in enumerate(reader, start=2):
            if (row.get("id") or "").strip().lower().startswith(EXAMPLE_PREFIX):
                examples += 1
                continue
            if not any((value or "").strip() for value in row.values()):
                continue  # blank line
            item, row_problems = parse_row(row)
            for problem in row_problems:
                problems.append(f"row {row_number}: {problem}")
            if item is None:
                continue
            key = item.arxiv_id or item.doi or item.id
            if key in seen:
                problems.append(f"row {row_number}: {item.id} appears more than once")
            seen.add(key)
            items.append(item)

    if problems:
        raise GoldFileError("The gold file has problems:\n  " + "\n  ".join(problems))
    return items, examples


# ---------------------------------------------------------------------------
# Fetching the papers


Fetcher = Callable[[list[str]], list[CollectedPaper]]


def fetch_papers(items: list[GoldItem], fetch_arxiv: Fetcher, fetch_dois: Fetcher) -> dict[str, PaperToTriage]:
    """Title and abstract for each gold item, keyed by gold id.

    A paper the databases don't return is triaged on the gold file's title
    alone, the way the pipeline handles a paper with no abstract.
    """
    arxiv_ids = [item.arxiv_id for item in items if item.arxiv_id]
    dois = [item.doi for item in items if item.doi]
    by_arxiv = {paper.arxiv_id: paper for paper in fetch_arxiv(arxiv_ids)} if arxiv_ids else {}
    by_doi = {paper.doi: paper for paper in fetch_dois(dois)} if dois else {}

    papers: dict[str, PaperToTriage] = {}
    for item in items:
        found = by_arxiv.get(item.arxiv_id) if item.arxiv_id else by_doi.get(item.doi)
        title = found.title if found else item.title
        abstract = found.abstract if found else None
        papers[item.id] = PaperToTriage(source_id=f"gold:{item.id}", title=title or item.title, abstract=abstract)
    return papers


def network_fetchers(settings: Settings) -> tuple[Fetcher, Fetcher]:
    arxiv = ArxivCollector(make_http_client(settings.user_agent, single_connection=True))
    scholar = SemanticScholarCollector(make_http_client(settings.user_agent), api_key=settings.semantic_scholar_api_key)

    def fetch_dois(dois: list[str]) -> list[CollectedPaper]:
        return scholar.fetch_by_ids([f"DOI:{doi}" for doi in dois])

    return arxiv.fetch_by_ids, fetch_dois


# ---------------------------------------------------------------------------
# Running triage on them


@dataclass
class ItemRun:
    """One triage of one gold paper."""

    item: GoldItem
    rep: int
    result: TriageResult | None
    refused: bool = False
    first_attempt_valid: bool = False
    calls: int = 0
    cost_usd: float = 0.0
    error: str | None = None  # an API error, or why the reply was unusable

    @property
    def passed_on(self) -> bool:
        """Would a person see it? Yes or unsure. A failed call also goes to a person,
        but it's counted separately so failures can't hide a weak prompt."""
        return self.result is not None and self.result.relevant in (Relevant.YES, Relevant.UNSURE)


def run_item(
    client: anthropic.Anthropic, prompt: TriagePrompt, item: GoldItem, paper: PaperToTriage, settings: TriageSettings, rep: int
) -> ItemRun:
    try:
        outcome = assess_paper(client, prompt, paper, settings)
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError, anthropic.NotFoundError):
        raise
    except anthropic.APIError as error:
        return ItemRun(item=item, rep=rep, result=None, error=f"API error: {type(error).__name__}")
    return ItemRun(
        item=item,
        rep=rep,
        result=outcome.result,
        refused=outcome.refused,
        first_attempt_valid=outcome.first_attempt_valid,
        calls=len(outcome.assessments),
        cost_usd=outcome.cost_usd,
        error=outcome.final.error if outcome.failed else None,
    )


def run_eval(
    client: anthropic.Anthropic,
    prompt: TriagePrompt,
    items: list[GoldItem],
    papers: dict[str, PaperToTriage],
    settings: TriageSettings,
    *,
    reps: int,
    max_cost_usd: float,
    progress: Callable[[str], None] = print,
) -> tuple[list[ItemRun], bool]:
    """Every rep of every item, and whether it finished before the cost limit."""
    runs: list[ItemRun] = []
    spent = 0.0
    for rep in range(1, reps + 1):
        progress(f"Rep {rep} of {reps}: {len(items)} papers")
        for item in items:
            if spent >= max_cost_usd:
                progress(f"Stopped at the ${max_cost_usd:.2f} cost limit. Raise it with --max-cost-usd.")
                return runs, False
            run = run_item(client, prompt, item, papers[item.id], settings, rep)
            spent += run.cost_usd
            runs.append(run)
    return runs, True


# ---------------------------------------------------------------------------
# The report


@dataclass
class Rate:
    hits: int = 0
    total: int = 0

    def add(self, hit: bool) -> None:
        self.total += 1
        if hit:
            self.hits += 1

    @property
    def value(self) -> float | None:
        return self.hits / self.total if self.total else None

    def text(self) -> str:
        if not self.total:
            return "n/a (no papers)"
        return f"{self.hits / self.total:.0%} ({self.hits}/{self.total})"


@dataclass
class EvalReport:
    reps: int
    items: int
    recall_by_rep: dict[str, list[Rate]] = field(default_factory=dict)  # split -> one Rate per rep
    precision: Rate = field(default_factory=Rate)
    near_misses_passed: Rate = field(default_factory=Rate)
    kind: Rate = field(default_factory=Rate)
    technology: Rate = field(default_factory=Rate)
    problem: Rate = field(default_factory=Rate)
    refusals: Rate = field(default_factory=Rate)
    first_reply_valid: Rate = field(default_factory=Rate)
    failed: Rate = field(default_factory=Rate)
    calls: int = 0
    cost_usd: float = 0.0
    missed: dict[str, int] = field(default_factory=dict)  # relevant gold id -> reps the model said no
    near_misses_through: dict[str, int] = field(default_factory=dict)  # near-miss id -> reps passed on
    unstable: list[str] = field(default_factory=list)  # ids whose answer changed between reps


def build_report(runs: list[ItemRun], reps: int) -> EvalReport:
    item_ids = {run.item.id for run in runs}
    report = EvalReport(reps=reps, items=len(item_ids))

    for split in ("dev", "holdout"):
        rates: list[Rate] = []
        for rep in range(1, reps + 1):
            rate = Rate()
            for run in runs:
                if run.rep == rep and run.item.split == split and run.item.is_relevant:
                    rate.add(run.passed_on)
            if rate.total:
                rates.append(rate)
        report.recall_by_rep[split] = rates

    answers: dict[str, set[str]] = {}
    for run in runs:
        item = run.item
        report.calls += run.calls
        report.cost_usd += run.cost_usd
        report.refusals.add(run.refused)
        if not run.refused and run.calls:
            report.first_reply_valid.add(run.first_attempt_valid)
        report.failed.add(run.result is None)
        answers.setdefault(item.id, set()).add(run.result.relevant.value if run.result else "failed")

        if item.is_relevant or item.is_near_miss:
            if run.passed_on:
                report.precision.add(item.is_relevant)
        if item.is_near_miss and not item.is_relevant:
            report.near_misses_passed.add(run.passed_on)
            if run.passed_on:
                report.near_misses_through[item.id] = report.near_misses_through.get(item.id, 0) + 1
        if item.is_relevant and run.result is not None and run.result.relevant == Relevant.NO:
            report.missed[item.id] = report.missed.get(item.id, 0) + 1

        # Field agreement only counts papers the model passed on, since those
        # are the values a reviewer sees. Misses are already counted in recall.
        if item.is_relevant and run.result is not None and run.passed_on:
            if item.kind is not None:
                report.kind.add(run.result.kind == item.kind)
            if item.technology:
                report.technology.add(frozenset(run.result.technology) == item.technology)
            if item.problem is not None:
                report.problem.add(run.result.problem == item.problem)

    report.unstable = sorted(item_id for item_id, seen in answers.items() if len(seen) > 1)
    return report


def recall_line(split: str, rates: list[Rate]) -> str:
    if not rates:
        return f"  {split:8} n/a (no relevant papers in this split)"
    values = [rate.value or 0.0 for rate in rates]
    mean = sum(values) / len(values)
    worst = min(values)
    verdict = "meets" if worst >= RECALL_TARGET else "below"
    per_rep = ", ".join(rate.text() for rate in rates)
    return f"  {split:8} mean {mean:.0%}, worst rep {worst:.0%} ({verdict} the {RECALL_TARGET:.0%} target). Per rep: {per_rep}"


def format_report(report: EvalReport, titles: dict[str, str], finished: bool) -> str:
    lines = [
        f"Gold-set eval: {report.items} papers, {report.reps} reps" + ("" if finished else " (stopped early at the cost limit)"),
        "",
        "Recall on relevant papers (said yes or unsure):",
        recall_line("dev", report.recall_by_rep.get("dev", [])),
        recall_line("holdout", report.recall_by_rep.get("holdout", [])),
        "",
        f"Precision on relevant papers plus near misses: {report.precision.text()}",
        f"Near misses passed on to a person: {report.near_misses_passed.text()}",
        "",
        "Agreement with the labels, on relevant papers the model passed on:",
        f"  kind        {report.kind.text()}",
        f"  technology  {report.technology.text()} (exact match of the whole list)",
        f"  problem     {report.problem.text()}",
        "",
        f"Refusals: {report.refusals.text()}",
        f"Replies that fit the schema first time: {report.first_reply_valid.text()}",
        f"Failed after retries (would go to a person flagged ai_failed): {report.failed.text()}",
        f"Cost: ${report.cost_usd:.4f} for {report.calls} calls"
        + (f" (${report.cost_usd / report.calls:.5f} a call)" if report.calls else ""),
    ]
    if report.missed:
        lines += ["", "Relevant papers the model said no to (reps missed):"]
        for item_id, count in sorted(report.missed.items(), key=lambda pair: -pair[1]):
            lines.append(f"  {count}x  {item_id}  {titles.get(item_id, '')}")
    if report.near_misses_through:
        lines += ["", "Near misses the model passed on (reps):"]
        for item_id, count in sorted(report.near_misses_through.items(), key=lambda pair: -pair[1]):
            lines.append(f"  {count}x  {item_id}  {titles.get(item_id, '')}")
    if report.unstable:
        lines += ["", f"Answers that changed between reps ({len(report.unstable)}):"]
        for item_id in report.unstable:
            lines.append(f"  {item_id}  {titles.get(item_id, '')}")
    return "\n".join(lines)


def runs_as_json(runs: list[ItemRun]) -> list[dict]:
    """Per-call results for --out. Quotes are short excerpts; no abstracts are included."""
    rows: list[dict] = []
    for run in runs:
        rows.append(
            {
                "id": run.item.id,
                "rep": run.rep,
                "split": run.item.split,
                "label": run.item.label,
                "is_near_miss": run.item.is_near_miss,
                "result": run.result.model_dump(mode="json") if run.result else None,
                "refused": run.refused,
                "first_attempt_valid": run.first_attempt_valid,
                "calls": run.calls,
                "cost_usd": run.cost_usd,
                "error": run.error,
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Command line


def build_parser() -> argparse.ArgumentParser:
    defaults = SearchConfig(queries=[])
    parser = argparse.ArgumentParser(prog="python -m sf_pipeline.eval", description="Test triage against the gold set.")
    parser.add_argument("--gold", type=Path, required=True, help="the gold CSV, e.g. pipeline/eval/gold_v1.csv")
    parser.add_argument("--reps", type=int, default=3, help="how many times to triage each paper (default 3)")
    parser.add_argument("--model", default=defaults.model, help=f"default {defaults.model}")
    parser.add_argument("--effort", choices=["low", "medium", "high"], default=defaults.effort, help=f"default {defaults.effort}")
    parser.add_argument("--split", choices=["dev", "holdout", "all"], default="all", help="only run one split")
    parser.add_argument(
        "--max-cost-usd", type=float, default=DEFAULT_MAX_COST_USD, help=f"stop when this is spent (default ${DEFAULT_MAX_COST_USD:.2f})"
    )
    parser.add_argument("--out", type=Path, help="also write every result as JSON (keep it out of git)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = load_settings()
    if args.reps < 1:
        print("--reps has to be 1 or more.", file=sys.stderr)
        return 1

    try:
        items, examples = read_gold(args.gold)
    except (GoldFileError, OSError) as error:
        print(error, file=sys.stderr)
        return 1
    if args.split != "all":
        items = [item for item in items if item.split == args.split]
    if examples:
        print(f"Skipped {examples} example rows (ids starting with EXAMPLE).")
    if not items:
        print("There are no gold papers to test yet. Add rows to the gold file (see pipeline/eval/README.md).")
        return 1

    client = make_client(settings)
    if client is None:
        print("ANTHROPIC_API_KEY isn't set. The eval calls the model, so it needs a key.", file=sys.stderr)
        return 1

    prompt = load_prompt(settings.content_dir)
    triage_settings = TriageSettings(model=args.model, effort=cast(Effort, args.effort))  # argparse checked the choice
    print(f"Prompt {prompt.version}, model {args.model} at {args.effort} effort.")

    print(f"Fetching {len(items)} papers from arXiv and Semantic Scholar...")
    started = time.monotonic()
    fetch_arxiv, fetch_dois = network_fetchers(settings)
    try:
        papers = fetch_papers(items, fetch_arxiv, fetch_dois)
    except Exception as error:  # noqa: BLE001  report it plainly instead of a traceback
        print(f"Couldn't fetch the papers: {describe_error(error)}", file=sys.stderr)
        return 1
    no_abstract = sum(1 for paper in papers.values() if not paper.abstract)
    print(f"Fetched in {time.monotonic() - started:.0f}s. {no_abstract} have no abstract and will be triaged on the title.")

    try:
        runs, finished = run_eval(
            client, prompt, items, papers, triage_settings, reps=args.reps, max_cost_usd=args.max_cost_usd
        )
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError, anthropic.NotFoundError) as error:
        print(f"The Anthropic API refused the key or the model (HTTP {error.status_code}).", file=sys.stderr)
        return 1

    report = build_report(runs, args.reps)
    titles = {item.id: papers[item.id].title for item in items}
    print()
    print(format_report(report, titles, finished))

    if args.out:
        summary = asdict(report)
        output = {
            "prompt_version": prompt.version,
            "model": args.model,
            "effort": args.effort,
            "summary": summary,
            "runs": runs_as_json(runs),
        }
        args.out.write_text(json.dumps(output, indent=2, default=str), encoding="utf-8")
        print(f"\nWrote every result to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
