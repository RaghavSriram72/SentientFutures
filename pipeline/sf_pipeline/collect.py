"""The collect stage: run every enabled search on its collectors, then dedupe.

A collector that fails (after its retries) is logged and skipped, and the
papers it returned before failing are kept. The other collectors and
searches carry on.
"""

import time
from dataclasses import dataclass

from sf_shared.pipeline_models import SearchConfig, SearchQuery

from sf_pipeline.collectors.arxiv import ArxivCollector
from sf_pipeline.collectors.base import (
    CollectedPaper,
    Collector,
    Heartbeat,
    SearchWindow,
    Sleep,
    describe_error,
    make_http_client,
)
from sf_pipeline.collectors.semantic_scholar import SemanticScholarCollector
from sf_pipeline.config import Settings
from sf_pipeline.dedupe import apply_dedupe, load_site_sources, plan_dedupe
from sf_pipeline.text import plural
from sf_pipeline.triage import RunReporter

# Papers fetched per search and collector at most. A two-week window is far
# below this; it's a guard against a search that matches everything.
MAX_RESULTS_PER_SEARCH = 500


@dataclass
class CollectResult:
    new: int  # added to sources (or, in a dry run, would have been)
    ok: bool  # False when every collector call failed


def build_collectors(
    settings: Settings, *, heartbeat: Heartbeat | None = None, sleep: Sleep = time.sleep
) -> dict[str, Collector]:
    """One HTTP client per collector. arXiv asks for a single connection."""
    arxiv_client = make_http_client(settings.user_agent, single_connection=True)
    scholar_client = make_http_client(settings.user_agent)
    return {
        "arxiv": ArxivCollector(arxiv_client, sleep=sleep, heartbeat=heartbeat),
        "semantic_scholar": SemanticScholarCollector(
            scholar_client, api_key=settings.semantic_scholar_api_key, sleep=sleep, heartbeat=heartbeat
        ),
    }


def collect_one(
    collector: Collector, query: SearchQuery, window: SearchWindow, max_results: int, reporter: RunReporter
) -> tuple[list[CollectedPaper], bool]:
    """Every paper one collector returns for one search, and whether it finished."""
    papers: list[CollectedPaper] = []
    try:
        for paper in collector.search(query, window, max_results):
            papers.append(paper)
    except Exception as error:  # noqa: BLE001
        # Anything can go wrong here (network, a search the collector can't
        # translate, a response it can't parse), and none of it should stop
        # the other collectors.
        reporter.error(
            f'"{query.label}" on {collector.display_name} failed: {describe_error(error)}. '
            f"Kept the {plural(len(papers), 'paper')} it returned before that."
        )
        return papers, False
    return papers, True


def run_collect_stage(
    db,
    config: SearchConfig,
    settings: Settings,
    collectors: dict[str, Collector],
    reporter: RunReporter,
    *,
    limit: int | None = None,
    dry_run: bool = False,
) -> CollectResult:
    window = SearchWindow.ending_today(config.lookback_days)
    max_results = MAX_RESULTS_PER_SEARCH if limit is None else min(limit, MAX_RESULTS_PER_SEARCH)
    reporter.log(f"Collecting papers from {window.since.isoformat()} to {window.until.isoformat()}.")

    papers: list[CollectedPaper] = []
    calls = 0
    failures = 0
    for query in config.queries:
        if not query.enabled:
            continue
        for name in query.collectors:
            collector = collectors[name]
            calls += 1
            found, finished = collect_one(collector, query, window, max_results, reporter)
            if not finished:
                failures += 1
            papers.extend(found)
            reporter.add_counts(fetched=len(found))
            reporter.log(f'"{query.label}" on {collector.display_name}: {plural(len(found), "paper")}.')

    if calls == 0:
        reporter.log("No searches are enabled in the search config, so nothing was collected.")
        return CollectResult(new=0, ok=True)

    plan = plan_dedupe(db, papers, load_site_sources(settings.content_dir))
    duplicates = plan.duplicates + plan.merged_in_run
    flagged = f" ({plan.possible_duplicates} flagged as possible duplicates)" if plan.possible_duplicates else ""

    if dry_run:
        reporter.add_counts(new=len(plan.new_candidates), duplicates=duplicates)
        reporter.log(
            f"Dry run: would add {plural(len(plan.new_candidates), 'new candidate')}{flagged}. "
            f"Already known or found twice: {duplicates}. Nothing was written."
        )
        return CollectResult(new=len(plan.new_candidates), ok=failures < calls)

    applied = apply_dedupe(db, plan)
    reporter.add_counts(new=applied.inserted, duplicates=duplicates + applied.collisions)
    reporter.log(
        f"Added {plural(applied.inserted, 'new candidate')}{flagged}. "
        f"Already known or found twice: {duplicates + applied.collisions}."
    )
    return CollectResult(new=applied.inserted, ok=failures < calls)
