"""Test doubles: a fake Anthropic client, canned replies, and small builders.

The fake client is for tests only. It never touches the network: each call
to messages.stream records its arguments and plays back the next canned
reply. A Message is the finished reply. An exception is raised when the
stream opens, as the SDK does for an error before the reply starts (after its
own retries). An exception wrapped in MidStream is raised while the reply is
read, as when a connection drops partway.
"""

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import anthropic
import httpx2
from anthropic.types import Message, RefusalStopDetails, TextBlock, Usage
from sf_shared.pipeline_models import Candidate

from sf_pipeline.collectors.base import CollectedPaper
from sf_pipeline.dedupe import to_candidate
from sf_pipeline.store import to_doc

class RecordingSleep:
    """Stands in for time.sleep: records how long it was asked to wait, and returns at once."""

    def __init__(self) -> None:
        self.waits: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)


class MidStream:
    """A canned reply that breaks off after the stream has started."""

    def __init__(self, error: Exception) -> None:
        self.error = error


Reply = Message | Exception | MidStream
ReplyFactory = Callable[[dict], Reply]


class FakeStream:
    """Stands in for the SDK's MessageStream inside `with client.messages.stream(...)`."""

    def __init__(self, reply: Message | MidStream) -> None:
        self.reply = reply

    def __enter__(self) -> "FakeStream":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None

    def get_final_message(self) -> Message:
        if isinstance(self.reply, MidStream):
            raise self.reply.error
        return self.reply


class FakeMessages:
    def __init__(self, replies: list[Reply] | ReplyFactory) -> None:
        self.replies = replies
        self.calls: list[dict] = []

    def stream(self, **kwargs) -> FakeStream:
        self.calls.append(kwargs)
        if callable(self.replies):
            reply = self.replies(kwargs)
        else:
            if not self.replies:
                raise AssertionError("The fake Anthropic client ran out of canned replies")
            reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return FakeStream(reply)


class FakeAnthropic:
    def __init__(self, replies: list[Reply] | ReplyFactory) -> None:
        self.messages = FakeMessages(replies)


def message(
    text: str | None,
    *,
    stop_reason: str = "end_turn",
    input_tokens: int = 400,
    output_tokens: int = 600,
    cache_read: int = 1800,
    cache_write: int = 0,
    refusal_category: str | None = None,
) -> Message:
    content = [TextBlock(type="text", text=text)] if text is not None else []
    details = None
    if stop_reason == "refusal":
        details = RefusalStopDetails(type="refusal", category=refusal_category, explanation="Declined for a test.")
    return Message(
        id="msg_test",
        content=content,
        model="claude-haiku-5-5",
        role="assistant",
        stop_reason=stop_reason,
        stop_details=details,
        type="message",
        usage=Usage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_input_tokens=cache_read,
            cache_creation_input_tokens=cache_write,
        ),
    )


def triage_json(
    relevant: str = "yes",
    *,
    kind: str | None = "argument",
    technology: list[str] | None = None,
    problem: str | None = "alignment",
    claim_directions: list[str] | None = None,
    milestone_ids: list[str] | None = None,
    quote: str = "brain-computer interfaces could give alignment researchers",
    evidence: list[dict] | None = None,
) -> str:
    """A valid answer by default. Unless `evidence` is given, every field with
    a value gets an evidence entry quoting `quote`."""
    technology = ["bci"] if technology is None else technology
    claim_directions = ["ai_alignment"] if claim_directions is None else claim_directions
    if evidence is None:
        evidence = [{"field": "relevant", "reason": "It argues for BCIs as an alignment tool.", "quote": quote}]
        filled = {"kind": kind, "technology": technology, "problem": problem, "claim_directions": claim_directions}
        for name, value in filled.items():
            if value:
                evidence.append({"field": name, "reason": f"Why the {name} fits.", "quote": quote})
    return json.dumps(
        {
            "relevant": relevant,
            "kind": kind,
            "technology": technology,
            "problem": problem,
            "claim_directions": claim_directions,
            "milestone_ids": milestone_ids or [],
            "evidence": evidence,
        }
    )


def no_json(quote: str = "motor imagery") -> str:
    return triage_json(
        "no",
        kind=None,
        technology=[],
        problem=None,
        claim_directions=[],
        evidence=[{"field": "relevant", "reason": "A routine decoding study.", "quote": quote}],
    )


def api_error(error_class: type[anthropic.APIStatusError], status: int, message: str = "test error") -> anthropic.APIStatusError:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx2.Response(status, request=request)
    return error_class(message, response=response, body=None)


def timeout_error() -> anthropic.APITimeoutError:
    """What the SDK raises once every attempt has timed out."""
    return anthropic.APITimeoutError(request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))


def paper(
    *,
    collector: str = "arxiv",
    label: str = "Test search",
    title: str = "Brain-Computer Interfaces as a Channel for Human Feedback",
    year: int | None = 2026,
    doi: str | None = None,
    arxiv_id: str | None = None,
    s2_id: str | None = None,
    abstract: str | None = "We argue that brain-computer interfaces could give alignment researchers a richer feedback signal.",
) -> CollectedPaper:
    if arxiv_id is None and s2_id is None and doi is None:
        arxiv_id = "2610.11111"
    url = f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else "https://example.org/paper"
    return CollectedPaper(
        collector=collector,  # type: ignore[arg-type]
        query_label=label,
        title=title,
        authors=["Ada Example"],
        year=year,
        published=None,
        url=url,
        doi=doi,
        arxiv_id=arxiv_id,
        s2_id=s2_id,
        abstract=abstract,
    )


def insert_candidate(db, collected: CollectedPaper, *, found_minutes_ago: int = 60) -> Candidate:
    """Put a "new" candidate in the database, as a collect stage would."""
    found_at = datetime.now(UTC) - timedelta(minutes=found_minutes_ago)
    candidate = to_candidate(collected, [collected.query_label], [], found_at)
    db["sources"].insert_one(to_doc(candidate))
    return candidate


class FakeReporter:
    """Collects what a stage reports, in place of a RunRecorder and its database document."""

    def __init__(self) -> None:
        self.logs: list[str] = []
        self.errors: list[str] = []
        self.counts: dict[str, int] = {}
        self.cost_usd = 0.0
        self.heartbeats = 0

    def log(self, message: str) -> None:
        self.logs.append(message)

    def error(self, message: str) -> None:
        self.errors.append(message)

    def add_counts(self, **counts: int) -> None:
        for name, amount in counts.items():
            self.counts[name] = self.counts.get(name, 0) + amount

    def add_usage(self, usage, cost: float) -> None:
        self.cost_usd += cost

    def heartbeat(self) -> None:
        self.heartbeats += 1
