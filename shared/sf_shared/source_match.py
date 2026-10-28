"""Telling whether two source records are the same paper.

Three places use this and must agree:

    the add-source form (POST /api/sources)   refuses a paper the site already cites
    the source catalog (GET /api/sources/catalog)
                                              leaves out approved papers that repeat one
                                              in content/sources.json
    the publish step (export_site.py)         skips API sources that repeat one in
                                              content/sources.json

Records match on DOI, then arXiv id, then normalized title (with the same year
when both have one). Sample sources are made up, so they never match anything.

Standard library only (through normalize.py), so the publish step can use it.
"""

from dataclasses import dataclass, field

from sf_shared.normalize import normalize_arxiv_id, normalize_doi, title_key


@dataclass(frozen=True)
class SourceMatch:
    id: str  # the id of the record it matched
    field: str  # what matched: "doi", "arxiv_id" or "title"


@dataclass
class SourceIndex:
    by_doi: dict[str, str] = field(default_factory=dict)
    by_arxiv_id: dict[str, str] = field(default_factory=dict)
    by_title: dict[str, list[tuple[int | None, str]]] = field(default_factory=dict)  # title_key -> [(year, id)]

    def add(self, source: dict) -> None:
        """Add one record (a dict with id, doi, arxiv_id, title, year). Samples are skipped."""
        if source.get("sample"):
            return
        source_id = str(source.get("id", ""))
        doi = normalize_doi(source.get("doi"))
        arxiv_id = normalize_arxiv_id(source.get("arxiv_id"))
        if doi is not None and doi not in self.by_doi:
            self.by_doi[doi] = source_id
        if arxiv_id is not None and arxiv_id not in self.by_arxiv_id:
            self.by_arxiv_id[arxiv_id] = source_id
        title = source.get("title")
        if isinstance(title, str):
            key = title_key(title)
            if key != "":
                if key not in self.by_title:
                    self.by_title[key] = []
                self.by_title[key].append((source.get("year"), source_id))

    def find(self, source: dict) -> SourceMatch | None:
        """The first record this one matches, or None."""
        doi = normalize_doi(source.get("doi"))
        if doi is not None and doi in self.by_doi:
            return SourceMatch(id=self.by_doi[doi], field="doi")
        arxiv_id = normalize_arxiv_id(source.get("arxiv_id"))
        if arxiv_id is not None and arxiv_id in self.by_arxiv_id:
            return SourceMatch(id=self.by_arxiv_id[arxiv_id], field="arxiv_id")
        title = source.get("title")
        if not isinstance(title, str):
            return None
        year = source.get("year")
        for known_year, known_id in self.by_title.get(title_key(title), []):
            if year is None or known_year is None or year == known_year:
                return SourceMatch(id=known_id, field="title")
        return None


def index_sources(sources: list[dict]) -> SourceIndex:
    index = SourceIndex()
    for source in sources:
        index.add(source)
    return index


__all__ = ["SourceIndex", "SourceMatch", "index_sources"]
