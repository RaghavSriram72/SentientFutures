"""Milestone types: the grouping in enums.py, its export to enums.json, and the TypeScript mirror."""

import re

import pytest
from helpers import REPO_ROOT

from sf_shared import enums
from sf_shared.enums import (
    ALL_ENUMS,
    ENUM_INFO,
    MILESTONE_TYPES,
    RUBRIC_VERSION,
    MilestoneCategory,
    MilestoneType,
    MilestoneTypeInfo,
    milestone_type_of,
    milestone_type_problems,
)
from sf_shared.export_schema import build_enums_json


def flattened_categories() -> list[MilestoneCategory]:
    categories: list[MilestoneCategory] = []
    for info in MILESTONE_TYPES.values():
        categories.extend(info.categories)
    return categories


def test_every_category_has_exactly_one_type():
    assert milestone_type_problems() == []
    categories = flattened_categories()
    assert len(categories) == len(set(categories))
    assert set(categories) == set(MilestoneCategory)


def test_types_match_owner_grouping():
    assert list(MILESTONE_TYPES) == [MilestoneType.TECHNICAL, MilestoneType.DEPLOYMENT, MilestoneType.WELFARE_GOVERNANCE]
    assert MILESTONE_TYPES[MilestoneType.TECHNICAL] == (
        "Technical",
        (
            MilestoneCategory.TECHNICAL_CAPABILITY,
            MilestoneCategory.HIGH_LEVEL_FIDELITY,
            MilestoneCategory.RELIABILITY_ROBUSTNESS,
        ),
    )
    assert MILESTONE_TYPES[MilestoneType.DEPLOYMENT] == (
        "Deployment",
        (
            MilestoneCategory.SCALABLE_PRODUCTION,
            MilestoneCategory.ECONOMIC_VIABILITY,
            MilestoneCategory.EQUITABLE_ACCESS,
        ),
    )
    assert MILESTONE_TYPES[MilestoneType.WELFARE_GOVERNANCE] == (
        "Welfare and governance",
        (
            MilestoneCategory.SAFETY_WELFARE_ASSURANCE,
            MilestoneCategory.LEGAL_REGULATORY,
            MilestoneCategory.INSTITUTIONAL_LEGITIMACY,
        ),
    )


def test_category_order_follows_type_order():
    # So every list built from the enum (admin select, methodology, compare) groups the same way.
    assert flattened_categories() == list(MilestoneCategory)
    assert list(ENUM_INFO["MilestoneCategory"]["values"]) == [category.value for category in MilestoneCategory]


def test_high_level_fidelity_is_technical():
    assert ENUM_INFO["MilestoneCategory"]["values"]["high_level_fidelity"][0] == "High-level fidelity"
    assert milestone_type_of(MilestoneCategory.HIGH_LEVEL_FIDELITY) == MilestoneType.TECHNICAL
    assert milestone_type_of(MilestoneCategory.ECONOMIC_VIABILITY) == MilestoneType.DEPLOYMENT
    assert milestone_type_of(MilestoneCategory.LEGAL_REGULATORY) == MilestoneType.WELFARE_GOVERNANCE


def test_export_includes_milestone_types():
    exported = build_enums_json()
    assert exported["milestone_types"] == [
        {
            "value": "technical",
            "label": "Technical",
            "categories": ["technical_capability", "high_level_fidelity", "reliability_robustness"],
        },
        {
            "value": "deployment",
            "label": "Deployment",
            "categories": ["scalable_production", "economic_viability", "equitable_access"],
        },
        {
            "value": "welfare_governance",
            "label": "Welfare and governance",
            "categories": ["safety_welfare_assurance", "legal_regulatory", "institutional_legitimacy"],
        },
    ]
    exported_categories: list[str] = []
    for milestone_type in exported["milestone_types"]:
        exported_categories.extend(milestone_type["categories"])
    category_values = [item["value"] for item in exported["enums"]["MilestoneCategory"]["values"]]
    assert exported_categories == category_values
    # A type is never stored, so it isn't one of the enums a model field can use.
    assert "MilestoneType" not in exported["enums"]


def without_category(category: MilestoneCategory) -> dict[MilestoneType, MilestoneTypeInfo]:
    patched: dict[MilestoneType, MilestoneTypeInfo] = {}
    for milestone_type, info in MILESTONE_TYPES.items():
        kept = []
        for item in info.categories:
            if item != category:
                kept.append(item)
        patched[milestone_type] = MilestoneTypeInfo(label=info.label, categories=tuple(kept))
    return patched


def test_export_rejects_a_category_with_no_type(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(enums, "MILESTONE_TYPES", without_category(MilestoneCategory.EQUITABLE_ACCESS))
    with pytest.raises(ValueError) as problem:
        build_enums_json()
    assert str(problem.value) == 'category "equitable_access" has no milestone type. Add it to one of MILESTONE_TYPES'


def test_export_rejects_a_category_in_two_types(monkeypatch: pytest.MonkeyPatch):
    patched = dict(MILESTONE_TYPES)
    deployment = patched[MilestoneType.DEPLOYMENT]
    patched[MilestoneType.DEPLOYMENT] = MilestoneTypeInfo(
        label=deployment.label,
        categories=(*deployment.categories, MilestoneCategory.TECHNICAL_CAPABILITY),
    )
    monkeypatch.setattr(enums, "MILESTONE_TYPES", patched)
    with pytest.raises(ValueError) as problem:
        build_enums_json()
    assert str(problem.value) == (
        'category "technical_capability" is in both technical and deployment. '
        "Each category belongs to exactly one type"
    )


def test_a_type_needs_an_entry_and_categories(monkeypatch: pytest.MonkeyPatch):
    patched = dict(MILESTONE_TYPES)
    patched[MilestoneType.DEPLOYMENT] = MilestoneTypeInfo(label="Deployment", categories=())
    del patched[MilestoneType.WELFARE_GOVERNANCE]
    monkeypatch.setattr(enums, "MILESTONE_TYPES", patched)
    assert milestone_type_problems() == [
        "MilestoneType.WELFARE_GOVERNANCE has no entry in MILESTONE_TYPES",
        "MILESTONE_TYPES[deployment] has no categories",
        'category "scalable_production" has no milestone type. Add it to one of MILESTONE_TYPES',
        'category "economic_viability" has no milestone type. Add it to one of MILESTONE_TYPES',
        'category "equitable_access" has no milestone type. Add it to one of MILESTONE_TYPES',
        'category "safety_welfare_assurance" has no milestone type. Add it to one of MILESTONE_TYPES',
        'category "legal_regulatory" has no milestone type. Add it to one of MILESTONE_TYPES',
        'category "institutional_legitimacy" has no milestone type. Add it to one of MILESTONE_TYPES',
    ]


def test_milestone_type_of_names_the_fix(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(enums, "MILESTONE_TYPES", without_category(MilestoneCategory.HIGH_LEVEL_FIDELITY))
    with pytest.raises(KeyError, match="high_level_fidelity has no milestone type. Add it to MILESTONE_TYPES"):
        enums.milestone_type_of(MilestoneCategory.HIGH_LEVEL_FIDELITY)


def test_rubric_version_in_export():
    # Adding High-level fidelity was a rubric change. The workbook's v0.4 scales
    # didn't change it: pipeline and review records carry RUBRIC_VERSION, and
    # the workbook's own version lives in content/scorecard.json.
    assert RUBRIC_VERSION == "0.2-draft"
    assert build_enums_json()["rubric_version"] == RUBRIC_VERSION


def labels(name: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for value, (label, _description) in ENUM_INFO[name]["values"].items():
        result[value] = label
    return result


def test_the_workbooks_scales_use_its_own_words():
    assert labels("EvidenceDirectness") == {
        "direct": "Direct (family itself)",
        "close_prerequisite": "Close technical prerequisite",
        "related_neuroai": "Related NeuroAI system",
        "conceptual": "Conceptually relevant only",
    }
    assert labels("EvidenceRole") == {
        "supports": "Supports",
        "contrary": "Contrary",
        "qualifies": "Qualifies",
        "prerequisite_only": "Prerequisite only",
    }
    assert labels("EvidenceBasis") == {
        "demonstrated": "Demonstrated",
        "projected": "Projected",
        "argued": "Argued",
        "assumed": "Assumed",
    }
    assert labels("EvidenceStatus") == {
        "supporting": "Supporting evidence found",
        "contrary": "Contrary evidence found",
        "conflicting": "Conflicting evidence",
        "no_relevant_evidence": "No relevant evidence found",
        "search_incomplete": "Search incomplete",
    }
    assert labels("Severity") == {
        "very_high": "Very high",
        "high": "High",
        "medium": "Medium",
        "low": "Low",
        "unclear": "Unclear",
    }
    assert labels("Likelihood") == {"high": "High", "medium": "Medium", "low": "Low", "not_assessable": "Not assessable"}
    assert labels("RiskLevel") == {"high": "High", "medium": "Medium", "low": "Low", "unclear": "Unclear"}
    assert labels("RiskDomain") == {
        "human_welfare": "Human welfare",
        "artificial_mind_welfare": "Artificial-mind welfare",
        "governance": "Governance",
    }
    # The sheet writes "Not addressed in database"; the site says it in its own words.
    assert labels("GovernanceStatus") == {
        "not_addressed": "Not addressed by any source",
        "proposal_found": "Proposal found",
        "evidence_found": "Evidence found",
    }
    assert labels("AgencyEffect") == {
        "strengthens": "Strengthens",
        "weakens": "Weakens",
        "mixed": "Mixed",
        "not_addressed": "Not addressed",
    }
    assert labels("MilestoneStatus")["unclear"] == "Unclear"


def test_descriptions_come_from_the_codebook_or_stay_empty():
    # No new prose: a value the Codebook doesn't define has an empty description.
    directness = ENUM_INFO["EvidenceDirectness"]["values"]
    assert directness["conceptual"][1] == "No empirical or technical bearing; argument by analogy"
    status = ENUM_INFO["EvidenceStatus"]["values"]
    assert status["search_incomplete"][1] == "Search not yet completed"
    for name in ("EvidenceRole", "EvidenceBasis", "Severity", "Likelihood", "RiskLevel", "RiskDomain",
                 "GovernanceStatus", "AgencyEffect"):
        for _label, description in ENUM_INFO[name]["values"].values():
            assert description == ""
    for value in ("indirect_evidence_only", "outcome_not_operationalized", "information_inaccessible"):
        assert ENUM_INFO["UnclearReason"]["values"][value][1] == ""
    assert ENUM_INFO["MilestoneStatus"]["values"]["unclear"][1] == ""


def test_the_old_scales_stay_for_the_code_that_reads_them():
    # The source rubric's 3-value Directness and the retired RiskRating stay in enums.json.
    exported = build_enums_json()["enums"]
    assert [item["value"] for item in exported["Directness"]["values"]] == ["direct", "adjacent", "remote"]
    assert [item["value"] for item in exported["RiskRating"]["values"]] == ["high", "medium", "low", "unclear"]
    assert [item["value"] for item in exported["SourceType"]["values"]] == [
        "peer_reviewed", "preprint", "blog", "report", "forum_post", "talk", "podcast", "book",
    ]


def union_members(source: str, type_name: str) -> list[str]:
    """The string literals of `export type <type_name> = "a" | "b";` in a TypeScript file, in order."""
    match = re.search(rf"export type {type_name} =(.*?);", source, re.DOTALL)
    assert match is not None, f"no {type_name} union in frontend/lib/types.ts"
    return re.findall(r'"([a-z_]+)"', match.group(1))


def test_types_ts_matches_the_enums():
    # types.ts is written by hand, so check it against Python here.
    source = (REPO_ROOT / "frontend" / "lib" / "types.ts").read_text(encoding="utf-8")
    assert union_members(source, "MilestoneCategory") == [category.value for category in MilestoneCategory]
    assert union_members(source, "MilestoneType") == [milestone_type.value for milestone_type in MilestoneType]
    for name in (
        "MilestoneStatus",
        "UnclearReason",
        "EvidenceDirectness",
        "EvidenceRole",
        "EvidenceBasis",
        "EvidenceStatus",
        "Severity",
        "Likelihood",
        "RiskLevel",
        "RiskDomain",
        "GovernanceStatus",
        "AgencyEffect",
    ):
        assert union_members(source, name) == [member.value for member in ALL_ENUMS[name]], name
