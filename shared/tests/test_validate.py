"""The whole-folder validator: file handling, cross-record rules, posts and em dashes."""

from pathlib import Path

import pytest
from helpers import POST_TEXT, REAL_CONTENT, milestone_index, read_json, run, write_json

from sf_shared.validate import main, validate_content

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
    return f"OK: {milestone_count} milestones, {source_count} sources, 3 technologies, 1 post"


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
        "Warning: 2 AI-suggested claims in sample records have no reviewer. They show as not yet reviewed "
        "and must be reviewed before the sample flag comes off.",
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
        "Warning: 1 AI-suggested claim in a sample record has no reviewer. It shows as not yet reviewed "
        "and must be reviewed before the sample flag comes off."
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


def test_em_dash_is_detected(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[0]["name"] = "A whole mouse brain \u2014 mapped"
    write_json(path, milestones)

    line_number = 0
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if "\u2014" in line:
            line_number = number
    assert run(content_dir) == [
        f"{path} line {line_number}: has an em dash. Use a period, comma, colon or parentheses instead"
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
