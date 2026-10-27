"""The Notion import (import_notion.py): reading one row, merging into sources.json, and the command.

Rows are written inline in the shape csv.DictReader gives them, with the
column names of the team's Notion export. Nothing here reads or writes the
real content/sources.json: the command test points the import at tmp_path.
"""

import json
import sys
from pathlib import Path

import pytest
from helpers import model_errors, read_json, run, sample_source, write_json

from sf_shared import import_notion
from sf_shared.import_notion import (
    DIRECTION_BY_CLAIM,
    TECHNOLOGY_BY_MECHANISM,
    merge,
    parse_authors,
    parse_list,
    row_to_source,
    source_type_for,
)
from sf_shared.models import Source


def notion_row(changes: dict[str, str] | None = None) -> dict[str, str]:
    """One row of the export. Pass the columns that should differ from this default."""
    row = {
        "Source ID": "S40",
        "Resource Title": "A test paper on neural feedback",
        "Resource Type": "Journal article",
        "Link": "https://doi.org/10.1000/test.123",
        "Category": "AI Alignment",
        "Mechanism": "BCI",
        "Claim (+/-)": "AI Alignment",
        "Author(s)": "Ada Lovelace, Alan Turing",
        "Resource Date": "2024",
        "3 sentence summary": "The team's own summary.",
        "Added by": "Aila",
    }
    if changes is not None:
        row.update(changes)
    return row


def import_row(changes: dict[str, str] | None = None) -> tuple[dict | None, list[str]]:
    warnings: list[str] = []
    source = row_to_source(notion_row(changes), warnings)
    return source, warnings


# ---------------------------------------------------------------------------
# Authors


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # "Surname, I." lists, as in S07. "N.A." is two initials.
        (
            "Sorrentino, P., Picek, S., Anagnostopoulos, N.A., Banerjee, T. and Turkmen, F.",
            ["P. Sorrentino", "S. Picek", "N.A. Anagnostopoulos", "T. Banerjee", "F. Turkmen"],
        ),
        # The same with a space between initials, the way APA writes them.
        ("Smith, J. A., Doe, R.", ["J. A. Smith", "R. Doe"]),
        # All-caps surnames, as in S04, including two-letter ones.
        ("Yuyu CAO, Hengyuan YANG, Tianwen LI, Yunfa FU", ["Yuyu Cao", "Hengyuan Yang", "Tianwen Li", "Yunfa Fu"]),
        # Initials are left alone.
        ("P. S. Aithal, Sapathy J.", ["P. S. Aithal", "Sapathy J."]),
        # Affiliations and usernames in parentheses are dropped.
        ("Thorsten Zander (Zander Labs)", ["Thorsten Zander"]),
        ("Robbo (LessWrong user)", ["Robbo"]),
        ("Tom Burns (hosted by Foresight Institute)", ["Tom Burns"]),
        # Degrees and "et al." are dropped.
        ("Lisa Thiergart, PhD", ["Lisa Thiergart"]),
        ("Lisa Thiergart PhD", ["Lisa Thiergart"]),
        ("Patrick Mineault, Niccolò Zanichelli, et al.", ["Patrick Mineault", "Niccolò Zanichelli"]),
        ("Patrick Mineault et al", ["Patrick Mineault"]),
        # Separators: commas, "and", a serial comma before "and", semicolons.
        ("Benjamin Poole and Minwoo Lee", ["Benjamin Poole", "Minwoo Lee"]),
        (
            "Aline Xavier Fidêncio, Christian Klaes, and Ioannis Iossifidis",
            ["Aline Xavier Fidêncio", "Christian Klaes", "Ioannis Iossifidis"],
        ),
        ("Can Rager; Kyle Webster", ["Can Rager", "Kyle Webster"]),
        # An organization stays one name.
        ("Foresight Institute", ["Foresight Institute"]),
    ],
)
def test_author_names(raw: str, expected: list[str]):
    assert parse_authors(raw, "S40") == expected


@pytest.mark.parametrize(
    "raw",
    ["", "?", "  ? ", "Not verified", "https://www.lesswrong.com/users/example", "See https://example.org/about"],
)
def test_author_field_without_names_gives_an_empty_list(raw: str):
    # An empty list means "authors unknown", which the site can say. A URL or
    # "?" would show up as someone's name.
    assert parse_authors(raw, "S40") == []


def test_author_override_wins():
    # S15's author field has no name in it. The override comes from its summary.
    assert parse_authors("https://www.intelligence-curse.ai", "S15") == ["Luke Drago"]


def test_row_without_author_names_still_imports_with_a_note():
    source, warnings = import_row({"Author(s)": "?"})
    assert source is not None
    assert source["authors"] == []
    assert warnings == ["S40: no author names in Notion"]


# ---------------------------------------------------------------------------
# Mechanism, claim direction and resource type


@pytest.mark.parametrize("raw", ["N/A", "n/a", "NA", "None", "", "  "])
def test_mechanism_meaning_none_gives_no_technology(raw: str):
    # Splitting "N/A" on its slash would read as two unknown values.
    assert parse_list(raw, TECHNOLOGY_BY_MECHANISM) == ([], [])


def test_mechanism_na_row_imports_as_general_background():
    source, warnings = import_row({"Mechanism": "N/A"})
    assert source is not None
    assert source["technology"] == []
    assert warnings == []


def test_mechanism_list_keeps_order_and_reports_unknown_values():
    values, unknown = parse_list("BCIs/Whole Brain Emulation, BCI, quantum", TECHNOLOGY_BY_MECHANISM)
    assert values == ["bci", "wbe"]
    assert unknown == ["quantum"]


def test_claim_directions_split_on_commas_only():
    values, unknown = parse_list("AI Alignment, Human Disempowerment", DIRECTION_BY_CLAIM, r",")
    assert values == ["ai_alignment", "human_disempowerment"]
    assert unknown == []


@pytest.mark.parametrize(
    ("resource_type", "expected"),
    [
        ("Keynote presentation", "talk"),
        ("Workshop talk", "talk"),
        ("Podcast episode", "podcast"),
        ("Book", "book"),
        ("arXiv preprint", "preprint"),
        ("LessWrong post", "forum_post"),
        ("Substack essay", "blog"),
        ("Working paper", "report"),
        ("Peer-reviewed journal article", "peer_reviewed"),
        ("Conference paper", "peer_reviewed"),
        ("Interpretive dance", None),
    ],
)
def test_source_type_from_resource_type(resource_type: str, expected: str | None):
    assert source_type_for(resource_type) == expected


def test_unknown_resource_type_falls_back_to_report():
    source, warnings = import_row({"Resource Type": "Interpretive dance"})
    assert source is not None
    assert source["source_type"] == "report"
    assert warnings == ['S40: resource type "Interpretive dance" not recognized, using "report"']


# ---------------------------------------------------------------------------
# One row


def test_row_becomes_an_unrated_source():
    source, warnings = import_row()
    assert warnings == []
    assert source is not None
    assert source["id"] == "s40"
    assert source["register_id"] == "S40"
    assert source["authors"] == ["Ada Lovelace", "Alan Turing"]
    assert source["year"] == 2024
    assert source["doi"] == "10.1000/test.123"
    assert source["technology"] == ["bci"]
    assert source["problem"] == "alignment"
    assert source["claim_directions"] == ["ai_alignment"]
    assert source["summary"] == {"text": "The team's own summary.", "provenance": "team"}
    assert source["added_by"] == "Aila"
    assert source["sample"] is False

    # The team's database has no rubric ratings, and the import never guesses them.
    for field_name in ["kind", "evidence_type", "directness", "independence", "relevance", "credibility"]:
        assert source[field_name] is None
    assert source["ai_suggested_fields"] == []


def test_imported_source_passes_the_schema():
    source, _ = import_row()
    assert model_errors(Source, source) == []


def test_source_with_nothing_rated_or_known_passes_the_schema():
    # Unknown authors, general background (no technology), and no ratings at all.
    source, _ = import_row({"Author(s)": "?", "Mechanism": "N/A", "Category": "Neither", "Claim (+/-)": ""})
    assert source is not None
    assert source["authors"] == []
    assert source["technology"] == []
    assert source["problem"] is None
    assert source["claim_directions"] == []
    assert model_errors(Source, source) == []


def test_screening_pending_row_is_skipped():
    source, warnings = import_row({"Resource Type": "Journal article (Screening pending)"})
    assert source is None
    assert warnings == ["S40: skipped, marked screening pending in Notion"]


def test_row_without_a_link_is_skipped():
    source, warnings = import_row({"Link": "see the shared drive"})
    assert source is None
    assert warnings == ["S40: skipped, no link"]


def test_links_arxiv_id_and_other_urls():
    links = "https://arxiv.org/abs/2411.18526v2, https://www.example.org/write-up."
    source, _ = import_row({"Link": links, "Resource Type": "arXiv preprint"})
    assert source is not None
    assert source["url"] == "https://arxiv.org/abs/2411.18526v2"
    assert source["other_urls"] == ["https://www.example.org/write-up"]
    assert source["arxiv_id"] == "2411.18526"
    assert source["doi"] is None


def test_doi_drops_a_trailing_page_name():
    source, _ = import_row({"Link": "https://www.frontiersin.org/articles/10.3389/fnins.2022.123456/full"})
    assert source is not None
    assert source["doi"] == "10.3389/fnins.2022.123456"


def test_venue_from_the_link():
    source, _ = import_row({"Link": "https://www.lesswrong.com/posts/abc/a-post"})
    assert source is not None
    assert source["venue"] == "LessWrong"


@pytest.mark.parametrize(
    "authors",
    [
        "Tom Burns (hosted by Foresight Institute)",
        "Tom Burns (Hosted by Foresight Institute)",
        "Tom Burns, hosted by Foresight Institute",
    ],
)
def test_venue_from_hosted_by(authors: str):
    source, _ = import_row({"Author(s)": authors})
    assert source is not None
    assert source["venue"] == "Foresight Institute"
    assert source["authors"] == ["Tom Burns"]


def test_summary_link_goes_back_to_its_word():
    # Notion exports a linked word as its bare URL.
    text = "It may change\nhttps://www.example.org/basics/neuroplasticity over time."
    source, _ = import_row({"3 sentence summary": text})
    assert source is not None
    assert source["summary"]["text"] == "It may change neuroplasticity over time."


# ---------------------------------------------------------------------------
# Merging into sources.json


def imported_source(changes: dict[str, str] | None = None) -> dict:
    source, _ = import_row(changes)
    assert source is not None
    return source


def test_new_source_is_added_at_the_end():
    existing = [sample_source()]
    merged, notes = merge(existing, [imported_source()], refresh_summaries=False)
    assert [source["id"] for source in merged] == ["sample-roadmap-report", "s40"]
    assert notes == ["added S40: A test paper on neural feedback"]


def test_reimport_keeps_curated_fields_and_refreshes_notion_ones():
    curated = imported_source()
    curated["summary"] = {"text": "Our edited summary.", "provenance": "team"}
    curated["authors"] = ["Ada King", "Alan Turing"]
    curated["venue"] = "Journal of Tests"
    curated["evidence_type"] = "experiment"

    changes = {"Resource Title": "A renamed test paper", "3 sentence summary": "Notion's newer summary."}
    merged, notes = merge([curated], [imported_source(changes)], refresh_summaries=False)

    assert len(merged) == 1
    source = merged[0]
    assert source["title"] == "A renamed test paper"
    assert source["summary"] == {"text": "Our edited summary.", "provenance": "team"}
    assert source["authors"] == ["Ada King", "Alan Turing"]
    assert source["venue"] == "Journal of Tests"
    assert source["evidence_type"] == "experiment"
    assert notes == ["updated S40: title"]


def test_refresh_summaries_replaces_the_summary_but_keeps_authors():
    curated = imported_source()
    curated["summary"] = {"text": "Our edited summary.", "provenance": "team"}
    curated["authors"] = ["Ada King", "Alan Turing"]

    changes = {"3 sentence summary": "Notion's newer summary."}
    merged, notes = merge([curated], [imported_source(changes)], refresh_summaries=True)

    assert merged[0]["summary"] == {"text": "Notion's newer summary.", "provenance": "team"}
    assert merged[0]["authors"] == ["Ada King", "Alan Turing"]
    assert notes == ["updated S40: summary"]


def test_reimporting_the_same_export_changes_nothing():
    first, _ = merge([], [imported_source()], refresh_summaries=False)
    before = json.dumps(first)
    second, notes = merge(first, [imported_source()], refresh_summaries=False)
    assert json.dumps(second) == before
    assert notes == []


def test_sample_source_with_the_same_id_is_not_touched():
    sample = sample_source()
    sample["id"] = "s40"
    merged, notes = merge([sample], [imported_source()], refresh_summaries=False)
    assert merged == [sample]
    assert merged[0]["title"] == sample_source()["title"]
    assert notes == ["S40: id s40 belongs to a sample source, not touched"]


def test_source_missing_from_the_export_is_left_in_place():
    older = imported_source({"Source ID": "S41"})
    merged, notes = merge([older], [imported_source()], refresh_summaries=False)
    assert [source["id"] for source in merged] == ["s41", "s40"]
    assert notes == [
        "added S40: A test paper on neural feedback",
        "S41 is on the site but not in this export (left in place)",
    ]


# ---------------------------------------------------------------------------
# register_id in the schema and the validator


@pytest.mark.parametrize("register_id", ["s02", "S2", "S-02", "02", "S02a"])
def test_register_id_must_look_like_s02(register_id: str):
    source = imported_source()
    source["register_id"] = register_id
    assert model_errors(Source, source) == [
        'record.register_id: must look like "S02": a capital S and at least two digits'
    ]


def test_register_id_can_be_left_out():
    # Sources that aren't in the team's register (like the samples) have none.
    source = sample_source()
    source.pop("register_id", None)
    assert model_errors(Source, source) == []
    source["register_id"] = None
    assert model_errors(Source, source) == []


def test_register_ids_are_unique(content_dir: Path):
    path = content_dir / "sources.json"
    sources = read_json(path)
    first_index = None
    for index, source in enumerate(sources):
        if source.get("register_id") == "S02":
            first_index = index
            break
    assert first_index is not None

    duplicate = imported_source({"Source ID": "S02"})
    duplicate["id"] = "s02-copy"
    sources.append(duplicate)
    write_json(path, sources)

    assert run(content_dir) == [
        f'sources[{len(sources) - 1}] (s02-copy).register_id: "S02" is already used by sources[{first_index}] (s02)'
    ]


# ---------------------------------------------------------------------------
# The command


HEADER = (
    "Source ID,Resource Title,Resource Type,Link,Category,Mechanism,Claim (+/-),Author(s),"
    "Resource Date,3 sentence summary,Added by"
)

EXPORT_CSV = (
    HEADER
    + "\n"
    + 'S40,A test paper,Journal article,https://doi.org/10.1000/test.123,AI Alignment,BCI,AI Alignment,'
    + '"Lovelace, A. and Turing, A.",2024,"First sentence. Second, with a comma.",Aila\n'
    + "S41,A test talk,Keynote presentation,https://www.youtube.com/watch?v=abc,Both,N/A,"
    + '"AI Alignment, Human Empowerment",?,2023,A talk.,Raghav\n'
    + "S42,Not screened yet,Screening pending,https://example.org/later,Both,BCI,AI Alignment,"
    + "Someone,2025,Later.,Aila\n"
)


def run_import(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *flags: str) -> Path:
    """Run the command on EXPORT_CSV with sources.json in tmp_path, and return that path."""
    sources_path = tmp_path / "sources.json"
    if not sources_path.exists():
        write_json(sources_path, [sample_source()])
    csv_path = tmp_path / "export.csv"
    # Notion's export starts with a byte order mark.
    csv_path.write_text("﻿" + EXPORT_CSV, encoding="utf-8")

    monkeypatch.setattr(import_notion, "CONTENT_PATH", sources_path)
    monkeypatch.setattr(sys, "argv", ["import_notion", str(csv_path), *flags])
    assert import_notion.main() == 0
    return sources_path


def test_command_writes_the_imported_sources(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    sources_path = run_import(tmp_path, monkeypatch)
    sources = read_json(sources_path)

    assert [source["id"] for source in sources] == ["sample-roadmap-report", "s40", "s41"]
    assert sources[1]["authors"] == ["A. Lovelace", "A. Turing"]
    assert sources[1]["summary"]["text"] == "First sentence. Second, with a comma."
    assert sources[2]["source_type"] == "talk"
    assert sources[2]["technology"] == []
    assert sources[2]["authors"] == []
    assert sources[2]["claim_directions"] == ["ai_alignment", "human_empowerment"]
    for source in sources:
        assert model_errors(Source, source) == []


def test_command_reports_what_it_did(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    run_import(tmp_path, monkeypatch)
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines[:5] == [
        "added S40: A test paper",
        "added S41: A test talk",
        "note: S41: no author names in Notion",
        "note: S42: skipped, marked screening pending in Notion",
        "2 rows imported, 2 notes",
    ]


def test_dry_run_writes_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    sources_path = tmp_path / "sources.json"
    write_json(sources_path, [sample_source()])
    before = sources_path.read_text(encoding="utf-8")

    run_import(tmp_path, monkeypatch, "--dry-run")

    assert sources_path.read_text(encoding="utf-8") == before
    assert capsys.readouterr().out.strip().endswith("Dry run: nothing written.")
