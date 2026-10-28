"""arXiv collector, using the export.arxiv.org Atom API.

arXiv asks for at most one request every 3 seconds over a single connection,
so this waits 3.1 seconds between requests and uses one client throughout.
arXiv metadata is CC0, so titles and abstracts can be stored.

API docs: https://info.arxiv.org/help/api/user-manual.html
"""

import time
import xml.etree.ElementTree as ElementTree
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime

import httpx
from sf_shared.enums import SourceType
from sf_shared.normalize import normalize_arxiv_id, normalize_doi
from sf_shared.pipeline_models import SearchQuery

from sf_pipeline.collectors.base import (
    CollectedPaper,
    CollectorName,
    Heartbeat,
    HttpFetcher,
    SearchWindow,
    Sleep,
    collapse_whitespace,
)
from sf_pipeline.collectors.query import to_arxiv_query

API_URL = "https://export.arxiv.org/api/query"
MIN_SECONDS_BETWEEN_REQUESTS = 3.1
PAGE_SIZE = 100
ID_BATCH_SIZE = 50  # ids per request when fetching known papers (the eval)

NAMESPACES = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
    "opensearch": "http://a9.com/-/spec/opensearch/1.1/",
}


class ArxivError(Exception):
    """arXiv answered, but with an error instead of results (usually a bad query)."""


class ArxivCollector:
    name: CollectorName = "arxiv"
    display_name = "arXiv"

    def __init__(self, client: httpx.Client, *, sleep: Sleep = time.sleep, heartbeat: Heartbeat | None = None) -> None:
        self.fetcher = HttpFetcher(client, min_interval=MIN_SECONDS_BETWEEN_REQUESTS, sleep=sleep, heartbeat=heartbeat)

    def search(self, query: SearchQuery, window: SearchWindow, max_results: int) -> Iterator[CollectedPaper]:
        """Papers submitted inside the window that match the search, newest first."""
        dates = f"submittedDate:[{date_bound(window.since, '0000')} TO {date_bound(window.until, '2359')}]"
        search_query = f"({to_arxiv_query(query.text)}) AND {dates}"
        start = 0
        yielded = 0
        while yielded < max_results:
            page_size = min(PAGE_SIZE, max_results - yielded)
            params: dict[str, str | int] = {
                "search_query": search_query,
                "start": start,
                "max_results": page_size,
                "sortBy": "submittedDate",
                "sortOrder": "descending",
            }
            page = self.fetch_page(params, query.label)
            if page.entry_count == 0 and start < page.total:
                # arXiv sometimes returns an empty page in the middle of a result
                # set. Asking once more usually gets the real page.
                page = self.fetch_page(params, query.label)

            for paper in page.papers:
                yield paper
                yielded += 1
                if yielded >= max_results:
                    return
            start += page_size
            if page.entry_count < page_size or start >= page.total:
                return

    def fetch_by_ids(self, arxiv_ids: list[str], label: str = "") -> list[CollectedPaper]:
        """Look up specific papers, for the gold-set eval."""
        found: list[CollectedPaper] = []
        for offset in range(0, len(arxiv_ids), ID_BATCH_SIZE):
            batch = arxiv_ids[offset:offset + ID_BATCH_SIZE]
            params: dict[str, str | int] = {"id_list": ",".join(batch), "max_results": len(batch)}
            found.extend(self.fetch_page(params, label).papers)
        return found

    def fetch_page(self, params: dict[str, str | int], label: str) -> "FeedPage":
        response = self.fetcher.get(API_URL, params=params)
        return parse_feed(response.text, label)


@dataclass(frozen=True)
class FeedPage:
    total: int  # results for the whole search, not just this page
    entry_count: int  # entries on this page, including any we couldn't read
    papers: list[CollectedPaper]


def date_bound(day: date, time_of_day: str) -> str:
    """arXiv date filters are YYYYMMDDHHMM in GMT."""
    return day.strftime("%Y%m%d") + time_of_day


def parse_feed(xml_text: str, label: str) -> FeedPage:
    root = ElementTree.fromstring(xml_text)
    total_text = root.findtext("opensearch:totalResults", default="0", namespaces=NAMESPACES)
    total = int(total_text.strip() or 0)

    entries = root.findall("atom:entry", NAMESPACES)
    papers: list[CollectedPaper] = []
    for entry in entries:
        entry_id = entry.findtext("atom:id", default="", namespaces=NAMESPACES)
        if "/api/errors" in entry_id:
            message = collapse_whitespace(entry.findtext("atom:summary", default="", namespaces=NAMESPACES))
            raise ArxivError(f"arXiv rejected the search: {message}")
        paper = parse_entry(entry, label)
        if paper is not None:
            papers.append(paper)
    return FeedPage(total=total, entry_count=len(entries), papers=papers)


def parse_entry(entry: ElementTree.Element, label: str) -> CollectedPaper | None:
    arxiv_id = normalize_arxiv_id(entry.findtext("atom:id", default="", namespaces=NAMESPACES))
    title = collapse_whitespace(entry.findtext("atom:title", default="", namespaces=NAMESPACES))
    if arxiv_id is None or not title:
        return None

    authors: list[str] = []
    for author in entry.findall("atom:author", NAMESPACES):
        name = collapse_whitespace(author.findtext("atom:name", default="", namespaces=NAMESPACES))
        if name:
            authors.append(name)

    published = parse_timestamp(entry.findtext("atom:published", default="", namespaces=NAMESPACES))
    abstract = collapse_whitespace(entry.findtext("atom:summary", default="", namespaces=NAMESPACES))
    journal_ref = collapse_whitespace(entry.findtext("arxiv:journal_ref", default="", namespaces=NAMESPACES))

    return CollectedPaper(
        collector="arxiv",
        query_label=label,
        title=title,
        authors=authors,
        year=published.year if published else None,
        published=published,
        url=f"https://arxiv.org/abs/{arxiv_id}",
        doi=normalize_doi(entry.findtext("arxiv:doi", default="", namespaces=NAMESPACES)),
        arxiv_id=arxiv_id,
        venue=journal_ref or None,
        source_type=SourceType.PREPRINT,
        abstract=abstract or None,
    )


def parse_timestamp(text: str) -> date | None:
    text = text.strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None
