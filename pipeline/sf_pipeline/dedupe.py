"""Turn collected papers into new candidates, skipping ones we already have.

Checks, in order: DOI, arXiv id (version stripped), Semantic Scholar id, then
the normalized title plus year. The first three are exact identifiers, so a
match means it's the same paper and it isn't added again. A title match is
only a hint (generic titles collide), so the paper is added with the flag
possible_duplicate and a reviewer decides.

A paper counts as known when it's in the sources collection or among the
real (non-sample) sources in content/sources.json, which the site already
cites.

Dedupe happens in two steps so a dry run can stop after the first:
plan_dedupe reads the database and works out what would change, and
apply_dedupe writes it.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

import mongomock
from pymongo import InsertOne, UpdateOne
from pymongo.errors import BulkWriteError, DuplicateKeyError
from sf_shared.db import now
from sf_shared.normalize import normalize_arxiv_id, normalize_doi, title_key
from sf_shared.pipeline_models import Candidate, CandidateFlag, ReviewStatus

from sf_pipeline.collectors.base import CollectedPaper
from sf_pipeline.store import to_doc

IDENTIFIER_FIELDS = ("doi", "arxiv_id", "s2_id")
DUPLICATE_KEY = 11000  # MongoDB's error code for a unique index violation


@dataclass
class KnownSources:
    """Identifiers of the sources already on the site (content/sources.json)."""

    dois: set[str] = field(default_factory=set)
    arxiv_ids: set[str] = field(default_factory=set)
    titles: list[tuple[str, int | None]] = field(default_factory=list)  # (title_key, year)


@dataclass
class MergedPaper:
    """One paper, after folding together every copy of it found in this run."""

    paper: CollectedPaper
    query_labels: list[str]


@dataclass(frozen=True)
class PlannedUpdate:
    """An update to an existing source: a filter and the change to make."""

    filter: dict
    change: dict


@dataclass
class DedupePlan:
    new_candidates: list[Candidate] = field(default_factory=list)
    updates: list[PlannedUpdate] = field(default_factory=list)  # query labels and ids for existing sources
    duplicates: int = 0  # already in the database or on the site
    merged_in_run: int = 0  # the same paper found more than once in this run
    possible_duplicates: int = 0  # new, but the title matches a known source


def load_site_sources(content_dir: Path) -> KnownSources:
    """Read content/sources.json. A missing file just means nothing is known yet."""
    known = KnownSources()
    path = content_dir / "sources.json"
    if not path.exists():
        return known
    for source in json.loads(path.read_text(encoding="utf-8")):
        if source.get("sample"):
            continue  # samples are made up, so they can't collide with real papers
        doi = normalize_doi(source.get("doi"))
        arxiv_id = normalize_arxiv_id(source.get("arxiv_id"))
        if doi:
            known.dois.add(doi)
        if arxiv_id:
            known.arxiv_ids.add(arxiv_id)
        if source.get("title"):
            known.titles.append((title_key(source["title"]), source.get("year")))
    return known


def merge_within_run(papers: list[CollectedPaper]) -> tuple[list[MergedPaper], int]:
    """Fold copies of the same paper (same DOI, arXiv id or S2 id) into one.

    The same paper often turns up in several searches, and on both arXiv and
    Semantic Scholar. Returns the merged papers and how many copies were folded.
    """
    merged: list[MergedPaper] = []
    index_by_key: dict[tuple[str, str], int] = {}
    folded = 0

    for paper in papers:
        keys = identifier_keys(paper)
        position = None
        for key in keys:
            if key in index_by_key:
                position = index_by_key[key]
                break

        if position is None:
            merged.append(MergedPaper(paper=paper, query_labels=[paper.query_label]))
            position = len(merged) - 1
        else:
            folded += 1
            existing = merged[position]
            existing.paper = combine(existing.paper, paper)
            if paper.query_label not in existing.query_labels:
                existing.query_labels.append(paper.query_label)

        for key in identifier_keys(merged[position].paper):
            index_by_key[key] = position
    return merged, folded


def identifier_keys(paper: CollectedPaper) -> list[tuple[str, str]]:
    keys: list[tuple[str, str]] = []
    for name in IDENTIFIER_FIELDS:
        value = getattr(paper, name)
        if value:
            keys.append((name, value))
    return keys


def combine(first: CollectedPaper, second: CollectedPaper) -> CollectedPaper:
    """One record from two copies of a paper.

    The arXiv copy wins for title, abstract, link and source type: arXiv
    metadata is CC0 and its abstracts are always there. Missing identifiers
    and details are filled from the other copy.
    """
    primary, other = (second, first) if second.collector == "arxiv" and first.collector != "arxiv" else (first, second)
    return primary.model_copy(
        update={
            "doi": primary.doi or other.doi,
            "arxiv_id": primary.arxiv_id or other.arxiv_id,
            "s2_id": primary.s2_id or other.s2_id,
            "venue": primary.venue or other.venue,
            "year": primary.year or other.year,
            "published": primary.published or other.published,
            "abstract": primary.abstract or other.abstract,
            "authors": primary.authors or other.authors,
            "source_type": primary.source_type or other.source_type,
        }
    )


def plan_dedupe(db, papers: list[CollectedPaper], known: KnownSources) -> DedupePlan:
    """Work out which papers are new, without writing anything."""
    plan = DedupePlan()
    merged, plan.merged_in_run = merge_within_run(papers)
    if not merged:
        return plan

    existing_by_key = find_existing_by_identifier(db, merged)
    known_titles = find_existing_titles(db, merged) + list(known.titles)
    timestamp = now()

    for item in merged:
        paper = item.paper
        match = None
        for key in identifier_keys(paper):
            if key in existing_by_key:
                match = existing_by_key[key]
                break

        if match is not None:
            plan.duplicates += 1
            plan.updates.extend(updates_for_existing(match, paper, item.query_labels, timestamp))
            continue
        if (paper.doi and paper.doi in known.dois) or (paper.arxiv_id and paper.arxiv_id in known.arxiv_ids):
            plan.duplicates += 1
            continue

        flags: list[CandidateFlag] = []
        # Set now, not only at triage, so the queue's "No abstract" filter
        # finds these papers while they're still in New.
        if not paper.abstract:
            flags.append("no_abstract")
        key = title_key(paper.title)
        if title_matches(key, paper.year, known_titles):
            flags.append("possible_duplicate")
            plan.possible_duplicates += 1
        plan.new_candidates.append(to_candidate(paper, item.query_labels, flags, timestamp))
        # Later papers in this run should see this one as known.
        known_titles.append((key, paper.year))
    return plan


def find_existing_by_identifier(db, merged: list[MergedPaper]) -> dict[tuple[str, str], dict]:
    """Existing sources that share a DOI, arXiv id or S2 id with any merged paper, in one query."""
    values: dict[str, list[str]] = {name: [] for name in IDENTIFIER_FIELDS}
    for item in merged:
        for name, value in identifier_keys(item.paper):
            values[name].append(value)

    conditions = []
    for name in IDENTIFIER_FIELDS:
        if values[name]:
            conditions.append({name: {"$in": values[name]}})
    if not conditions:
        return {}

    projection = {"_id": 1, "id": 1, "query_labels": 1, **{name: 1 for name in IDENTIFIER_FIELDS}}
    found: dict[tuple[str, str], dict] = {}
    for doc in db["sources"].find({"$or": conditions}, projection):
        for name in IDENTIFIER_FIELDS:
            if doc.get(name):
                found[(name, doc[name])] = doc
    return found


def find_existing_titles(db, merged: list[MergedPaper]) -> list[tuple[str, int | None]]:
    keys = list({title_key(item.paper.title) for item in merged})
    titles: list[tuple[str, int | None]] = []
    for doc in db["sources"].find({"title_key": {"$in": keys}}, {"title_key": 1, "year": 1}):
        titles.append((doc["title_key"], doc.get("year")))
    return titles


def title_matches(key: str, year: int | None, known_titles: list[tuple[str, int | None]]) -> bool:
    """Same normalized title, and the same year when both years are known."""
    if not key:
        return False
    for known_key, known_year in known_titles:
        if known_key != key:
            continue
        if year is None or known_year is None or year == known_year:
            return True
    return False


def updates_for_existing(existing: dict, paper: CollectedPaper, labels: list[str], timestamp) -> list[PlannedUpdate]:
    """Record which searches found the paper again, and fill identifiers the existing record lacks.

    Each identifier is filled only where it's still empty, so nothing a
    person or an earlier run set is overwritten.
    """
    updates: list[PlannedUpdate] = []
    new_labels = [label for label in labels if label not in (existing.get("query_labels") or [])]
    if new_labels:
        updates.append(
            PlannedUpdate(
                {"_id": existing["_id"]},
                {"$addToSet": {"query_labels": {"$each": new_labels}}, "$set": {"updated_at": timestamp}},
            )
        )
    for name in IDENTIFIER_FIELDS:
        value = getattr(paper, name)
        if value and not existing.get(name):
            updates.append(PlannedUpdate({"_id": existing["_id"], name: None}, {"$set": {name: value, "updated_at": timestamp}}))
    return updates


def candidate_id(paper: CollectedPaper) -> str:
    """e.g. "arxiv-2411.18526" or "s2-<paperId>". Old arXiv ids contain a slash, which becomes "_"."""
    if paper.arxiv_id:
        return "arxiv-" + paper.arxiv_id.replace("/", "_")
    if paper.s2_id:
        return "s2-" + paper.s2_id
    return "doi-" + (paper.doi or title_key(paper.title).replace(" ", "-"))


def to_candidate(paper: CollectedPaper, labels: list[str], flags: list[CandidateFlag], timestamp) -> Candidate:
    return Candidate(
        id=candidate_id(paper),
        origin="pipeline",
        collector=paper.collector,
        title=paper.title,
        authors=paper.authors,
        year=paper.year,
        url=paper.url,
        doi=paper.doi,
        arxiv_id=paper.arxiv_id,
        s2_id=paper.s2_id,
        venue=paper.venue,
        source_type=paper.source_type,
        abstract=paper.abstract,
        title_key=title_key(paper.title),
        review_status=ReviewStatus.NEW,
        flags=flags,
        query_labels=labels,
        found_at=timestamp,
        updated_at=timestamp,
    )


@dataclass
class ApplyResult:
    inserted: int
    # Inserts refused by a unique index: another process added the same paper
    # between planning and writing. They're duplicates, not errors.
    collisions: int


def apply_dedupe(db, plan: DedupePlan) -> ApplyResult:
    """Insert the new candidates and apply the updates, each as one bulk write."""
    sources = db["sources"]
    if plan.updates:
        write_updates(sources, plan.updates)

    if not plan.new_candidates:
        return ApplyResult(inserted=0, collisions=0)

    inserts = [InsertOne(to_doc(candidate)) for candidate in plan.new_candidates]
    try:
        result = sources.bulk_write(inserts, ordered=False)
        return ApplyResult(inserted=result.inserted_count, collisions=0)
    except BulkWriteError as error:
        collisions = count_duplicate_key_errors(error)
        return ApplyResult(inserted=error.details.get("nInserted", 0), collisions=collisions)


def write_updates(sources, updates: list[PlannedUpdate]) -> None:
    """Apply the updates as one bulk write.

    Filling in an identifier fails when another record already holds it (two
    records for one paper). That's skipped and both are left for a person.
    mongomock's bulk_write doesn't accept the UpdateOne objects current
    pymongo builds, so the in-memory database gets one update at a time.
    """
    if isinstance(sources, mongomock.Collection):
        for update in updates:
            try:
                sources.update_one(update.filter, update.change)
            except DuplicateKeyError:
                pass
        return
    try:
        sources.bulk_write([UpdateOne(update.filter, update.change) for update in updates], ordered=False)
    except BulkWriteError as error:
        count_duplicate_key_errors(error)


def count_duplicate_key_errors(error: BulkWriteError) -> int:
    """How many writes a unique index refused. Any other kind of write error is raised."""
    count = 0
    for write_error in error.details.get("writeErrors", []):
        if write_error.get("code") != DUPLICATE_KEY:
            raise error
        count += 1
    return count
