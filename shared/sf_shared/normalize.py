"""Normalizing titles, paper identifiers and links, so the same paper matches itself.

The pipeline uses these to spot duplicates, and the API uses them when someone
adds a source by hand. Each function returns None for input it can't read,
instead of guessing.

    title_key("Whole-Brain Emulation: A Roadmap")    -> "whole brain emulation a roadmap"
    normalize_doi("https://doi.org/10.1000/ABC.1")   -> "10.1000/abc.1"
    normalize_arxiv_id("arXiv:2411.18526v2")         -> "2411.18526"
    normalize_arxiv_id("hep-th/9901001v1")           -> "hep-th/9901001"
    url_key("https://www.LessWrong.com/posts/abc/")  -> "lesswrong.com/posts/abc"
    url_key("https://youtu.be/N3151oVuA7M?t=729")    -> "youtube:N3151oVuA7M"

is_web_link() says whether a link could work at all: no spaces, and a real
host name. names_its_paper() says whether a doi.org or arXiv link has its DOI
or arXiv id in it. The add-source form uses both.
"""

import re
import unicodedata
from urllib.parse import parse_qs, urlsplit

# A DOI is "10." plus a registrant code, a slash, and a suffix with no spaces.
DOI_PATTERN = re.compile(r"10\.\d{4,9}/\S+")
DOI_PREFIXES = ("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:")

# New-style arXiv ids (2007 on): 2411.18526, optionally with a version.
NEW_ARXIV_PATTERN = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?")
# Old-style ids: an archive name, optionally a subject class, a slash and 7 digits.
OLD_ARXIV_PATTERN = re.compile(r"([a-z\-]+(?:\.[a-z]{2})?/\d{7})(v\d+)?", re.IGNORECASE)
ARXIV_URL_PATTERN = re.compile(r"arxiv\.org/(?:abs|pdf|html)/(.+?)(?:\.pdf)?/?$", re.IGNORECASE)
# Links on these hosts only open a paper when they carry its DOI or arXiv id.
DOI_HOSTS = ("doi.org", "dx.doi.org")
ARXIV_HOSTS = ("arxiv.org", "www.arxiv.org", "export.arxiv.org")

# One part of a host name, like "www", "doi" or "org".
HOST_LABEL_PATTERN = re.compile(r"[a-z0-9-]+")
# Query parameters that only say where a click came from. Every utm_* one is dropped too.
TRACKING_PARAMETERS = ("fbclid", "gclid")
# youtube.com/embed/<id>, /shorts/<id> and /live/<id> are the same video as watch?v=<id>.
YOUTUBE_VIDEO_PATHS = ("/embed/", "/shorts/", "/live/")


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


def is_web_link(url: str | None) -> bool:
    """True for an http or https link with a real host name, like https://doi.org/10.1000/xyz.

    The link has no spaces, and its host has at least two parts made of
    letters, digits and hyphens, the last one with a letter in it. That last
    rule catches a missing slash like "https://doi.org10.1234", which urllib
    reads as the host "doi.org10.1234".
    """
    if not isinstance(url, str) or url == "":
        return False
    for char in url:
        if char.isspace():
            return False
    try:
        parts = urlsplit(url)
        if parts.port == 0:
            return False
    except ValueError:
        # Not a link urllib can read, or a port that isn't a number ("https://example.com:abc").
        return False
    if parts.scheme not in ("http", "https"):
        return False
    host = parts.hostname  # lowercased, without the port
    if host is None:
        return False
    try:
        # A name like "例え.jp" is checked in its ASCII form ("xn--r8jz45g.jp"), as browsers do.
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        return False
    labels = host.split(".")
    if len(labels) < 2:
        return False
    for label in labels:
        if HOST_LABEL_PATTERN.fullmatch(label) is None:
            return False
    return re.search(r"[a-z]", labels[-1]) is not None


def names_its_paper(url: str) -> bool:
    """False for a doi.org or arXiv link with no DOI or arXiv id in it, like "https://arxiv.org/abs/".

    Those open a search or an error page, not a paper. Every other link passes.
    The query and #fragment are left out of the arXiv check, so
    "https://arxiv.org/abs/2411.18526?context=cs" still names its paper.
    """
    parts = urlsplit(url.strip())
    host = parts.hostname or ""
    if host in DOI_HOSTS:
        return normalize_doi(url) is not None
    if host in ARXIV_HOSTS:
        return normalize_arxiv_id(host + parts.path) is not None
    return True


def youtube_video_id(host: str, path: str, query: str) -> str | None:
    """The video id of a youtube.com or youtu.be link, or None if it isn't a video link."""
    if host == "youtu.be":
        video_id = path.strip("/").split("/")[0]
    elif path.rstrip("/") == "/watch":
        values = parse_qs(query).get("v", [])
        video_id = values[0] if len(values) > 0 else ""
    else:
        video_id = ""
        for prefix in YOUTUBE_VIDEO_PATHS:
            if path.startswith(prefix):
                video_id = path[len(prefix):].strip("/").split("/")[0]
    if video_id == "":
        return None
    return video_id


def url_key(url: str | None) -> str | None:
    """A link without the parts that differ between copies of the same link, or None.

    The scheme, a leading "www." or "m.", the #fragment, a trailing slash and
    tracking parameters (utm_*, fbclid, gclid) are dropped, and the host is
    lowercased. The rest stays as it is: paths are case-sensitive on many
    sites, and some name the paper in the query (papers.cfm?abstract_id=123).
    A YouTube video becomes "youtube:<id>", however it's linked.

    A bare domain like https://ageofem.com/ is None, because a home page
    doesn't point at one paper.
    """
    if not isinstance(url, str) or not is_web_link(url.strip()):
        return None
    parts = urlsplit(url.strip())
    host = parts.hostname or ""
    for prefix in ("www.", "m."):
        if host.startswith(prefix):
            host = host[len(prefix):]
            break
    if parts.port is not None:
        host = f"{host}:{parts.port}"

    if host == "youtube.com" or host == "youtu.be":
        video_id = youtube_video_id(host, parts.path, parts.query)
        if video_id is not None:
            return "youtube:" + video_id

    kept = []
    for piece in parts.query.split("&"):
        name = piece.split("=", 1)[0].lower()
        if piece == "" or name.startswith("utm_") or name in TRACKING_PARAMETERS:
            continue
        kept.append(piece)
    path = parts.path.rstrip("/")
    if path == "" and len(kept) == 0:
        return None
    if len(kept) == 0:
        return host + path
    return host + path + "?" + "&".join(kept)


__all__ = ["is_web_link", "names_its_paper", "normalize_arxiv_id", "normalize_doi", "title_key", "url_key"]
