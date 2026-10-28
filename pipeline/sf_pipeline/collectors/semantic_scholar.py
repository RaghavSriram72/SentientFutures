"""Semantic Scholar collector, using the paper/search/bulk endpoint.

One request a second. It works without a key at a lower shared limit; set
SEMANTIC_SCHOLAR_API_KEY for the normal one. Some results have no abstract
because of publisher licensing. Those still come through, and triage flags
them no_abstract.

API docs: https://api.semanticscholar.org/api-docs/graph
"""

import time
from collections.abc import Iterator
from datetime import date

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
from sf_pipeline.collectors.query import to_semantic_scholar_query

SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search/bulk"
BATCH_URL = "https://api.semanticscholar.org/graph/v1/paper/batch"
FIELDS = "title,authors,year,externalIds,url,abstract,venue,publicationTypes,publicationDate"
MIN_SECONDS_BETWEEN_REQUESTS = 1.0
BATCH_SIZE = 100  # ids per request when fetching known papers (the eval)

# Semantic Scholar's publication types, mapped to the site's source types.
# Anything else (or no type) is left for the reviewer to set.
SOURCE_TYPE_BY_PUBLICATION_TYPE = {
    "JournalArticle": SourceType.PEER_REVIEWED,
    "Conference": SourceType.PEER_REVIEWED,
    "Review": SourceType.PEER_REVIEWED,
    "Book": SourceType.BOOK,
    "BookSection": SourceType.BOOK,
}


class SemanticScholarCollector:
    name: CollectorName = "semantic_scholar"
    display_name = "Semantic Scholar"

    def __init__(
        self,
        client: httpx.Client,
        *,
        api_key: str | None = None,
        sleep: Sleep = time.sleep,
        heartbeat: Heartbeat | None = None,
    ) -> None:
        self.fetcher = HttpFetcher(client, min_interval=MIN_SECONDS_BETWEEN_REQUESTS, sleep=sleep, heartbeat=heartbeat)
        self.headers = {"x-api-key": api_key} if api_key else {}

    def search(self, query: SearchQuery, window: SearchWindow, max_results: int) -> Iterator[CollectedPaper]:
        """Papers published inside the window that match the search.

        The bulk endpoint returns up to 1,000 papers a page and a continuation
        token for the next page.
        """
        params: dict[str, str | int] = {
            "query": to_semantic_scholar_query(query.text),
            "fields": FIELDS,
            "publicationDateOrYear": f"{window.since.isoformat()}:{window.until.isoformat()}",
        }
        yielded = 0
        while True:
            response = self.fetcher.get(SEARCH_URL, params=params, headers=self.headers)
            body = response.json()
            for item in body.get("data") or []:
                paper = parse_paper(item, query.label)
                if paper is None:
                    continue
                yield paper
                yielded += 1
                if yielded >= max_results:
                    return
            token = body.get("token")
            if not token:
                return
            params["token"] = token

    def fetch_by_ids(self, paper_ids: list[str], label: str = "") -> list[CollectedPaper]:
        """Look up specific papers by id, e.g. "DOI:10.1000/xyz", for the gold-set eval.

        The batch endpoint returns null for ids it doesn't know; those are skipped.
        """
        found: list[CollectedPaper] = []
        for offset in range(0, len(paper_ids), BATCH_SIZE):
            batch = paper_ids[offset:offset + BATCH_SIZE]
            response = self.fetcher.request(
                "POST", BATCH_URL, params={"fields": FIELDS}, headers=self.headers, json={"ids": batch}
            )
            for item in response.json():
                if item is None:
                    continue
                paper = parse_paper(item, label)
                if paper is not None:
                    found.append(paper)
        return found


def parse_paper(item: dict, label: str) -> CollectedPaper | None:
    s2_id = item.get("paperId")
    title = collapse_whitespace(item.get("title") or "")
    if not s2_id or not title:
        return None

    external_ids = item.get("externalIds") or {}
    doi = normalize_doi(external_ids.get("DOI"))
    arxiv_id = normalize_arxiv_id(external_ids.get("ArXiv"))

    authors: list[str] = []
    for author in item.get("authors") or []:
        name = collapse_whitespace(author.get("name") or "")
        if name:
            authors.append(name)

    abstract = collapse_whitespace(item.get("abstract") or "")
    venue = collapse_whitespace(item.get("venue") or "")
    year = item.get("year")

    return CollectedPaper(
        collector="semantic_scholar",
        query_label=label,
        title=title,
        authors=authors,
        year=year if isinstance(year, int) else None,
        published=parse_date(item.get("publicationDate")),
        url=best_url(s2_id, doi, arxiv_id, item.get("url")),
        doi=doi,
        arxiv_id=arxiv_id,
        s2_id=s2_id,
        venue=venue or None,
        source_type=source_type_for(item.get("publicationTypes"), venue, doi, arxiv_id),
        abstract=abstract or None,
    )


def best_url(s2_id: str, doi: str | None, arxiv_id: str | None, s2_url: str | None) -> str:
    """Link to the paper itself where we can: arXiv, then the DOI, then Semantic Scholar's page."""
    if arxiv_id:
        return f"https://arxiv.org/abs/{arxiv_id}"
    if doi:
        return f"https://doi.org/{doi}"
    return s2_url or f"https://www.semanticscholar.org/paper/{s2_id}"


def source_type_for(
    publication_types: list[str] | None, venue: str, doi: str | None, arxiv_id: str | None
) -> SourceType | None:
    for publication_type in publication_types or []:
        if publication_type in SOURCE_TYPE_BY_PUBLICATION_TYPE:
            return SOURCE_TYPE_BY_PUBLICATION_TYPE[publication_type]
    # Only on arXiv, with no journal behind it: a preprint.
    if arxiv_id and not doi and venue.lower() in ("", "arxiv", "arxiv.org"):
        return SourceType.PREPRINT
    return None


def parse_date(text: str | None) -> date | None:
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None
