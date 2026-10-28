"""Matching a source against others by DOI, arXiv id, then title and year."""

from sf_shared.source_match import SourceMatch, index_sources

KNOWN = [
    {"id": "s13", "title": "NeuroAI for AI Safety", "year": 2024, "arxiv_id": "2411.18526", "doi": None},
    {"id": "s19", "title": "Neurosurveillance in the workplace", "year": 2023, "doi": "10.3389/fhumd.2023.1245619"},
    {"id": "sample-x", "title": "A sample source", "year": 2025, "arxiv_id": "0000.00000", "sample": True},
]


def test_identifiers_match_after_normalizing():
    index = index_sources(KNOWN)
    assert index.find({"doi": "https://doi.org/10.3389/FHUMD.2023.1245619"}) == SourceMatch("s19", "doi")
    assert index.find({"arxiv_id": "arXiv:2411.18526v3"}) == SourceMatch("s13", "arxiv_id")


def test_titles_match_when_the_years_agree_or_one_is_missing():
    index = index_sources(KNOWN)
    assert index.find({"title": "NeuroAI for AI safety!", "year": 2024}) == SourceMatch("s13", "title")
    assert index.find({"title": "neuroai for ai safety", "year": None}) == SourceMatch("s13", "title")
    assert index.find({"title": "NeuroAI for AI Safety", "year": 2019}) is None


def test_samples_never_match():
    index = index_sources(KNOWN)
    assert index.find({"arxiv_id": "0000.00000"}) is None
    assert index.find({"title": "A sample source", "year": 2025}) is None


def test_nothing_to_go_on_is_no_match():
    assert index_sources(KNOWN).find({}) is None
