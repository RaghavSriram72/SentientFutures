"""What every collector returns, and the HTTP plumbing they share.

Each collector asks one research database for papers matching a search, one
page at a time, and yields CollectedPaper objects. The shared HttpFetcher
handles the parts both databases care about: one client, a minimum gap
between requests, a polite User-Agent, and retries with backoff that respect
the Retry-After header.
"""

import email.utils
import random
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel, ConfigDict
from sf_shared.enums import SourceType
from sf_shared.pipeline_models import SearchQuery
from tenacity import RetryCallState, Retrying, retry_if_exception_type, stop_after_attempt

CollectorName = Literal["arxiv", "semantic_scholar"]

REQUEST_TIMEOUT_SECONDS = 30.0
MAX_ATTEMPTS = 4
# Waits are capped so a run keeps sending heartbeats (a run that goes quiet
# for 10 minutes is treated as crashed).
MAX_BACKOFF_SECONDS = 60.0
MAX_RETRY_AFTER_SECONDS = 120.0

Sleep = Callable[[float], None]
Heartbeat = Callable[[], None]


class CollectedPaper(BaseModel):
    """One search result, normalized, before dedupe turns it into a Candidate."""

    model_config = ConfigDict(extra="forbid")

    collector: CollectorName
    query_label: str  # which search found it
    title: str
    authors: list[str]
    year: int | None
    published: date | None
    url: str
    doi: str | None = None  # normalized with sf_shared.normalize
    arxiv_id: str | None = None  # normalized, version stripped
    s2_id: str | None = None
    venue: str | None = None
    source_type: SourceType | None = None
    abstract: str | None = None


@dataclass(frozen=True)
class SearchWindow:
    """The publication dates a run looks at, inclusive."""

    since: date
    until: date

    @classmethod
    def ending_today(cls, lookback_days: int, today: date | None = None) -> "SearchWindow":
        until = today or datetime.now(UTC).date()
        return cls(since=until - timedelta(days=lookback_days), until=until)


class Collector(Protocol):
    name: CollectorName
    display_name: str

    def search(self, query: SearchQuery, window: SearchWindow, max_results: int) -> Iterator[CollectedPaper]: ...


class RetryableHTTPError(Exception):
    """A response worth trying again: rate limited (429) or a server error (5xx)."""

    def __init__(self, response: httpx.Response) -> None:
        super().__init__(f"HTTP {response.status_code} from {response.request.url.host}")
        self.status_code = response.status_code
        self.retry_after = parse_retry_after(response.headers.get("Retry-After"))


def parse_retry_after(value: str | None) -> float | None:
    """Seconds to wait from a Retry-After header, which is either seconds or an HTTP date."""
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return max(0.0, (when - datetime.now(UTC)).total_seconds())


def wait_before_retry(retry_state: RetryCallState) -> float:
    """Use the server's Retry-After when it sent one, otherwise exponential backoff with jitter."""
    error = retry_state.outcome.exception() if retry_state.outcome else None
    if isinstance(error, RetryableHTTPError) and error.retry_after is not None:
        return min(error.retry_after, MAX_RETRY_AFTER_SECONDS)
    backoff = 2.0 ** retry_state.attempt_number  # 2, 4, 8 seconds
    return min(backoff + random.uniform(0, 1), MAX_BACKOFF_SECONDS)


class RateLimiter:
    """Keeps requests at least `interval` seconds apart."""

    def __init__(self, interval: float, sleep: Sleep = time.sleep, clock: Callable[[], float] = time.monotonic) -> None:
        self.interval = interval
        self.sleep = sleep
        self.clock = clock
        self.last_request: float | None = None

    def wait(self) -> None:
        if self.last_request is not None:
            remaining = self.interval - (self.clock() - self.last_request)
            if remaining > 0:
                self.sleep(remaining)
        self.last_request = self.clock()


def make_http_client(
    user_agent: str, *, single_connection: bool = False, transport: httpx.BaseTransport | None = None
) -> httpx.Client:
    """One client per collector, reused for every request it makes. Tests pass a MockTransport."""
    limits = httpx.Limits(max_connections=1, max_keepalive_connections=1) if single_connection else httpx.Limits()
    return httpx.Client(
        headers={"User-Agent": user_agent},
        timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS),
        limits=limits,
        follow_redirects=True,
        transport=transport,
    )


class HttpFetcher:
    """Sends requests through one client, spaced out and retried.

    Retries network errors, 429 and 5xx responses. Other 4xx responses (a bad
    query, a bad key) raise httpx.HTTPStatusError straight away, because
    asking again won't help.
    """

    def __init__(
        self,
        client: httpx.Client,
        *,
        min_interval: float,
        sleep: Sleep = time.sleep,
        heartbeat: Heartbeat | None = None,
        max_attempts: int = MAX_ATTEMPTS,
    ) -> None:
        self.client = client
        self.limiter = RateLimiter(min_interval, sleep=sleep)
        self.sleep = sleep
        self.heartbeat = heartbeat
        self.max_attempts = max_attempts

    def request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, str | int] | None = None,
        headers: dict[str, str] | None = None,
        json: object | None = None,
    ) -> httpx.Response:
        retrying = Retrying(
            stop=stop_after_attempt(self.max_attempts),
            wait=wait_before_retry,
            retry=retry_if_exception_type((httpx.TransportError, RetryableHTTPError)),
            sleep=self.sleep,
            before_sleep=self._before_sleep,
            reraise=True,
        )
        for attempt in retrying:
            with attempt:
                return self._send_once(method, url, params=params, headers=headers, json=json)
        raise AssertionError("unreachable: tenacity either returns or re-raises")

    def get(
        self, url: str, *, params: dict[str, str | int] | None = None, headers: dict[str, str] | None = None
    ) -> httpx.Response:
        return self.request("GET", url, params=params, headers=headers)

    def _send_once(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, str | int] | None,
        headers: dict[str, str] | None,
        json: object | None,
    ) -> httpx.Response:
        self.limiter.wait()
        if self.heartbeat:
            self.heartbeat()
        response = self.client.request(method, url, params=params, headers=headers, json=json)
        if response.status_code == 429 or response.status_code >= 500:
            raise RetryableHTTPError(response)
        response.raise_for_status()
        return response

    def _before_sleep(self, retry_state: RetryCallState) -> None:
        if self.heartbeat:
            self.heartbeat()


def describe_error(error: BaseException) -> str:
    """A short, readable reason for the run log."""
    if isinstance(error, httpx.HTTPStatusError):
        return f"HTTP {error.response.status_code} from {error.request.url.host}"
    if isinstance(error, httpx.TimeoutException):
        return "the request timed out"
    if isinstance(error, httpx.TransportError):
        return f"network error ({type(error).__name__})"
    return str(error) or type(error).__name__


def collapse_whitespace(text: str) -> str:
    return " ".join(text.split())
