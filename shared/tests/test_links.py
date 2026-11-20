"""Links: is_web_link (can it work at all?), names_its_paper (does a doi.org or
arXiv link have its id?) and url_key (the same page however it's written)."""

import pytest

from sf_shared.normalize import is_web_link, names_its_paper, url_key


@pytest.mark.parametrize(
    "url",
    [
        "https://arxiv.org/abs/2411.18526",
        "https://arxiv.org/pdf/2411.18526v3",
        "https://arxiv.org/html/2602.01503v1",
        "https://arxiv.org/abs/2411.18526?context=cs",
        "https://export.arxiv.org/abs/hep-th/9901001",
        "https://doi.org/10.1002/brx2.70035",
        "https://dx.doi.org/10.1002/brx2.70035",
        "https://onlinelibrary.wiley.com/doi/full/10.1002/brx2.70035",
        "https://example.org/paper",
    ],
)
def test_links_that_name_their_paper(url):
    assert names_its_paper(url)


@pytest.mark.parametrize(
    "url",
    ["https://arxiv.org/abs/", "https://arxiv.org/pdf/", "https://arxiv.org/", "https://doi.org/", "https://doi.org/10."],
)
def test_doi_and_arxiv_links_without_a_paper(url):
    assert not names_its_paper(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://doi.org/10.1002/brx2.70035",
        "http://example.org",
        "https://www.youtube.com/watch?v=N3151oVuA7M&t=729s",
        "https://example.org:8080/paper?id=3#part-2",
        "HTTPS://Example.ORG/Paper",
        "https://例え.jp/paper",  # browsers read the host as xn--r8jz45g.jp
    ],
)
def test_working_links(url):
    assert is_web_link(url)


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "https://",
        "http://:80",
        "https://doi.org10.1234",  # a missing slash: urllib reads the host as "doi.org10.1234"
        "https://exa mple.com/paper",
        " https://example.org/paper",
        "example.org/paper",
        "ftp://example.org/paper",
        "https://localhost/paper",
        "https://192.168.0.1/paper",
        "https://example..org/paper",
        "https://example.org:abc/paper",
        "https://under_score.org/paper",
    ],
)
def test_broken_links(url):
    assert not is_web_link(url)


@pytest.mark.parametrize(
    ("url", "key"),
    [
        ("https://www.LessWrong.com/posts/AbC/title/", "lesswrong.com/posts/AbC/title"),
        ("http://lesswrong.com/posts/AbC/title#comments", "lesswrong.com/posts/AbC/title"),
        ("https://m.example.org/paper?utm_source=x&fbclid=y&gclid=z", "example.org/paper"),
        # Some sites name the paper in the query, so the rest of it stays.
        (
            "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123&utm_medium=email",
            "papers.ssrn.com/sol3/papers.cfm?abstract_id=123",
        ),
        ("https://example.org/?p=12", "example.org?p=12"),
        ("https://www.youtube.com/watch?v=N3151oVuA7M&t=729s", "youtube:N3151oVuA7M"),
        ("https://m.youtube.com/watch?v=N3151oVuA7M", "youtube:N3151oVuA7M"),
        ("https://youtu.be/N3151oVuA7M?t=10", "youtube:N3151oVuA7M"),
        ("https://www.youtube.com/embed/N3151oVuA7M", "youtube:N3151oVuA7M"),
        ("https://www.youtube.com/@channel", "youtube.com/@channel"),
    ],
)
def test_url_key(url, key):
    assert url_key(url) == key


def test_different_papers_keep_different_keys():
    assert url_key("https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1") != url_key(
        "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2"
    )
    assert url_key("https://example.org/Paper") != url_key("https://example.org/paper")


@pytest.mark.parametrize("url", ["https://ageofem.com/", "https://ageofem.com", "https://", "not a link", None])
def test_no_key_for_a_home_page_or_a_broken_link(url):
    assert url_key(url) is None
