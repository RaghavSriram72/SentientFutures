"""The arXiv collector, against canned Atom responses (httpx.MockTransport)."""

from datetime import date
from pathlib import Path

import httpx
import pytest
from sf_shared.enums import SourceType
from sf_shared.pipeline_models import SearchQuery

from sf_pipeline.collectors import arxiv
from sf_pipeline.collectors.arxiv import ArxivCollector, ArxivError
from sf_pipeline.collectors.base import SearchWindow, make_http_client

FIXTURES = Path(__file__).parent / "fixtures"
QUERY = SearchQuery(label="BCI and alignment", text='"brain-computer interface" AND alignment')
WINDOW = SearchWindow(since=date(2026, 10, 13), until=date(2026, 10, 27))


def atom(name: str) -> httpx.Response:
    return httpx.Response(200, text=(FIXTURES / name).read_text(encoding="utf-8"))


def collector_for(handler, sleep) -> tuple[ArxivCollector, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = make_http_client("TestAgent/1.0 (contact: tests@example.invalid)", transport=httpx.MockTransport(record))
    return ArxivCollector(client, sleep=sleep), requests


def test_parses_entries_and_pages_through_results(monkeypatch, no_sleep):
    monkeypatch.setattr(arxiv, "PAGE_SIZE", 2)

    def handler(request: httpx.Request) -> httpx.Response:
        start = request.url.params["start"]
        return atom("arxiv_page1.xml") if start == "0" else atom("arxiv_page2.xml")

    collector, requests = collector_for(handler, no_sleep)
    papers = list(collector.search(QUERY, WINDOW, max_results=50))

    assert [paper.arxiv_id for paper in papers] == ["2610.11111", "2610.22222", "hep-th/9901001"]
    assert len(requests) == 2
    first = papers[0]
    assert first.title == "Brain-Computer Interfaces as a Channel for Human Feedback"
    assert first.abstract == "We argue that brain-computer interfaces could give alignment researchers a richer feedback signal."
    assert first.authors == ["Ada Example", "Grace Sample"]
    assert first.doi == "10.1234/bci.feedback.2026"
    assert first.venue == "Journal of Examples 12, 34 (2026)"
    assert first.published == date(2026, 10, 18)
    assert first.year == 2026
    assert first.url == "https://arxiv.org/abs/2610.11111"
    assert first.source_type == SourceType.PREPRINT
    assert first.collector == "arxiv"
    assert first.query_label == "BCI and alignment"
    assert papers[1].doi is None and papers[1].venue is None


def test_sends_the_translated_query_with_a_date_window(no_sleep):
    collector, requests = collector_for(lambda request: atom("arxiv_page2.xml"), no_sleep)
    list(collector.search(QUERY, WINDOW, max_results=50))

    params = requests[0].url.params
    assert params["search_query"] == (
        '(all:"brain-computer interface" AND all:alignment) AND submittedDate:[202610130000 TO 202610272359]'
    )
    assert params["sortBy"] == "submittedDate"
    assert params["sortOrder"] == "descending"
    assert requests[0].headers["User-Agent"] == "TestAgent/1.0 (contact: tests@example.invalid)"


def test_stops_at_max_results(no_sleep):
    collector, requests = collector_for(lambda request: atom("arxiv_page1.xml"), no_sleep)
    papers = list(collector.search(QUERY, WINDOW, max_results=1))
    assert len(papers) == 1
    assert requests[0].url.params["max_results"] == "1"


def test_waits_more_than_three_seconds_between_requests(monkeypatch, no_sleep):
    monkeypatch.setattr(arxiv, "PAGE_SIZE", 2)

    def handler(request: httpx.Request) -> httpx.Response:
        return atom("arxiv_page1.xml") if request.url.params["start"] == "0" else atom("arxiv_page2.xml")

    collector, _ = collector_for(handler, no_sleep)
    list(collector.search(QUERY, WINDOW, max_results=50))
    # The first request goes straight away; the second waits out the gap.
    assert len(no_sleep.waits) == 1
    assert 3.0 < no_sleep.waits[0] <= arxiv.MIN_SECONDS_BETWEEN_REQUESTS


def test_retries_a_server_error_with_backoff(no_sleep):
    responses = [httpx.Response(503), atom("arxiv_page2.xml")]
    collector, requests = collector_for(lambda request: responses.pop(0), no_sleep)
    papers = list(collector.search(QUERY, WINDOW, max_results=50))
    assert len(papers) == 1
    assert len(requests) == 2
    assert any(2.0 <= wait <= 3.0 for wait in no_sleep.waits)  # the first backoff is 2 seconds plus jitter


def test_respects_retry_after(no_sleep):
    responses = [httpx.Response(429, headers={"Retry-After": "7"}), atom("arxiv_page2.xml")]
    collector, _ = collector_for(lambda request: responses.pop(0), no_sleep)
    list(collector.search(QUERY, WINDOW, max_results=50))
    assert 7.0 in no_sleep.waits


def test_gives_up_after_the_last_attempt(no_sleep):
    collector, requests = collector_for(lambda request: httpx.Response(503), no_sleep)
    with pytest.raises(Exception):
        list(collector.search(QUERY, WINDOW, max_results=50))
    assert len(requests) == 4


def test_does_not_retry_a_bad_request(no_sleep):
    collector, requests = collector_for(lambda request: httpx.Response(400), no_sleep)
    with pytest.raises(httpx.HTTPStatusError):
        list(collector.search(QUERY, WINDOW, max_results=50))
    assert len(requests) == 1


def test_an_error_entry_raises(no_sleep):
    collector, _ = collector_for(lambda request: atom("arxiv_error.xml"), no_sleep)
    with pytest.raises(ArxivError, match="incorrect id format"):
        list(collector.search(QUERY, WINDOW, max_results=50))


def test_asks_again_once_when_arxiv_returns_an_empty_page(no_sleep):
    empty = '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>1</opensearch:totalResults></feed>'
    responses = [httpx.Response(200, text=empty), atom("arxiv_page2.xml")]
    collector, requests = collector_for(lambda request: responses.pop(0), no_sleep)
    papers = list(collector.search(QUERY, WINDOW, max_results=50))
    assert len(papers) == 1
    assert len(requests) == 2


def test_fetch_by_ids_uses_id_list(no_sleep):
    collector, requests = collector_for(lambda request: atom("arxiv_page1.xml"), no_sleep)
    papers = collector.fetch_by_ids(["2610.11111", "2610.22222"])
    assert len(papers) == 2
    assert requests[0].url.params["id_list"] == "2610.11111,2610.22222"
