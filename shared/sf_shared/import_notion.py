"""Import the team's Notion source database into content/sources.json.

Export the Notion database as "Markdown & CSV" (subpages off), then run:

    python -m sf_shared.import_notion path/to/export.csv
    python -m sf_shared.import_notion path/to/export.csv --dry-run

Each Notion row becomes a source with id "s02" for register id "S02".

Notion owns the metadata: title, links, year, source type, technology,
category (problem), claim direction and who added it. Re-running the import
refreshes those. Everything curated on the site side is kept for sources that
already exist: authors, summary, venue, DOI, arXiv id, and the rubric ratings.
Pass --refresh-summaries to overwrite summaries from Notion as well.

Rows whose Resource Type says "screening pending" are skipped until the team
finishes screening them. Sample sources (sample: true) are never touched.
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

CONTENT_PATH = Path(__file__).resolve().parents[2] / "content" / "sources.json"

PROBLEM_BY_CATEGORY = {
    "ai alignment": "alignment",
    "intelligence curse": "intelligence_curse",
    "both": "both",
    "neither": None,
}

TECHNOLOGY_BY_MECHANISM = {
    "bci": "bci",
    "bcis": "bci",
    "whole brain emulation": "wbe",
    "wbe": "wbe",
    "neuromorphic ai": "neuromorphic",
    "neuromorphic": "neuromorphic",
}

# Notion's "Added by" column uses nicknames. The site credits people by the
# name they go by on the site, so a nickname maps to that name here.
CREDITED_NAME_BY_NOTION_NAME = {
    "aila": "Vilija",
}

DIRECTION_BY_CLAIM = {
    "ai alignment": "ai_alignment",
    "ai misalignment": "ai_misalignment",
    "human empowerment": "human_empowerment",
    "human disempowerment": "human_disempowerment",
}

# Checked in order: the first keyword found in the Resource Type wins.
SOURCE_TYPE_KEYWORDS = [
    ("podcast", "podcast"),
    ("presentation", "talk"),
    ("keynote", "talk"),
    ("talk", "talk"),
    ("book", "book"),
    ("arxiv", "preprint"),
    ("preprint", "preprint"),
    ("lesswrong", "forum_post"),
    ("forum", "forum_post"),
    ("blog", "blog"),
    ("substack", "blog"),
    ("report", "report"),
    ("working paper", "report"),
    ("journal", "peer_reviewed"),
    ("peer-reviewed", "peer_reviewed"),
    ("peer reviewed", "peer_reviewed"),
    ("conference", "peer_reviewed"),
]

# Rows whose author field can't be parsed into names. The values come from
# the row itself (S15's summary names the author) or are left empty.
AUTHOR_OVERRIDES = {
    "S15": ["Luke Drago"],
}

URL_PATTERN = re.compile(r"https?://\S+")
DOI_PATTERN = re.compile(r"(10\.\d{4,9}/[^\s?#]+)")
ARXIV_PATTERN = re.compile(r"arxiv\.org/(?:abs|pdf|html)/(\d{4}\.\d{4,5})")
SURNAME_INITIALS_PATTERN = re.compile(r"[A-Z][\w'-]+, (?:[A-Z]\.)+")


def clean_text(text: str) -> str:
    """Collapse line breaks and runs of spaces from Notion's export."""
    return re.sub(r"\s+", " ", text).strip()


def credited_name(text: str) -> str | None:
    """The name to credit for Notion's "Added by" value ("Aila" -> "Vilija")."""
    name = clean_text(text)
    if not name:
        return None
    return CREDITED_NAME_BY_NOTION_NAME.get(name.lower(), name)


def clean_summary(text: str) -> str:
    """Notion exports a hyperlinked word as its bare URL. Put the word back
    when the URL ends in one ("…/basics/neuroplasticity" -> "neuroplasticity")."""
    def link_to_word(match: re.Match) -> str:
        last_part = match.group(0).rstrip("/.,").split("/")[-1]
        if last_part.isalpha():
            return last_part
        return match.group(0)

    return clean_text(URL_PATTERN.sub(link_to_word, text))


def fix_capitals(name: str) -> str:
    """'Yuyu CAO' -> 'Yuyu Cao'. Leaves initials like 'P.' and 'N.A.' alone."""
    words = []
    for word in name.split():
        if len(word) >= 2 and word.isupper() and not word.endswith("."):
            word = word.capitalize()
        words.append(word)
    return " ".join(words)


def parse_authors(raw: str, register_id: str) -> list[str]:
    if register_id in AUTHOR_OVERRIDES:
        return AUTHOR_OVERRIDES[register_id]

    text = clean_text(raw)
    if text in ("", "?") or text.lower().startswith("not verified") or "http" in text:
        return []

    # Drop affiliations and usernames in parentheses, "hosted by ..." (that's
    # the venue, see row_to_source), degrees and "et al."
    text = re.sub(r"\s*\([^)]*\)", "", text)
    text = re.sub(r",?\s*\bhosted by\b.*", "", text, flags=re.IGNORECASE)
    text = re.sub(r",?\s*\bPhD\b", "", text)
    text = re.sub(r"[;,]?\s*et al\.?", "", text)

    names: list[str] = []
    if ";" in text:
        parts = text.split(";")
    elif SURNAME_INITIALS_PATTERN.search(text):
        # "Sorrentino, P., Picek, S., ... Banerjee, T. and Turkmen, F."
        # Initials may have a space between them: "Smith, J. A." -> "J. A. Smith".
        parts = []
        for surname, initials in re.findall(r"([A-Z][\w'-]+), ([A-Z]\.(?: ?[A-Z]\.)*)", text):
            parts.append(f"{initials} {surname}")
    else:
        parts = re.split(r",\s*(?:and\s+)?|\s+and\s+", text)

    for part in parts:
        name = fix_capitals(part.strip())
        if name:
            names.append(name)
    return names


def parse_list(raw: str, mapping: dict, separators: str = r"[,/]") -> tuple[list, list[str]]:
    values: list = []
    unknown: list[str] = []
    # "N/A" means none, and splitting it on "/" would read as two values.
    if clean_text(raw).lower() in ("", "n/a", "na", "none"):
        return values, unknown
    for part in re.split(separators, raw):
        key = clean_text(part).lower()
        if key in ("", "n/a"):
            continue
        if key in mapping:
            value = mapping[key]
            if value not in values:
                values.append(value)
        else:
            unknown.append(clean_text(part))
    return values, unknown


def source_type_for(resource_type: str) -> str | None:
    lowered = resource_type.lower()
    for keyword, source_type in SOURCE_TYPE_KEYWORDS:
        if keyword in lowered:
            return source_type
    return None


def venue_for(url: str) -> str | None:
    if "lesswrong.com" in url:
        return "LessWrong"
    if "alignmentforum.org" in url:
        return "Alignment Forum"
    if "psychologytoday.com" in url:
        return "Psychology Today"
    return None


def row_to_source(row: dict[str, str], warnings: list[str]) -> dict | None:
    register_id = clean_text(row["Source ID"])
    label = register_id or row.get("Resource Title", "?")

    resource_type = clean_text(row["Resource Type"])
    if "screening pending" in resource_type.lower():
        warnings.append(f"{label}: skipped, marked screening pending in Notion")
        return None

    urls = URL_PATTERN.findall(row["Link"])
    if not urls:
        warnings.append(f"{label}: skipped, no link")
        return None

    source_type = source_type_for(resource_type)
    if source_type is None:
        warnings.append(f'{label}: resource type "{resource_type}" not recognized, using "report"')
        source_type = "report"

    category = clean_text(row["Category"]).lower()
    if category not in PROBLEM_BY_CATEGORY:
        warnings.append(f'{label}: category "{row["Category"]}" not recognized, leaving problem empty')
    problem = PROBLEM_BY_CATEGORY.get(category)

    technology, unknown_tech = parse_list(row["Mechanism"], TECHNOLOGY_BY_MECHANISM)
    for value in unknown_tech:
        warnings.append(f'{label}: mechanism "{value}" not recognized')

    directions, unknown_directions = parse_list(row["Claim (+/-)"], DIRECTION_BY_CLAIM, r",")
    for value in unknown_directions:
        warnings.append(f'{label}: claim "{value}" not recognized')

    doi = None
    arxiv_id = None
    for url in urls:
        arxiv_match = ARXIV_PATTERN.search(url)
        if arxiv_match and arxiv_id is None:
            arxiv_id = arxiv_match.group(1)
        doi_match = DOI_PATTERN.search(url)
        if doi_match and doi is None:
            doi = re.sub(r"/(full|abstract|pdf|epdf)$", "", doi_match.group(1))

    venue = venue_for(urls[0])
    # "Tom Burns (hosted by Foresight Institute)": the venue stops at the bracket.
    hosted_by = re.search(r"hosted by ([^)]+)", row["Author(s)"], flags=re.IGNORECASE)
    if hosted_by is not None:
        venue = clean_text(hosted_by.group(1))

    authors = parse_authors(row["Author(s)"], register_id)
    if not authors:
        warnings.append(f"{label}: no author names in Notion")

    return {
        "id": register_id.lower(),
        "register_id": register_id,
        "title": clean_text(row["Resource Title"]),
        "authors": authors,
        "year": int(clean_text(row["Resource Date"])[:4]),
        "url": urls[0].rstrip(".,"),
        "other_urls": [url.rstrip(".,") for url in urls[1:]],
        "doi": doi,
        "arxiv_id": arxiv_id,
        "venue": venue,
        "source_type": source_type,
        "kind": None,
        "technology": technology,
        "problem": problem,
        "claim_directions": directions,
        "evidence_type": None,
        "directness": None,
        "independence": None,
        "relevance": None,
        "credibility": None,
        "credibility_unclear_reason": None,
        "summary": {"text": clean_summary(row["3 sentence summary"]), "provenance": "team"},
        "ai_suggested_fields": [],
        "added_by": credited_name(row["Added by"]),
        "reviewed_by": None,
        "reviewed_on": None,
        "sample": False,
    }


# Fields Notion owns. Everything else on an existing source is kept as curated.
NOTION_FIELDS = [
    "register_id",
    "title",
    "year",
    "url",
    "other_urls",
    "source_type",
    "technology",
    "problem",
    "claim_directions",
    "added_by",
]


def merge(existing: list[dict], imported: list[dict], refresh_summaries: bool) -> tuple[list[dict], list[str]]:
    notes: list[str] = []
    by_id: dict[str, dict] = {}
    for source in existing:
        by_id[source["id"]] = source

    merged = list(existing)
    for new in imported:
        old = by_id.get(new["id"])
        if old is None:
            merged.append(new)
            notes.append(f"added {new['register_id']}: {new['title']}")
            continue
        if old.get("sample"):
            notes.append(f"{new['register_id']}: id {new['id']} belongs to a sample source, not touched")
            continue
        changed = []
        fields = NOTION_FIELDS + (["summary"] if refresh_summaries else [])
        for field_name in fields:
            if old.get(field_name) != new[field_name]:
                old[field_name] = new[field_name]
                changed.append(field_name)
        if changed:
            notes.append(f"updated {new['register_id']}: {', '.join(changed)}")

    imported_ids = {source["id"] for source in imported}
    for source in existing:
        if source.get("register_id") and not source.get("sample") and source["id"] not in imported_ids:
            notes.append(f"{source['register_id']} is on the site but not in this export (left in place)")
    return merged, notes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="show what would change without writing")
    parser.add_argument("--refresh-summaries", action="store_true", help="overwrite summaries with Notion's text")
    args = parser.parse_args()

    warnings: list[str] = []
    imported: list[dict] = []
    with args.csv_path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            source = row_to_source(row, warnings)
            if source is not None:
                imported.append(source)

    existing = json.loads(CONTENT_PATH.read_text(encoding="utf-8"))
    merged, notes = merge(existing, imported, args.refresh_summaries)

    for line in notes:
        print(line)
    for line in warnings:
        print(f"note: {line}")
    print(f"{len(imported)} rows imported, {len(warnings)} notes")

    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    CONTENT_PATH.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {CONTENT_PATH}. Now run: python -m sf_shared.validate content/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
