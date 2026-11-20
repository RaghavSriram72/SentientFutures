"""The one-time v0.1 -> v0.4 move of content/ (python -m sf_shared.migrate_v04), on a made-up v0.1 folder."""

import json
from pathlib import Path

from helpers import read_json, run, team_claim, write_json

from sf_shared.migrate_v04 import main, migrate


def v01_risk_row(row_id: str, dimension: str) -> dict:
    return {
        "id": row_id,
        "dimension": dimension,
        "problem": None,
        "scale": "risk",
        "rating": "unclear",
        "confidence": "low",
        "unclear_reason": "no_relevant_evidence",
        "potential_severity": "high",
        "basis": team_claim(f"Old basis for {row_id}."),
    }


def v01_page(tech_id: str, sample: bool) -> dict:
    """A page in the v0.1 shape, with every section the migration touches."""
    return {
        "id": tech_id,
        "name": f"Test page for {tech_id}",
        "short_name": tech_id.upper(),
        "headline": "Could this *keep humans* in the loop?",
        "intro": team_claim("Fixture intro."),
        "claims_to_solve": [],
        "mechanism": [],
        "strongest_case": [],
        "strongest_objections": [],
        "scorecard": [
            {
                "id": "alignment-case",
                "dimension": "Alignment case",
                "problem": "alignment",
                "scale": "case",
                "rating": "unclear",
                "confidence": "low",
                "unclear_reason": "underspecified_proposal",
                "basis": team_claim("Old case basis."),
                "tracker": {"what_would_change": team_claim("A direct test."), "last_updated": "2026-11-16", "placeholder": True},
            },
            {
                "id": "intelligence-curse-case",
                "dimension": "Intelligence Curse case",
                "problem": "intelligence_curse",
                "scale": "case",
                "rating": "unclear",
                "confidence": "low",
                "unclear_reason": "underspecified_proposal",
                "basis": team_claim("Old curse basis."),
            },
            v01_risk_row("governance-risk", "Governance risk"),
        ],
        "artificial_minds_questions": [],
        "scope": {
            "intervention": team_claim("Old intervention."),
            "deployment_scenario": team_claim("Old scenario."),
            "affected_groups": team_claim("Old groups."),
            "time_horizon": team_claim("Old horizon."),
            "comparator": team_claim("Old comparator."),
            "problem": "both",
        },
        "theory_of_change": [team_claim("Old step one."), team_claim("Old step two.")],
        "alternatives": [team_claim("Site alternative, kept.")],
        "evidence_register": [
            {
                "claim": "Old register claim.",
                "supporting_ids": ["S02"],
                "contrary_ids": [],
                "evidence_type": "Argument",
                "directness": "remote",
                "limitation": "Old limitation.",
                "independence": "Mixed",
                "provenance": "team",
                "scorecard_ids": ["alignment-case"],
            }
        ],
        "alignment_assessment": {
            "mechanism": team_claim("Old alignment mechanism."),
            "questions": [{"question": "Old question?", "answer": team_claim("Old answer.")}],
            "rating": "unclear",
            "confidence": "low",
            "unclear_reason": "underspecified_proposal",
            "reason": team_claim("Old alignment reason."),
            "decisive_question": team_claim("Old decisive question."),
        },
        "intelligence_curse_assessment": {
            "mechanism": team_claim("Old curse mechanism."),
            "questions": [{"question": "Old curse question?", "answer": team_claim("Old curse answer.")}],
            "rating": "unclear",
            "confidence": "low",
            "unclear_reason": "underspecified_proposal",
            "reason": team_claim("Old curse reason."),
            "decisive_question": team_claim("Old curse decisive question."),
        },
        "artificial_minds_assessment": {
            "consciousness": team_claim("Old consciousness."),
            "moral_status": team_claim("Old moral status."),
            "identity": team_claim("Old identity."),
            "welfare": team_claim("Old welfare."),
        },
        "welfare_governance": {
            "exposed": team_claim("Old exposed."),
            "harms": team_claim("Old harms."),
            "severity": team_claim("Old severity."),
            "detectability": team_claim("Old detectability."),
            "control": team_claim("Old control."),
            "confidence": "low",
            "rationale": team_claim("Old rationale."),
        },
        "evidence_gap": team_claim("Old evidence gap."),
        "sample": sample,
    }


def v01_folder(content_dir: Path) -> Path:
    """The conftest folder with v0.1 pages and no scorecard.json, as content/ was before the move."""
    pages = [v01_page("wbe", False), v01_page("bci", True), v01_page("neuromorphic", True)]
    write_json(content_dir / "technologies.json", pages)
    (content_dir / "scorecard.json").unlink()
    # The real milestones now carry tab 1a fields the import added. Before the
    # move they had none, and their entry ids would point at an empty scorecard.
    milestones = read_json(content_dir / "milestones.json")
    for milestone in milestones:
        for key in ("assessment_confidence", "applies_to", "criterion_met", "evidence_entries", "timing", "note"):
            milestone.pop(key, None)
    write_json(content_dir / "milestones.json", milestones)
    return content_dir


def test_the_v01_folder_doesnt_validate_before_the_move(content_dir: Path):
    errors = run(v01_folder(content_dir))
    assert f"{content_dir / 'scorecard.json'}: file not found" in errors
    assert any(".theory_of_change: " in error for error in errors)


def test_the_moved_folder_validates(content_dir: Path, tmp_path: Path, capsys):
    folder = v01_folder(content_dir)
    removed_path = tmp_path / "removed.json"
    assert main(["migrate_v04", "--content", str(folder), "--removed-text", str(removed_path)]) == 0
    assert run(folder) == []
    assert capsys.readouterr().out.strip().endswith("OK: wrote scorecard.json, technologies.json")


def test_the_page_takes_the_v04_shape(content_dir: Path):
    folder = v01_folder(content_dir)
    main(["migrate_v04", "--content", str(folder)])
    wbe, bci, _nm = read_json(folder / "technologies.json")

    assert wbe["unreviewed_ai_sections"] is False
    assert bci["unreviewed_ai_sections"] is True
    for key in ("sample", "theory_of_change", "evidence_register", "evidence_gap", "artificial_minds_assessment",
                "scope", "alignment_assessment"):
        assert key not in wbe
    assert wbe["alternatives"] == [team_claim("Site alternative, kept.")]
    assert "questions" not in wbe["intelligence_curse_assessment"]
    assert wbe["intelligence_curse_assessment"]["reason"] == team_claim("Old curse reason.")
    assert wbe["welfare_governance"] == {
        "exposed": team_claim("Old exposed."),
        "harms": team_claim("Old harms."),
        "rationale": team_claim("Old rationale."),
    }

    # Case rows stay for the importer to replace; risk rows lose their v0.1 rating.
    assert wbe["scorecard"][0]["rating"] == "unclear"
    assert wbe["scorecard"][0]["tracker"]["placeholder"] is True
    assert wbe["scorecard"][2] == {
        "id": "governance-risk",
        "dimension": "Governance risk",
        "problem": None,
        "scale": "risk",
        "rating": None,
        "confidence": "low",
        "severity": None,
        "likelihood": None,
        "applicable": True,
        "basis": None,
    }


def test_every_removed_value_is_listed(content_dir: Path, tmp_path: Path):
    folder = v01_folder(content_dir)
    removed_path = tmp_path / "removed.json"
    main(["migrate_v04", "--content", str(folder), "--removed-text", str(removed_path)])
    removed = json.loads(removed_path.read_text(encoding="utf-8"))["removed"]
    found: dict[str, str] = {}
    for item in removed:
        found[item["where"]] = item["text"]

    assert found["technologies.json wbe.theory_of_change[1].text"] == "Old step two."
    assert found["technologies.json wbe.evidence_register[0].limitation"] == "Old limitation."
    assert found["technologies.json wbe.evidence_register[0].supporting_ids[0]"] == "S02"
    assert found["technologies.json wbe.evidence_gap.text"] == "Old evidence gap."
    assert found["technologies.json wbe.scope.comparator.text"] == "Old comparator."
    assert found["technologies.json wbe.alignment_assessment.questions[0].answer.text"] == "Old answer."
    assert found["technologies.json wbe.intelligence_curse_assessment.questions[0].question"] == "Old curse question?"
    assert found["technologies.json wbe.artificial_minds_assessment.welfare.text"] == "Old welfare."
    assert found["technologies.json wbe.welfare_governance.confidence"] == "low"
    assert found["technologies.json bci.scorecard[2] (governance-risk).potential_severity"] == "high"
    assert found["technologies.json bci.scorecard[2] (governance-risk).basis.text"] == "Old basis for governance-risk."
    # Provenance labels only say whose words they were, so they aren't listed.
    assert not any(where.endswith(".provenance") for where in found)
    # Nothing the migration keeps is listed.
    assert not any("alternatives" in where for where in found)
    assert not any("scorecard[0]" in where for where in found)


def test_a_second_run_changes_nothing(content_dir: Path, capsys):
    folder = v01_folder(content_dir)
    main(["migrate_v04", "--content", str(folder)])
    before = {name: (folder / name).read_bytes() for name in ("technologies.json", "scorecard.json")}
    capsys.readouterr()

    assert main(["migrate_v04", "--content", str(folder)]) == 0
    assert capsys.readouterr().out.strip() == "Nothing to do: content/ is already in the v0.4 shapes."
    for name, data in before.items():
        assert (folder / name).read_bytes() == data
    assert migrate(folder) == ({}, [])


def test_an_existing_scorecard_is_left_alone(content_dir: Path):
    folder = v01_folder(content_dir)
    write_json(folder / "scorecard.json", {
        "generated": "Written by the importer.",
        "workbook": {"title": "Fixture workbook", "version": "0.4", "source_sha256": None},
    })
    before = (folder / "scorecard.json").read_bytes()
    to_write, _removed = migrate(folder)
    assert sorted(to_write) == ["technologies.json"]
    main(["migrate_v04", "--content", str(folder)])
    assert (folder / "scorecard.json").read_bytes() == before


def test_the_placeholder_scorecard_has_empty_tables(content_dir: Path):
    folder = v01_folder(content_dir)
    main(["migrate_v04", "--content", str(folder)])
    placeholder = read_json(folder / "scorecard.json")
    assert placeholder["workbook"] == {
        "title": "Neuroengineering proposal scorecard framework",
        "version": "0.4",
        "source_sha256": None,
    }
    for key in ("codebook", "frameworks", "milestone_categories", "milestone_assessments", "entries", "links",
                "risks", "governance"):
        assert placeholder[key] == []


def test_nothing_is_written_when_the_result_wouldnt_validate(content_dir: Path, capsys):
    folder = v01_folder(content_dir)
    pages = read_json(folder / "technologies.json")
    pages[0]["headline"] = "No italics here"
    write_json(folder / "technologies.json", pages)
    before = (folder / "technologies.json").read_bytes()

    assert main(["migrate_v04", "--content", str(folder)]) == 1
    assert "FAILED: the migrated content doesn't validate, so nothing was written." in capsys.readouterr().out
    assert (folder / "technologies.json").read_bytes() == before
    assert not (folder / "scorecard.json").exists()
