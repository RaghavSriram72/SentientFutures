"""The Semantic Scholar collector, against canned JSON responses (httpx.MockTransport)."""

import json
from datetime import date
from pathlib import Path

import httpx
from sf_shared.enums import SourceType
from sf_shared.pipeline_models import SearchQuery

from sf_pipeline.collectors.base import SearchWindow, make_http_client
from sf_pipeline.collectors.semantic_scholar import FIELDS, MIN_SECONDS_BETWEEN_REQUESTS, SemanticScholarCollector

FIXTURES = Path(__file__).parent / "fixtures"
QUERY = SearchQuery(label="Neurotech and agency", text='neurotechnology AND ("mental privacy" OR agency)')
WINDOW = SearchWindow(since=date(2026, 10, 13), until=date(2026, 10, 27))


def page(name: str) -> httpx.Response:
    return httpx.Response(200, json=json.loads((FIXTURES / name).read_text(encoding="utf-8")))


def paging_handler(request: httpx.Request) -> httpx.Response:
    return page("s2_page2.json") if request.url.params.get("token") == "NEXT-PAGE-TOKEN" else page("s2_page1.json")


def collector_for(handler, sleep, api_key: str | None = None) -> tuple[SemanticScholarCollector, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = make_http_client("TestAgent/1.0", transport=httpx.MockTransport(record))
    return SemanticScholarCollector(client, api_key=api_key, sleep=sleep), requests


def test_follows_the_continuation_token_and_maps_fields(no_sleep):
    collector, requests = collector_for(paging_handler, no_sleep)
    papers = list(collector.search(QUERY, WINDOW, max_results=100))

    # The fourth result has no title and is skipped.
    assert [paper.s2_id for paper in papers] == ["s2aaa111", "s2bbb222", "s2ccc333"]
    assert len(requests) == 2

    with_arxiv, doi_only, arxiv_only = papers
    assert with_arxiv.arxiv_id == "2610.11111"
    assert with_arxiv.doi == "10.1234/bci.feedback.2026"
    assert with_arxiv.url == "https://arxiv.org/abs/2610.11111"
    assert with_arxiv.source_type == SourceType.PEER_REVIEWED
    assert with_arxiv.authors == ["Ada Example", "Grace Sample"]
    assert with_arxiv.published == date(2026, 10, 18)

    assert doi_only.url == "https://doi.org/10.5555/mental.privacy"
    assert doi_only.abstract is None
    assert doi_only.venue is None
    assert doi_only.source_type is None

    assert arxiv_only.source_type == SourceType.PREPRINT
    assert arxiv_only.year is None


def test_sends_query_fields_and_publication_date_filter(no_sleep):
    collector, requests = collector_for(paging_handler, no_sleep)
    list(collector.search(QUERY, WINDOW, max_results=100))

    params = requests[0].url.params
    assert params["query"] == 'neurotechnology + ("mental privacy" | agency)'
    assert params["fields"] == FIELDS
    assert params["publicationDateOrYear"] == "2026-10-13:2026-10-27"
    assert "token" not in params
    assert requests[1].url.params["token"] == "NEXT-PAGE-TOKEN"


def test_sends_the_api_key_only_when_set(no_sleep):
    collector, requests = collector_for(paging_handler, no_sleep, api_key="secret-key")
    list(collector.search(QUERY, WINDOW, max_results=1))
    assert requests[0].headers["x-api-key"] == "secret-key"

    collector, requests = collector_for(paging_handler, no_sleep)
    list(collector.search(QUERY, WINDOW, max_results=1))
    assert "x-api-key" not in requests[0].headers


def test_keeps_one_second_between_requests(no_sleep):
    collector, _ = collector_for(paging_handler, no_sleep)
    list(collector.search(QUERY, WINDOW, max_results=100))
    assert len(no_sleep.waits) == 1
    assert 0.9 < no_sleep.waits[0] <= MIN_SECONDS_BETWEEN_REQUESTS


def test_stops_at_max_results_without_another_page(no_sleep):
    collector, requests = collector_for(paging_handler, no_sleep)
    papers = list(collector.search(QUERY, WINDOW, max_results=2))
    assert len(papers) == 2
    assert len(requests) == 1


def test_waits_for_retry_after_when_rate_limited(no_sleep):
    responses = [httpx.Response(429, headers={"Retry-After": "5"}), page("s2_page2.json")]
    collector, requests = collector_for(lambda request: responses.pop(0), no_sleep)
    papers = list(collector.search(QUERY, WINDOW, max_results=100))
    assert len(papers) == 1
    assert len(requests) == 2
    assert 5.0 in no_sleep.waits


def test_fetch_by_ids_posts_to_the_batch_endpoint(no_sleep):
    body = json.loads((FIXTURES / "s2_page1.json").read_text(encoding="utf-8"))["data"] + [None]
    collector, requests = collector_for(lambda request: httpx.Response(200, json=body), no_sleep)
    papers = collector.fetch_by_ids(["DOI:10.1234/bci.feedback.2026", "DOI:10.5555/mental.privacy", "DOI:10.0/unknown"])
    assert [paper.s2_id for paper in papers] == ["s2aaa111", "s2bbb222"]
    assert requests[0].method == "POST"
    assert json.loads(requests[0].content) == {
        "ids": ["DOI:10.1234/bci.feedback.2026", "DOI:10.5555/mental.privacy", "DOI:10.0/unknown"]
    }
