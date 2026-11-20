"""content/scorecard.json: its loader, its own ids and references, and the
existence checks from milestones.json, technologies.json and sources.json."""

from pathlib import Path

import pytest
from helpers import REAL_CONTENT, evidence_entry, first_register_source, milestone_index, read_json, run, write_json

from sf_shared.validate import main


def scorecard_path(content_dir: Path) -> Path:
    return content_dir / "scorecard.json"


def real_source(content_dir: Path) -> dict:
    return first_register_source(read_json(content_dir / "sources.json"))


def link(link_id: str, family: str, scenario_code: str, **overrides) -> dict:
    data = {
        "id": link_id,
        "family": family,
        "scenario_code": scenario_code,
        "scenario": "WBE as AI overseer",
        "step": "1 Capability",
        "outcome": "AI Alignment",
        "claim": "Fixture link claim.",
        "status": "search_incomplete",
        "supporting": [],
        "contrary": [],
        "qualifying": [],
        "best_directness": None,
        "assumption": None,
        "objection": None,
    }
    data.update(overrides)
    return data


def risk(risk_id: str, **overrides) -> dict:
    data = {
        "id": risk_id,
        "risk": "Fixture risk.",
        "families": ["wbe"],
        "domain": "governance",
        "category": "Fixture category",
        "exposed": "Everyone (population-wide)",
        "severity": "very_high",
        "likelihood": "not_assessable",
        "reversibility": "low",
        "detectability": "low",
        "remedies": "None identified",
        "control": "Operator",
        "confidence": "low",
        "entries": [],
    }
    data.update(overrides)
    return data


def governance_item(item_id: str, **overrides) -> dict:
    data = {
        "id": item_id,
        "family": "wbe",
        "question": "Fixture question",
        "status": "not_addressed",
        "entries": [],
        "summary": None,
    }
    data.update(overrides)
    return data


def category(code: str, value: str) -> dict:
    return {"id": code, "category": value, "label": "Fixture label", "question": "Fixture question?"}


def milestone_row(family: str, code: str, value: str, **overrides) -> dict:
    data = {
        "family": family,
        "milestone": code,
        "category": value,
        "applies_to": "All uses",
        "success_criterion": "Fixture criterion.",
        "status": "unclear",
        "criterion_met": "Unclear (search incomplete)",
        "evidence": "None",
        "evidence_entries": [],
        "bottleneck": None,
        "timing": "Not sourced",
        "confidence": "low",
        "note": None,
    }
    data.update(overrides)
    return data


def full_scorecard(content_dir: Path) -> dict:
    """A scorecard.json with one of everything, all consistent."""
    source = real_source(content_dir)
    data = read_json(scorecard_path(content_dir))
    data["overview"] = {"purpose": "Fixture purpose.", "principles": ["1. One."], "update_protocol": ["1. Add."]}
    data["scope_notes"] = ["Fixture scope note"]
    data["cross_family_scope"] = {
        "intervention": "Fixture.",
        "deployment_scenario": "*-C / *-U codes",
        "source_ids": [source["id"]],
    }
    data["codebook"] = [{"type": "Scenario", "code": "WBE-O", "family": "WBE", "definition": "AI overseer"}]
    data["frameworks"] = [
        {"id": "RF1", "reference": "Fixture", "url": "https://example.org/rf1", "contributes": "A.", "applied": "B."}
    ]
    data["milestone_categories"] = [category("M1", "technical_capability")]
    data["milestone_assessments"] = [milestone_row("wbe", "M1", "technical_capability", evidence_entries=["E001"])]
    # E001 and E002 come first, so tests can break them by index. The entries the
    # conftest wrote for the real milestones' citations stay after them.
    data["entries"] = [
        evidence_entry(
            "E001",
            source,
            codes=["WBE-O-L1", "R01", "G01", "WBE-M1", "AM", "IC comparator (D05)"],
            feeds=[{"family": "wbe", "target": "M1", "direction": "supports", "note": None}],
        ),
        evidence_entry("E002", source),
    ] + [entry for entry in data["entries"] if entry["id"] not in ("E001", "E002")]
    data["links"] = [link("WBE-O-L1", "wbe", "WBE-O", supporting=["E001"], qualifying=["E002"])]
    data["risks"] = [risk("R01", entries=["E001"])]
    data["governance"] = [governance_item("G01", entries=["E002"])]
    return data


def test_a_full_scorecard_passes(content_dir: Path):
    write_json(scorecard_path(content_dir), full_scorecard(content_dir))
    assert run(content_dir) == []


def test_the_ok_line_counts_evidence_entries(content_dir: Path, capsys: pytest.CaptureFixture[str]):
    data = full_scorecard(content_dir)
    write_json(scorecard_path(content_dir), data)
    assert main(["validate", str(content_dir)]) == 0
    assert capsys.readouterr().out.strip().endswith(f", 1 post, {len(data['entries'])} evidence entries")


def test_a_missing_scorecard_is_reported(content_dir: Path):
    scorecard_path(content_dir).unlink()
    assert run(content_dir) == [f"{scorecard_path(content_dir)}: file not found"]


def test_the_scorecard_is_one_object(content_dir: Path):
    write_json(scorecard_path(content_dir), [])
    assert run(content_dir) == [f"{scorecard_path(content_dir)}: should be one object, starting with {{ and ending with }}"]


def test_unknown_keys_and_bad_values_name_their_path(content_dir: Path):
    data = full_scorecard(content_dir)
    data["entries"][0]["stage"] = "1"
    data["entries"][1]["rol"] = data["entries"][1].pop("role")
    data["links"][0]["status"] = "Supporting evidence found"
    write_json(scorecard_path(content_dir), data)

    errors = run(content_dir)
    assert errors[0] == 'scorecard.entries[0].stage: must be a stage like "S1", or "N/A" (got "1")'
    assert "scorecard.entries[1].role: required" in errors
    assert 'scorecard.entries[1].rol: unknown field. Did you mean "role"?' in errors
    assert any(error.startswith("scorecard.links[0].status: Input should be 'supporting'") for error in errors)


def test_ids_are_unique(content_dir: Path):
    data = full_scorecard(content_dir)
    data["entries"].append(dict(data["entries"][1]))
    copy_index = len(data["entries"]) - 1
    data["risks"].append(risk("R01"))
    data["milestone_assessments"].append(milestone_row("wbe", "M1", "technical_capability"))
    write_json(scorecard_path(content_dir), data)

    assert run(content_dir) == [
        f'scorecard.entries[{copy_index}] (E002).id: "E002" is already used by scorecard.entries[1] (E002)',
        'scorecard.risks[1] (R01).id: "R01" is already used by scorecard.risks[0] (R01)',
        'scorecard.milestone_assessments[1] (wbe M1): wbe M1 applying to "All uses" is already '
        "scorecard.milestone_assessments[0] (wbe M1)",
    ]


def test_a_split_milestone_row_is_told_apart_by_what_it_applies_to(content_dir: Path):
    # BCI M1 and NM M1 have two rows each in the workbook.
    data = full_scorecard(content_dir)
    data["milestone_assessments"].append(milestone_row("wbe", "M1", "technical_capability", applies_to="Hardware"))
    write_json(scorecard_path(content_dir), data)
    assert run(content_dir) == []


def test_a_links_family_and_scenario_match_its_id(content_dir: Path):
    data = full_scorecard(content_dir)
    data["links"][0]["family"] = "bci"
    data["links"][0]["scenario_code"] = "WBE-R"
    write_json(scorecard_path(content_dir), data)
    assert run(content_dir) == [
        'scorecard.links[0].family: "bci" doesn\'t match the id "WBE-O-L1", which names wbe',
        'scorecard.links[0].scenario_code: "WBE-R" doesn\'t match the id "WBE-O-L1"',
    ]


def test_nm_links_belong_to_the_neuromorphic_page(content_dir: Path):
    data = full_scorecard(content_dir)
    data["links"].append(link("NM-A-L1", "neuromorphic", "NM-A"))
    write_json(scorecard_path(content_dir), data)
    assert run(content_dir) == []


def test_entry_ids_named_in_the_scorecard_exist(content_dir: Path):
    data = full_scorecard(content_dir)
    data["links"][0]["contrary"] = ["E404"]
    data["risks"][0]["entries"] = ["E002", "E405"]
    data["governance"][0]["entries"] = ["E406"]
    data["milestone_assessments"][0]["evidence_entries"] = ["E407"]
    write_json(scorecard_path(content_dir), data)

    assert run(content_dir) == [
        'scorecard.milestone_assessments[0] (wbe M1).evidence_entries[0]: no evidence entry with id "E407" '
        "in scorecard.json",
        'scorecard.links[0] (WBE-O-L1).contrary[0]: no evidence entry with id "E404" in scorecard.json',
        'scorecard.risks[0] (R01).entries[1]: no evidence entry with id "E405" in scorecard.json',
        'scorecard.governance[0] (G01).entries[0]: no evidence entry with id "E406" in scorecard.json',
    ]


def test_codes_shaped_like_ids_exist_and_other_words_stay_text(content_dir: Path):
    data = full_scorecard(content_dir)
    data["entries"][1]["codes"] = ["WBE-O-L9", "R99", "G99", "BCI-M6", "AM", "D03", "Comparator (Alignment)"]
    write_json(scorecard_path(content_dir), data)

    assert run(content_dir) == [
        'scorecard.entries[1] (E002).codes[0]: no causal link with id "WBE-O-L9" in scorecard.json',
        'scorecard.entries[1] (E002).codes[1]: no risk with id "R99" in scorecard.json',
        'scorecard.entries[1] (E002).codes[2]: no governance checklist item with id "G99" in scorecard.json',
        'scorecard.entries[1] (E002).codes[3]: no bci milestone row "M6" in scorecard.json',
    ]


def test_a_feed_to_a_milestone_needs_that_row(content_dir: Path):
    data = full_scorecard(content_dir)
    data["entries"][1]["feeds"] = [
        {"family": "neuromorphic", "target": "M6", "direction": "supports", "note": "efficiency prerequisite only"},
        {"family": "bci", "target": "alignment", "direction": "against_or_qualifies", "note": None},
    ]
    write_json(scorecard_path(content_dir), data)
    assert run(content_dir) == [
        'scorecard.entries[1] (E002).feeds[0].target: no neuromorphic milestone row "M6" in scorecard.json'
    ]


def test_a_feed_target_is_a_rating_or_a_milestone(content_dir: Path):
    data = full_scorecard(content_dir)
    data["entries"][1]["feeds"] = [{"family": "bci", "target": "Alignment", "direction": "supports", "note": None}]
    write_json(scorecard_path(content_dir), data)
    assert run(content_dir) == [
        'scorecard.entries[1].feeds[0].target: must be "alignment", "intelligence_curse" or a milestone code '
        'like "M1" (got "Alignment")'
    ]


def test_a_milestone_row_names_a_category_header(content_dir: Path):
    data = full_scorecard(content_dir)
    data["milestone_assessments"].append(milestone_row("bci", "M2", "high_level_fidelity"))
    data["milestone_assessments"].append(milestone_row("bci", "M1", "reliability_robustness"))
    write_json(scorecard_path(content_dir), data)
    assert run(content_dir) == [
        'scorecard.milestone_assessments[1] (bci M2).milestone: no milestone category with id "M2" in '
        "milestone_categories",
        'scorecard.milestone_assessments[2] (bci M1).category: "reliability_robustness" differs from '
        'milestone_categories M1 ("technical_capability")',
    ]


def test_entries_cite_real_sources_under_their_register_id(content_dir: Path):
    data = full_scorecard(content_dir)
    data["entries"][0]["source_id"] = "s404"
    data["entries"][1]["register_id"] = "S99"
    data["cross_family_scope"]["source_ids"] = ["s405"]
    write_json(scorecard_path(content_dir), data)

    source = real_source(content_dir)
    assert run(content_dir) == [
        'scorecard.entries[0] (E001).source_id: no source with id "s404" in sources.json',
        f'scorecard.entries[1] (E002).register_id: "S99", but source "{source["id"]}" has register id '
        f'"{source["register_id"]}" in sources.json',
        'scorecard.cross_family_scope.source_ids[0]: no source with id "s405" in sources.json',
    ]


def test_an_entry_cant_cite_a_sample_source(content_dir: Path):
    data = full_scorecard(content_dir)
    sample = read_json(content_dir / "sources.json")[0]
    assert sample["sample"] is True
    data["entries"][1]["source_id"] = sample["id"]
    data["entries"][1]["register_id"] = sample.get("register_id") or "S00"
    write_json(scorecard_path(content_dir), data)

    errors = run(content_dir)
    assert errors[0] == (
        f'scorecard.entries[1] (E002).source_id: "{sample["id"]}" is a sample source. The public site leaves '
        "samples out, so a real record has to cite a real source"
    )


def test_milestones_name_entries_that_exist(content_dir: Path):
    write_json(scorecard_path(content_dir), full_scorecard(content_dir))
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    index = milestone_index(milestones, "wbe-reliability")
    milestones[index]["evidence_entries"] = ["E001", "E404"]
    milestones[index]["assessment_confidence"] = "medium"
    milestones[index]["criterion_met"] = "No"
    write_json(path, milestones)

    assert run(content_dir) == [
        f'milestones[{index}] (wbe-reliability).evidence_entries[1]: no evidence entry with id "E404" in scorecard.json'
    ]


def test_technology_pages_name_entries_and_sources_that_exist(content_dir: Path):
    write_json(scorecard_path(content_dir), full_scorecard(content_dir))
    source = real_source(content_dir)
    path = content_dir / "technologies.json"
    pages = read_json(path)
    pages[0]["scorecard"] = [
        {
            "id": "alignment-benefit",
            "dimension": "Alignment benefit",
            "problem": "alignment",
            "scale": "case",
            "rating": "weak",
            "confidence": "low",
            "basis": {"text": "Fixture basis.", "provenance": "team"},
        }
    ]
    claim = {"text": "Fixture.", "provenance": "team"}
    pages[0]["scope"] = {
        "intervention": claim,
        "deployment_scenario": claim,
        "affected_groups": claim,
        "time_horizon": claim,
        "comparator": claim,
        "problems_claimed": claim,
        "problem": "both",
        "source_ids": [source["id"], "s404"],
    }
    pages[0]["alignment_assessment"] = {
        "problem_addressed": "Oversight",
        "mechanism": claim,
        "questions": [],
        "rating": "weak",
        "confidence": "low",
        "reason": claim,
        "decisive_question": claim,
        "scenarios": [
            {
                "scenario": "WBE as AI overseer",
                "problem": "Oversight",
                "mechanism": "Fixture mechanism",
                "supporting": ["E001"],
                "contrary_or_qualifying": ["E404"],
                "gap": None,
            }
        ],
    }
    pages[0]["intelligence_curse_assessment"] = {
        "mechanism": claim,
        "questions": [{"question": "Who gains, who loses", "answer": claim}],
        "rating": "weak",
        "confidence": "low",
        "reason": claim,
        "decisive_question": None,
        "agency": [
            {"group": "Fixture group", "effect": "weakens", "mechanism": None, "ownership_questions": None, "entries": ["E405"]}
        ],
        "ownership_gate": "0 answered.",
    }
    pages[0]["artificial_minds_by_stage"] = [
        {
            "stage": "S3",
            "stage_number": 3,
            "stage_label": "3 Fixture stage",
            "consciousness": "Fixture.",
            "source_ids": ["s406"],
            "entries": ["E406"],
        },
        {"stage": None, "stage_number": None, "stage_label": "All stages"},
    ]
    write_json(path, pages)

    assert run(content_dir) == [
        'technologies[0] (wbe).scope.source_ids[1]: no source with id "s404" in sources.json',
        'technologies[0] (wbe).artificial_minds_by_stage[0].source_ids[0]: no source with id "s406" in sources.json',
        'technologies[0] (wbe).alignment_assessment.scenarios[0].contrary_or_qualifying[0]: no evidence entry with '
        'id "E404" in scorecard.json',
        'technologies[0] (wbe).intelligence_curse_assessment.agency[0].entries[0]: no evidence entry with id "E405" '
        "in scorecard.json",
        'technologies[0] (wbe).artificial_minds_by_stage[0].entries[0]: no evidence entry with id "E406" in '
        "scorecard.json",
    ]


def test_a_broken_scorecard_doesnt_report_every_reference_as_missing(content_dir: Path):
    path = content_dir / "milestones.json"
    milestones = read_json(path)
    milestones[milestone_index(milestones, "wbe-reliability")]["evidence_entries"] = ["E001"]
    write_json(path, milestones)
    data = full_scorecard(content_dir)
    data["workbook"]["version"] = "v0.4"
    write_json(scorecard_path(content_dir), data)

    assert run(content_dir) == ['scorecard.workbook.version: must look like "0.4": numbers with one dot']


def test_the_scorecard_is_checked_for_dashes(content_dir: Path):
    data = full_scorecard(content_dir)
    data["codebook"][0]["definition"] = "AI overseer \u2013 draft"
    write_json(scorecard_path(content_dir), data)
    errors = run(content_dir)
    assert len(errors) == 1
    assert errors[0].startswith(f"{scorecard_path(content_dir)} line ")
    assert "has an en dash" in errors[0]


def test_the_real_scorecard_passes_with_the_real_content():
    # The placeholder until the first import, then the imported tables.
    data = read_json(REAL_CONTENT / "scorecard.json")
    assert data["workbook"]["version"] == "0.4"
    assert run(REAL_CONTENT) == []


def test_each_scope_keeps_its_source_cell_as_written_and_it_agrees_with_the_ids():
    # Pages show source_ids_text (so "S24-S29" stays a range); source_ids is the
    # same cell with ranges expanded, for links and counts. They must agree.
    from sf_shared.import_workbook import ids_in_text

    scopes = [(page["id"], page["scope"]) for page in read_json(REAL_CONTENT / "technologies.json")]
    scopes.append(("cross_family", read_json(REAL_CONTENT / "scorecard.json")["cross_family_scope"]))
    for name, scope in scopes:
        text = scope["source_ids_text"]
        assert text, name
        assert [register_id.lower() for register_id in ids_in_text(text, "S", 2)] == scope["source_ids"], name
    bci = dict(scopes)["bci"]
    assert bci["source_ids_text"] == "S01, S08, S09, S10, S11, S14, S16, S18, S19, S24-S29"
