"""Normalizing titles and paper identifiers, so the same paper matches itself.

The pipeline uses these to spot duplicates, and the API uses them when someone
adds a source by hand. Each function returns None for input it can't read,
instead of guessing.

    title_key("Whole-Brain Emulation: A Roadmap")    -> "whole brain emulation a roadmap"
    normalize_doi("https://doi.org/10.1000/ABC.1")   -> "10.1000/abc.1"
    normalize_arxiv_id("arXiv:2411.18526v2")         -> "2411.18526"
    normalize_arxiv_id("hep-th/9901001v1")           -> "hep-th/9901001"
"""

import re
import unicodedata

# A DOI is "10." plus a registrant code, a slash, and a suffix with no spaces.
DOI_PATTERN = re.compile(r"10\.\d{4,9}/\S+")
DOI_PREFIXES = ("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:")

# New-style arXiv ids (2007 on): 2411.18526, optionally with a version.
NEW_ARXIV_PATTERN = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?")
# Old-style ids: an archive name, optionally a subject class, a slash and 7 digits.
OLD_ARXIV_PATTERN = re.compile(r"([a-z\-]+(?:\.[a-z]{2})?/\d{7})(v\d+)?", re.IGNORECASE)
ARXIV_URL_PATTERN = re.compile(r"arxiv\.org/(?:abs|pdf|html)/(.+?)(?:\.pdf)?/?$", re.IGNORECASE)


def title_key(title: str) -> str:
    """Lowercase letters and digits only, single spaces, accents removed.

    Punctuation, dashes and case differ between databases for the same paper,
    so they're dropped before comparing.
    """
    decomposed = unicodedata.normalize("NFKD", title)
    without_accents = "".join(char for char in decomposed if not unicodedata.combining(char))
    lowered = without_accents.casefold()
    words = re.split(r"[^0-9a-z]+", lowered)
    return " ".join(word for word in words if word)


def normalize_doi(value: str | None) -> str | None:
    """The bare DOI in lowercase (DOIs are case-insensitive), or None."""
    if not value:
        return None
    text = value.strip()
    lowered = text.lower()
    for prefix in DOI_PREFIXES:
        if lowered.startswith(prefix):
            text = text[len(prefix):]
            break
    match = DOI_PATTERN.search(text)
    if match is None:
        return None
    # Trailing punctuation usually comes from the sentence around a pasted DOI.
    return match.group(0).rstrip(".,;)").lower()


def normalize_arxiv_id(value: str | None) -> str | None:
    """The arXiv id without its version ("v2"), or None.

    Accepts a bare id, "arXiv:..." and abs, pdf or html URLs.
    """
    if not value:
        return None
    text = value.strip()
    url_match = ARXIV_URL_PATTERN.search(text)
    if url_match:
        text = url_match.group(1)
    if text.lower().startswith("arxiv:"):
        text = text[len("arxiv:"):]

    new_match = NEW_ARXIV_PATTERN.fullmatch(text)
    if new_match:
        return new_match.group(1)
    old_match = OLD_ARXIV_PATTERN.fullmatch(text)
    if old_match:
        return old_match.group(1)
    return None


__all__ = ["normalize_arxiv_id", "normalize_doi", "title_key"]
