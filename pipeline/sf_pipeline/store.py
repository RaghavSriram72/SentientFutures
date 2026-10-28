"""How pipeline models are stored in MongoDB.

Each document holds the model's fields as plain values (enums become their
string values, datetimes stay datetimes), plus "_id" set to the model's id so
lookups by id use the primary index. Read a document back with from_doc,
which drops "_id" before validating, because the models forbid extra fields.
"""

from enum import Enum
from typing import TypeVar

from pydantic import BaseModel
from sf_shared.db import create_index_once

ModelT = TypeVar("ModelT", bound=BaseModel)


def plain(value: object) -> object:
    """Enums to their values, all the way down, so the stored document has only plain types."""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [plain(item) for item in value]
    return value


def to_doc(model: BaseModel) -> dict:
    doc = plain(model.model_dump(mode="python"))
    assert isinstance(doc, dict)
    if "id" in doc:
        doc["_id"] = doc["id"]
    return doc


def from_doc(doc: dict, model_class: type[ModelT]) -> ModelT:
    fields = {key: value for key, value in doc.items() if key != "_id"}
    return model_class.model_validate(fields)


def ensure_pipeline_indexes(db) -> None:
    """The indexes the pipeline relies on, in the collections it writes.

    sf_shared.db.ensure_indexes also indexes reviews, which belongs to the API
    (the API calls it at startup). Leaving those out means the pipeline can
    run as a database user that has no access to reviews or users at all
    (see "The database user" in pipeline/README.md). When the indexes already
    exist this only lists them, so after the API's first start the pipeline
    doesn't need to create anything.

    These must match ensure_indexes for the same collections. A test checks.
    """
    sources = db["sources"]
    # Partial unique indexes: only documents where the field is a string take
    # part, so many sources with no DOI don't collide on null.
    for field in ("doi", "arxiv_id", "s2_id"):
        create_index_once(
            sources,
            field,
            name=f"unique_{field}",
            unique=True,
            partialFilterExpression={field: {"$type": "string"}},
        )
    create_index_once(sources, "title_key", name="title_key")
    create_index_once(sources, [("review_status", 1), ("found_at", 1)], name="queue_order")
    create_index_once(db["ai_assessments"], "source_id", name="by_source")
    create_index_once(db["pipeline_runs"], [("started_at", -1)], name="newest_first")
