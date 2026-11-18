"""Matching a source against others by DOI, arXiv id, link, then title and year."""

from sf_shared.source_match import SourceMatch, index_sources

KNOWN = [
    {"id": "s13", "title": "NeuroAI for AI Safety", "year": 2024, "arxiv_id": "2411.18526", "doi": None},
    {"id": "s19", "title": "Neurosurveillance in the workplace", "year": 2023, "doi": "10.3389/fhumd.2023.1245619"},
    {"id": "sample-x", "title": "A sample source", "year": 2025, "arxiv_id": "0000.00000", "sample": True},
    {
        "id": "s14",
        "title": "Brain-Computer Interfaces and AI Alignment",
        "year": 2021,
        "url": "https://www.lesswrong.com/posts/rpRsksjrBXEDJuHHy/brain-computer-interfaces-and-ai-alignment",
        "other_urls": ["https://example.org/a-related-paper"],
    },
    {"id": "s10", "title": "A talk", "year": 2024, "url": "https://www.youtube.com/watch?v=N3151oVuA7M&t=729s"},
    {"id": "s20", "title": "The Age of Em", "year": 2016, "url": "https://ageofem.com/"},
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


def test_links_match_however_theyre_written():
    index = index_sources(KNOWN)
    lesswrong = "http://lesswrong.com/posts/rpRsksjrBXEDJuHHy/brain-computer-interfaces-and-ai-alignment/#comments"
    assert index.find({"url": lesswrong, "title": "Another title"}) == SourceMatch("s14", "url")
    assert index.find({"url": "https://youtu.be/N3151oVuA7M"}) == SourceMatch("s10", "url")


def test_a_home_page_or_another_url_isnt_a_link_match():
    index = index_sources(KNOWN)
    # A home page doesn't point at one paper, and other_urls can be related work.
    assert index.find({"url": "https://ageofem.com", "title": "Another book"}) is None
    assert index.find({"url": "https://example.org/a-related-paper"}) is None
    # The same site, another page.
    assert index.find({"url": "https://www.lesswrong.com/posts/iWv6Pu2fWPKqevzFE/other"}) is None


def test_samples_never_match():
    index = index_sources(KNOWN)
    assert index.find({"arxiv_id": "0000.00000"}) is None
    assert index.find({"title": "A sample source", "year": 2025}) is None


def test_nothing_to_go_on_is_no_match():
    assert index_sources(KNOWN).find({}) is None
