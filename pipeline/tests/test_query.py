"""Translating the team's search text into arXiv and Semantic Scholar syntax."""

import pytest
from sf_shared.pipeline_models import DEFAULT_QUERIES

from sf_pipeline.collectors.query import QuerySyntaxError, to_arxiv_query, to_semantic_scholar_query


def test_arxiv_searches_all_fields_and_keeps_grouping():
    text = '"brain-computer interface" AND (alignment OR "AI safety")'
    assert to_arxiv_query(text) == 'all:"brain-computer interface" AND (all:alignment OR all:"AI safety")'


def test_semantic_scholar_uses_plus_and_bar():
    text = '"brain-computer interface" AND (alignment OR "AI safety")'
    assert to_semantic_scholar_query(text) == '"brain-computer interface" + (alignment | "AI safety")'


def test_words_side_by_side_mean_and():
    assert to_arxiv_query("brain emulation") == "all:brain AND all:emulation"
    assert to_semantic_scholar_query("brain emulation") == "brain + emulation"


def test_not_becomes_andnot_on_arxiv_and_a_minus_on_semantic_scholar():
    assert to_arxiv_query("brain AND NOT (mouse OR rat)") == "all:brain ANDNOT (all:mouse OR all:rat)"
    assert to_semantic_scholar_query("brain NOT mouse") == "brain -mouse"
    assert to_semantic_scholar_query("brain AND NOT (mouse OR rat)") == "brain -(mouse | rat)"


def test_operators_can_be_lower_case():
    assert to_arxiv_query("bci or neuromorphic") == "all:bci OR all:neuromorphic"


def test_hyphenated_words_are_quoted():
    assert to_arxiv_query("brain-inspired") == 'all:"brain-inspired"'
    assert to_semantic_scholar_query("brain-inspired") == '"brain-inspired"'


@pytest.mark.parametrize(
    "text",
    ["", "NOT mouse", "brain AND", "OR brain", "(brain", "brain)", "brain OR OR bci", "brain OR ()", "(brain OR)"],
)
def test_bad_searches_raise_a_readable_error(text):
    with pytest.raises(QuerySyntaxError):
        to_arxiv_query(text)


def test_every_default_search_translates():
    for query in DEFAULT_QUERIES:
        assert to_arxiv_query(query.text)
        assert to_semantic_scholar_query(query.text)


def test_the_neuromorphic_search_asks_for_ai_safety_and_leaves_out_device_physics():
    text = ""
    for query in DEFAULT_QUERIES:
        if query.label == "Neuromorphic AI and safety":
            text = query.text
    # Each exclusion is its own NOT, which both sites support for single terms.
    assert to_arxiv_query(text) == (
        'all:neuromorphic AND (all:"AI safety" OR all:alignment OR all:"AI governance") '
        "ANDNOT all:ferroelectric ANDNOT all:supercapacitor"
    )
    assert to_semantic_scholar_query(text) == (
        'neuromorphic + ("AI safety" | alignment | "AI governance") -ferroelectric -supercapacitor'
    )
