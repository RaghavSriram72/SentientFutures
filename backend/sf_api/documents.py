"""Moving records between the shared Pydantic models, MongoDB and JSON.

The convention matches the pipeline's (pipeline/sf_pipeline/store.py): each
document keeps the model's `id` field and also sets `_id` to the same value.
Lookups by `_id` use Mongo's built-in unique index, and the pipeline's lookups
by `id` work on documents the API wrote. `_id` is dropped before anything is
sent out.
"""

from datetime import UTC, date, datetime
from enum import Enum

from flask.json.provider import DefaultJSONProvider
from pydantic import BaseModel


def plain(value: object) -> object:
    """Enums become their string values, all the way down.

    The real MongoDB driver does this on its own, but mongomock stores the enum
    objects as they are, so we convert first and both databases hold the same thing.
    """
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            result[key] = plain(item)
        return result
    if isinstance(value, list):
        items = []
        for item in value:
            items.append(plain(item))
        return items
    return value


def to_document(model: BaseModel) -> dict:
    """A model as a MongoDB document, with `_id` set to its `id`. Datetimes stay datetimes."""
    document = plain(model.model_dump(mode="python"))
    document["_id"] = document["id"]
    return document


def from_document(document: dict | None) -> dict | None:
    """A MongoDB document as a plain dict, without `_id`."""
    if document is None:
        return None
    result = dict(document)
    stored_id = result.pop("_id")
    if "id" not in result:
        result["id"] = stored_id
    return result


def as_utc(moment: datetime) -> datetime:
    """Treat a naive datetime as UTC, so stored and current times always compare."""
    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)


def iso(moment: datetime) -> str:
    """2026-10-27T18:30:00Z"""
    return as_utc(moment).isoformat().replace("+00:00", "Z")


class ApiJSONProvider(DefaultJSONProvider):
    """Flask's JSON, but with ISO 8601 times instead of HTTP-date strings."""

    @staticmethod
    def default(value: object) -> object:
        if isinstance(value, datetime):
            return iso(value)
        if isinstance(value, date):
            return value.isoformat()
        if isinstance(value, Enum):
            return value.value
        return DefaultJSONProvider.default(value)
