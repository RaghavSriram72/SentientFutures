"""The whole-folder validator: file handling, cross-record rules, the workbook's codes, posts and dashes."""

from datetime import date
from pathlib import Path

import pytest
from helpers import (
    POST_TEXT,
    REAL_CONTENT,
    evidence_entry,
    first_register_source,
    milestone_index,
    read_json,
    run,
    team_claim,
    write_json,
)

from sf_shared import enums
from sf_shared.enums import MilestoneCategory, MilestoneType, MilestoneTypeInfo
from sf_shared.validate import em_dash_line_numbers, em_dash_paths, main, validate_content

FIRST = "milestones[0] (bci-sample-medical-approval)"


def test_current_milestones_and_sources_pass(content_dir: Path):
    assert run(content_dir) == []


def real_content_is_complete() -> bool:
    has_technologies = (REAL_CONTENT / "technologies.json").exists()
    has_posts = len(list((REAL_CONTENT / "posts").glob("*.md"))) > 0
    return has_technologies and has_posts


@pytest.mark.skipif(
    not real_content_is_complete(),
    reason="content/technologies.json or content/posts/*.md isn't written yet",
)
def test_real_content_folder_passes():
    assert run(REAL_CONTENT) == []


def ok_line(content_dir: Path) -> str:
    """The validator's last line for the fixture folder. The counts come from
    the real milestones.json and sources.json, which grow as the team adds to them."""
    milestone_count = len(read_json(content_dir / "milestones.json"))
    source_count = len(read_json(content_dir / "sources.json"))
    entry_count = len(read_json(content_dir / "scorecard.json")["entries"])
    entries = "1 evidence entry" if entry_count == 1 else f"{entry_count} evidence entries"
    return f"OK: {milestone_count} milestones, {source_count} sources, 3 technologies, 1 post, {entries}"


def test_cli_prints_counts(content_dir: Path, capsys: pytest.CaptureFixture[str]):
    assert main(["validate", str(content_dir)]) == 0
    assert capsys.readouterr().out.strip() == ok_line(content_dir)


def test_cli_warns_about_unreviewed_sample_claims(content_dir: Path, capsys: pytest.CaptureFixture[str]):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[0]["summary"] = {"text": "Suggested by a model.", "provenance": "ai"}
    milestones[1]["summary"] = {"text": "Also suggested by a model.", "provenance": "ai", "reviewed_by": None}
    write_json(path, milestones)

    assert main(["validate", str(content_dir)]) == 0  # a warning doesn't fail the check
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines == [
        "Warning: 2 AI-suggested claims in sample records or pages with unreviewed AI sections have no "
        "reviewer. The site shows them as unchecked, and they must be reviewed before the flag comes off.",
        ok_line(content_dir),
    ]


def test_cli_prints_every_error_and_fails(content_dir: Path, capsys: pytest.CaptureFixture[str]):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[0]["stage"] = "posible"
    milestones[3]["status"] = "done"
    write_json(path, milestones)

    assert main(["validate", str(content_dir)]) == 1
    output = capsys.readouterr().out
    assert f"{FIRST}.stage: Input should be" in output
    assert "milestones[3] (neuro-sample-energy).status: Input should be" in output
    assert "FAILED: 2 problems" in output


# ---------------------------------------------------------------------------
# Readable paths for the common mistakes


def test_misspelled_key_names_the_path(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[0]["forcasts"] = milestones[0].pop("forecasts")
    write_json(path, milestones)

    assert run(content_dir) == [
        f"{FIRST}.forecasts: required",
        f'{FIRST}.forcasts: unknown field. Did you mean "forecasts"?',
    ]


def test_misspelled_nested_key(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    forecast = milestones[0]["forecasts"][1]
    forecast["quote_locaton"] = forecast.pop("quote_location")
    write_json(path, milestones)

    assert run(content_dir) == [f'{FIRST}.forecasts[1].quote_locaton: unknown field. Did you mean "quote_location"?']


def test_source_claim_without_quote(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    del milestones[0]["status_basis"]["quote"]
    write_json(path, milestones)

    assert run(content_dir) == [
        f"{FIRST}.status_basis.quote: required (provenance is source). Paste the exact words from the source."
    ]


def test_forecast_without_quote_uses_the_milestone_id(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    index = milestone_index(milestones, "neuro-sample-alignment-benefit")
    milestones[index]["forecasts"][0]["quote"] = ""
    write_json(path, milestones)

    errors = run(content_dir)
    assert len(errors) == 1
    assert errors[0].startswith(f"milestones[{index}] (neuro-sample-alignment-benefit).forecasts[0].quote: required")


def test_ai_claim_without_reviewer(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[0]["summary"] = {"text": "Suggested by a model.", "provenance": "ai"}
    write_json(path, milestones)
    report = validate_content(content_dir)
    assert report.errors == []  # a sample record may skip review...
    assert report.warnings == [  # ...but it gets counted
        "Warning: 1 AI-suggested claim in a sample record or a page with unreviewed AI sections has no "
        "reviewer. The site shows it as unchecked, and it must be reviewed before the flag comes off."
    ]

    milestones[0]["sample"] = False
    write_json(path, milestones)
    report = validate_content(content_dir)
    assert len(report.errors) == 1
    assert report.errors[0].startswith(f"{FIRST}.summary.reviewed_by: required when provenance is ai.")
    assert report.warnings == []


def test_every_broken_record_is_reported(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[2]["would_move_later"] = []
    milestones[4]["forecasts"][2]["latest"] = 2050  # a "never" forecast with a year
    write_json(path, milestones)

    errors = run(content_dir)
    assert len(errors) == 2
    assert errors[0].startswith("milestones[2] (bci-sample-agency).would_move_later: needs at least one")
    assert errors[1].startswith("milestones[4] (neuro-sample-alignment-benefit).forecasts[2].latest: must be null")


# ---------------------------------------------------------------------------
# Cross-record rules


def test_dependency_cycle_is_detected(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    # the agency milestone already depends on medical approval; close the loop.
    milestones[0]["depends_on"] = ["bci-sample-agency"]
    write_json(path, milestones)

    assert run(content_dir) == [
        "milestones: dependency cycle: bci-sample-medical-approval -> bci-sample-agency -> "
        "bci-sample-medical-approval. Remove one of these depends_on links"
    ]


def test_self_and_missing_dependencies(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[0]["depends_on"] = ["bci-sample-medical-approval", "wbe-no-such-milestone"]
    write_json(path, milestones)

    assert run(content_dir) == [
        f"{FIRST}.depends_on[0]: a milestone can't depend on itself",
        f'{FIRST}.depends_on[1]: no milestone with id "wbe-no-such-milestone" in milestones.json',
    ]


def test_dangling_source_ids_are_detected(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[0]["forecasts"][0]["source_id"] = "no-such-source"
    milestones[0]["main_bottleneck"]["source_ids"] = ["typo-report"]
    milestones[0]["source_ids"].append("another-missing-one")
    write_json(path, milestones)

    assert run(content_dir) == [
        f'{FIRST}.main_bottleneck.source_ids[0]: no source with id "typo-report" in sources.json',
        f'{FIRST}.source_ids[2]: no source with id "another-missing-one" in sources.json',
        f'{FIRST}.forecasts[0].source_id: no source with id "no-such-source" in sources.json',
    ]


def sample_source_claim() -> dict:
    return {
        "text": "Cites a fictional source.",
        "provenance": "source",
        "source_ids": ["sample-roadmap-report"],
        "quote": "A made-up line.",
    }


def test_a_real_milestone_cant_link_to_samples(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    index = milestone_index(milestones, "wbe-reliability")
    milestones[index]["depends_on"] = ["bci-sample-agency"]
    milestones[index]["source_ids"] = ["sample-roadmap-report"]
    milestones[index]["summary"] = sample_source_claim()
    write_json(path, milestones)

    label = f"milestones[{index}] (wbe-reliability)"
    assert run(content_dir) == [
        f'{label}.depends_on[0]: "bci-sample-agency" is a sample milestone. The public site leaves samples '
        "out, so a real milestone can only depend on real ones",
        f'{label}.source_ids[0]: "sample-roadmap-report" is a sample source. The public site leaves samples '
        "out, so a real record has to cite a real source",
        f'{label}.summary.source_ids[0]: "sample-roadmap-report" is a sample source. The public site leaves '
        "samples out, so a real record has to cite a real source",
    ]


def test_no_technology_page_can_cite_a_sample_source(content_dir: Path):
    # Every page is public and carries team ratings, so a page with unreviewed
    # AI sections is checked too.
    path = content_dir / "technologies.json"
    pages = read_json(path)
    pages[0]["unreviewed_ai_sections"] = False
    pages[0]["intro"] = sample_source_claim()
    pages[1]["intro"] = sample_source_claim()
    write_json(path, pages)

    assert run(content_dir) == [
        'technologies[0] (wbe).intro.source_ids[0]: "sample-roadmap-report" is a sample source. The public '
        "site leaves samples out, so a real record has to cite a real source",
        'technologies[1] (bci).intro.source_ids[0]: "sample-roadmap-report" is a sample source. The public '
        "site leaves samples out, so a real record has to cite a real source",
    ]


def test_duplicate_ids_are_detected(content_dir: Path):
    path = content_dir / "sources.json"
    sources = read_json(path)
    copy_index = len(sources)
    sources.append(dict(sources[0]))
    write_json(path, sources)

    errors = run(content_dir)
    assert errors == [
        f'sources[{copy_index}] (sample-roadmap-report).id: "sample-roadmap-report" is already used by '
        "sources[0] (sample-roadmap-report)"
    ]


def test_missing_technology_page(content_dir: Path):
    path = content_dir / "technologies.json"
    pages = read_json(path)
    write_json(path, pages[:2])

    assert run(content_dir) == [
        f'{path}: no page with id "neuromorphic" (the site has a page for each of wbe, bci, neuromorphic)'
    ]


# ---------------------------------------------------------------------------
# Every page has the same scorecard rows


def scorecard_row(row_id: str, dimension: str, scale: str, problem: str | None) -> dict:
    if scale == "risk":
        return {
            "id": row_id,
            "dimension": dimension,
            "problem": problem,
            "scale": scale,
            "rating": None,
            "confidence": "low",
            "severity": "high",
            "likelihood": "not_assessable",
        }
    return {
        "id": row_id,
        "dimension": dimension,
        "problem": problem,
        "scale": scale,
        "rating": "unclear",
        "confidence": "low",
        "basis": team_claim("Fixture basis."),
    }


def three_rows() -> list[dict]:
    return [
        scorecard_row("alignment-case", "Alignment case", "case", "alignment"),
        scorecard_row("governance-risk", "Governance risk", "risk", None),
        scorecard_row("safeguard-adequacy", "Safeguard adequacy", "case", None),
    ]


def pages_with_three_rows(content_dir: Path) -> list[dict]:
    pages = read_json(content_dir / "technologies.json")
    for page in pages:
        page["scorecard"] = three_rows()
    return pages


SAME_ROWS = "Every page needs the same scorecard rows as technologies[0] (wbe), in the same order"
SAME_MEANING = "A row means the same thing on every page, so change it on all of them at once"


def test_matching_scorecards_pass(content_dir: Path):
    write_json(content_dir / "technologies.json", pages_with_three_rows(content_dir))
    assert run(content_dir) == []


def test_a_missing_or_extra_row_is_reported(content_dir: Path):
    pages = pages_with_three_rows(content_dir)
    pages[1]["scorecard"].pop()
    pages[2]["scorecard"].append(scorecard_row("foo", "Foo", "case", None))
    write_json(content_dir / "technologies.json", pages)

    assert run(content_dir) == [
        f'technologies[1] (bci).scorecard: no row with id "safeguard-adequacy". {SAME_ROWS}',
        f'technologies[2] (neuromorphic).scorecard[3].id: "foo" isn\'t on technologies[0] (wbe). {SAME_ROWS}',
    ]


def test_rows_in_a_different_order_are_reported(content_dir: Path):
    pages = pages_with_three_rows(content_dir)
    pages[2]["scorecard"].reverse()
    write_json(content_dir / "technologies.json", pages)

    assert run(content_dir) == [
        "technologies[2] (neuromorphic).scorecard: the rows are in a different order from technologies[0] (wbe). "
        "Use: alignment-case, governance-risk, safeguard-adequacy"
    ]


def test_a_row_means_the_same_thing_on_every_page(content_dir: Path):
    pages = pages_with_three_rows(content_dir)
    pages[1]["scorecard"][0]["dimension"] = "Alignment Case"
    pages[1]["scorecard"][2] = scorecard_row("safeguard-adequacy", "Safeguard adequacy", "risk", None)
    pages[2]["scorecard"][2]["problem"] = "both"
    write_json(content_dir / "technologies.json", pages)

    assert run(content_dir) == [
        'technologies[1] (bci).scorecard[0].dimension: "Alignment Case" differs from technologies[0] (wbe), '
        f'which has "Alignment case". {SAME_MEANING}',
        'technologies[1] (bci).scorecard[2].scale: "risk" differs from technologies[0] (wbe), '
        f'which has "case". {SAME_MEANING}',
        'technologies[2] (neuromorphic).scorecard[2].problem: "both" differs from technologies[0] (wbe), '
        f"which has null. {SAME_MEANING}",
    ]


def test_a_broken_first_page_isnt_the_reference(content_dir: Path):
    pages = pages_with_three_rows(content_dir)
    pages[0]["headline"] = "No italics here"
    pages[0]["scorecard"].pop()  # would be a mismatch, if wbe were the reference
    write_json(content_dir / "technologies.json", pages)

    errors = run(content_dir)
    assert len(errors) == 1
    assert errors[0].startswith("technologies[0] (wbe).headline: needs exactly one *italic* word or phrase")


# ---------------------------------------------------------------------------
# Rating trackers: milestone links, dates, sources and the placeholder warning


def set_tracker(content_dir: Path, page_index: int, tracker: dict, unreviewed_ai: bool = True) -> None:
    path = content_dir / "technologies.json"
    pages = read_json(path)
    pages[page_index]["scorecard"][0]["tracker"] = tracker
    pages[page_index]["unreviewed_ai_sections"] = unreviewed_ai
    write_json(path, pages)


def test_a_scorecard_row_links_real_milestones(content_dir: Path):
    set_tracker(content_dir, 0, {"milestone_ids": ["wbe-legal", "wbe-access"]})
    assert run(content_dir) == []


def test_an_unknown_milestone_link(content_dir: Path):
    set_tracker(content_dir, 0, {"milestone_ids": ["wbe-legl"]})
    assert run(content_dir) == [
        'technologies[0] (wbe).scorecard[0].tracker.milestone_ids[0]: no milestone with id "wbe-legl" '
        "in milestones.json"
    ]


def test_a_link_to_another_technologys_milestone(content_dir: Path):
    set_tracker(content_dir, 1, {"milestone_ids": ["wbe-legal"]})
    assert run(content_dir) == [
        'technologies[1] (bci).scorecard[0].tracker.milestone_ids[0]: "wbe-legal" is a wbe milestone, '
        "and this is the bci page"
    ]


@pytest.mark.parametrize("unreviewed_ai", [False, True])
def test_a_link_to_a_sample_milestone(content_dir: Path, unreviewed_ai: bool):
    # Refused on every page: the public site leaves sample milestones out.
    set_tracker(content_dir, 1, {"milestone_ids": ["bci-sample-agency"]}, unreviewed_ai=unreviewed_ai)
    assert run(content_dir) == [
        'technologies[1] (bci).scorecard[0].tracker.milestone_ids[0]: "bci-sample-agency" is a sample milestone. '
        "The public site leaves samples out, so a scorecard row can only link to real milestones"
    ]


def history_entry(day: str, source_id: str = "s13") -> dict:
    # The fixture row is rated weak with low confidence.
    return {
        "date": day,
        "rating_before": "unclear",
        "rating_after": "weak",
        "confidence_before": "low",
        "confidence_after": "low",
        "note": {"text": "What changed, and which source caused it.", "provenance": "team", "source_ids": [source_id]},
    }


def test_a_change_note_cites_a_known_source(content_dir: Path):
    entry = history_entry("2026-11-02", "no-such-source")
    set_tracker(content_dir, 0, {"last_updated": "2026-11-02", "history": [entry]})
    errors = validate_content(content_dir, today=date(2026, 11, 16)).errors
    assert errors == [
        'technologies[0] (wbe).scorecard[0].tracker.history[0].note.source_ids[0]: no source with id '
        '"no-such-source" in sources.json'
    ]


def test_dates_in_the_future_are_refused(content_dir: Path):
    today = date(2026, 11, 16)
    set_tracker(content_dir, 0, {"last_updated": "2027-11-18", "history": [history_entry("2027-11-18")]})
    assert validate_content(content_dir, today=today).errors == [
        "technologies[0] (wbe).scorecard[0].tracker.history[0].date: 2027-11-18 is in the future. Check the year",
        "technologies[0] (wbe).scorecard[0].tracker.last_updated: 2027-11-18 is in the future. Check the year",
    ]

    # Tomorrow passes: a day of slack covers a writer in a time zone ahead of the checker.
    set_tracker(content_dir, 0, {"last_updated": "2026-11-17", "history": [history_entry("2026-11-17")]})
    assert validate_content(content_dir, today=today).errors == []


def test_a_placeholder_tracker_prints_a_warning(content_dir: Path, capsys: pytest.CaptureFixture[str]):
    set_tracker(content_dir, 0, {"last_updated": "2026-11-01", "placeholder": True})

    assert main(["validate", str(content_dir)]) == 0  # a warning doesn't fail the check
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines == [
        "Warning: 1 scorecard row has a placeholder tracker: technologies[0] (wbe).scorecard[0] (alignment-benefit). "
        "The site labels it as a placeholder until the flag comes off.",
        ok_line(content_dir),
    ]


def test_placeholder_warning_counts_every_row(content_dir: Path):
    path = content_dir / "technologies.json"
    pages = read_json(path)
    pages[0]["scorecard"][0]["tracker"] = {"last_updated": "2026-11-01", "placeholder": True}
    pages[2]["scorecard"][0]["tracker"] = {"last_updated": "2026-11-01", "placeholder": True}
    write_json(path, pages)

    assert validate_content(content_dir, today=date(2026, 11, 16)).warnings == [
        "Warning: 2 scorecard rows have placeholder trackers: technologies[0] (wbe).scorecard[0] (alignment-benefit), "
        "technologies[2] (neuromorphic).scorecard[0] (alignment-benefit). The site labels them as placeholders until "
        "the flag comes off."
    ]


# ---------------------------------------------------------------------------
# Milestone types


def test_a_category_without_a_type_fails_the_check(content_dir: Path, monkeypatch: pytest.MonkeyPatch):
    technical = enums.MILESTONE_TYPES[MilestoneType.TECHNICAL]
    without_fidelity = []
    for category in technical.categories:
        if category != MilestoneCategory.HIGH_LEVEL_FIDELITY:
            without_fidelity.append(category)
    patched = dict(enums.MILESTONE_TYPES)
    patched[MilestoneType.TECHNICAL] = MilestoneTypeInfo(label=technical.label, categories=tuple(without_fidelity))
    monkeypatch.setattr(enums, "MILESTONE_TYPES", patched)

    assert run(content_dir) == [
        'shared/sf_shared/enums.py: category "high_level_fidelity" has no milestone type. '
        "Add it to one of MILESTONE_TYPES"
    ]


# ---------------------------------------------------------------------------
# Files


def test_missing_files_are_reported(content_dir: Path):
    (content_dir / "technologies.json").unlink()
    assert run(content_dir) == [f"{content_dir / 'technologies.json'}: file not found"]


def test_invalid_json_gives_a_line_number(content_dir: Path):
    path = content_dir / "sources.json"
    text = path.read_text(encoding="utf-8")
    path.write_text(text.replace('"year": 2021,', '"year": 2021', 1), encoding="utf-8")

    # JSON notices the missing comma on the line after it.
    year_line = 0
    for line_number, line in enumerate(text.splitlines(), start=1):
        if '"year": 2021,' in line:
            year_line = line_number
            break

    errors = run(content_dir)
    assert len(errors) == 1
    assert errors[0].startswith(f"{path}: not valid JSON (line {year_line + 1},")


def test_em_and_en_dashes_are_detected(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[0]["name"] = "A whole mouse brain \u2014 mapped"
    milestones[1]["name"] = "Pages 4\u20136"
    write_json(path, milestones)

    em_line = 0
    en_line = 0
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if "\u2014" in line:
            em_line = number
        if "\u2013" in line:
            en_line = number
    assert run(content_dir) == [
        f"{path} line {em_line}: has an em dash. Use a period, comma, colon or parentheses instead",
        f"{path} line {en_line}: has an en dash. Use a hyphen for a range, or a comma, colon or parentheses instead",
    ]


def test_escaped_em_dash_is_detected(content_dir: Path):
    path = content_dir / "sources.json"
    text = path.read_text(encoding="utf-8")
    path.write_text(text.replace("Placeholder summary.", "Placeholder summary \\u2014", 1), encoding="utf-8")

    errors = run(content_dir)
    assert len(errors) == 1
    assert errors[0].startswith(f"{path} line ")
    assert "has an em dash" in errors[0]


# ---------------------------------------------------------------------------
# Posts


def test_no_posts_fails(content_dir: Path):
    (content_dir / "posts" / "about-this-blog.md").unlink()
    errors = run(content_dir)
    assert errors == [f"{content_dir / 'posts'}/: no posts found. The blog needs at least one .md post to build"]


def test_post_frontmatter_errors(content_dir: Path):
    path = content_dir / "posts" / "about-this-blog.md"
    path.write_text(POST_TEXT.replace("title:", "titel:"), encoding="utf-8")

    assert run(content_dir) == [
        f"{path}.title: required",
        f'{path}.titel: unknown field. Did you mean "title"?',
    ]


def test_post_date_must_be_quoted(content_dir: Path):
    path = content_dir / "posts" / "about-this-blog.md"
    path.write_text(POST_TEXT.replace('date: "2026-10-26"', "date: 2026-10-26"), encoding="utf-8")

    assert run(content_dir) == [f'{path}: date: put the value in double quotes, like date: "2026-10-26"']


def test_post_value_with_colon_must_be_quoted(content_dir: Path):
    path = content_dir / "posts" / "about-this-blog.md"
    path.write_text(POST_TEXT.replace('title: "About this blog"', "title: Why: a question"), encoding="utf-8")

    assert run(content_dir) == [f'{path} line 2: put the value of "title" in double quotes, like title: "..."']


# The site reads frontmatter as YAML, so these either crash the build or
# publish the wrong value unless they're quoted.
@pytest.mark.parametrize(
    "summary_line",
    [
        "summary: Ends with a colon:",
        "summary: - looks like a list",
        'summary: "Quoted" and then more',
        "summary: ? looks like a key",
    ],
)
def test_post_values_yaml_cant_read(content_dir: Path, summary_line: str):
    path = content_dir / "posts" / "about-this-blog.md"
    path.write_text(POST_TEXT.replace("summary: What we'll write about here.", summary_line), encoding="utf-8")

    assert run(content_dir) == [f'{path} line 6: put the value of "summary" in double quotes, like summary: "..."']


def test_post_values_that_arent_text(content_dir: Path):
    path = content_dir / "posts" / "about-this-blog.md"
    text = POST_TEXT.replace("slug: about-this-blog", "slug: 2026-10-26")
    text = text.replace("author: Sample author", "author: yes")
    text = text.replace("summary: What we'll write about here.", "summary: #hashtag summary")
    path.write_text(text, encoding="utf-8")

    assert run(content_dir) == [
        f'{path}: slug: put the value in double quotes, like slug: "2026-10-26"',
        f'{path}: author: put the value in double quotes, like author: "...". Without quotes it reads as true or '
        "false, not text",
        f"{path}: summary: has no value. Write one after the colon, and put it in double quotes if it starts "
        "with # (otherwise it counts as a comment)",
    ]


def test_post_key_twice_or_line_without_colon(content_dir: Path):
    path = content_dir / "posts" / "about-this-blog.md"
    path.write_text(POST_TEXT.replace("author: Sample author", "title: Again"), encoding="utf-8")
    assert run(content_dir) == [f'{path} line 5: "title" appears twice']

    path.write_text(POST_TEXT.replace("author: Sample author", "Sample author"), encoding="utf-8")
    assert run(content_dir) == [f'{path} line 5: expected "key: value", got "Sample author"']


def test_post_slugs_are_unique(content_dir: Path):
    second = content_dir / "posts" / "second.md"
    second.write_text(POST_TEXT, encoding="utf-8")
    first = content_dir / "posts" / "about-this-blog.md"

    assert run(content_dir) == [f'{second}: slug "about-this-blog" is already used by {first}']


def test_post_em_dash_is_detected(content_dir: Path):
    path = content_dir / "posts" / "about-this-blog.md"
    path.write_text(POST_TEXT.replace("A short placeholder post.", "A short post \u2014 really."), encoding="utf-8")

    assert run(content_dir) == [
        f"{path} line 9: has an em dash. Use a period, comma, colon or parentheses instead"
    ]


def test_escaped_en_dash_and_entity_are_detected(content_dir: Path):
    path = content_dir / "sources.json"
    text = path.read_text(encoding="utf-8")
    text = text.replace("Placeholder summary.", "Placeholder summary \\u2013 escaped", 1)
    path.write_text(text, encoding="utf-8")
    post = content_dir / "posts" / "about-this-blog.md"
    post.write_text(POST_TEXT.replace("A short placeholder post.", "Pages 4&ndash;6."), encoding="utf-8")

    errors = run(content_dir)
    assert len(errors) == 2
    assert all("has an en dash" in error for error in errors)


# ---------- The em dash helpers the API uses ----------


def test_em_dash_line_numbers_and_paths():
    dash = chr(0x2014)
    assert em_dash_line_numbers(f"fine\nnot {dash} fine\nalso \\u2014 escaped") == [2, 3]
    value = {"summary": {"text": f"a {dash} b"}, "would_move_later": [{"text": "ok"}, {"text": dash}]}
    assert em_dash_paths(value, "milestone") == ["milestone.summary.text", "milestone.would_move_later[1].text"]
    assert em_dash_paths({"text": "no dashes - here"}) == []
