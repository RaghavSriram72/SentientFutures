"""Import the team's scorecard workbook into content/.

    python -m sf_shared.import_workbook "Neuroengineering scorecard v0.4.xlsx" --version 0.4
    python -m sf_shared.import_workbook <workbook.xlsx> --version 0.4 --dry-run

The workbook is the research source (written by Vilija). The import is how
every new version of it reaches the site. It writes these paths and nothing
else (ALLOWED_PATHS below; anything else it changes is a bug and stops it):
  - content/scorecard.json: the whole file. It is generated: never edit it.
  - content/technologies.json, on each page: the scorecard rows' rating,
    confidence, unclear_reason, severity, likelihood, applicable and basis;
    and the scope, alignment_assessment, intelligence_curse_assessment,
    artificial_minds_by_stage and welfare_governance sections.
  - content/sources.json: register sources the site doesn't have yet (S17 in
    v0.4, placed after s16), and on every register source its quality block,
    screening_pending, and any link the site is missing. Titles, authors and
    summaries are the site's approved text and stay as they are, unless
    --refresh-source-text is passed.
  - content/milestones.json: the WBE timeline milestones' status,
    status_basis, success_criterion, main_bottleneck, source_ids,
    assessment_confidence, applies_to, criterion_met, evidence_entries,
    timing and note (tab 1a). source_ids is the sources the 1a row cites:
    the source of each entry in evidence_entries, then every S-id written in
    the row's success criterion, evidence, main bottleneck, timing and note
    cells (ranges expanded), each once, in the order first seen. The sample
    milestones are never touched.

Rules it follows:
  - Text goes in word for word. The only edits are whitespace tidying, the
    code normalisation and the exact fixes in GLITCH_FIXES, and every edit is
    printed, so they can be checked.
  - Columns are found by their header text, never by their letter. A missing
    or unexpected header, or a value a column doesn't allow, stops the import
    and names the tab, row and column.
  - Running it twice gives the same files: no dates, no random order.
  - Before writing, it validates a copy of content/ with the new files (as
    python -m sf_shared.validate does), then replaces each file in one step.
    --skip-validate leaves that check out; it is for development only.

It prints a report: the edits made, fixes that are no longer needed, cells it
did not use, and consistency warnings to send to the workbook's author.
"""

import argparse
import copy
import difflib
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from sf_shared.import_notion import URL_PATTERN, is_screening_pending, parse_authors, row_to_source
from sf_shared.xlsx import Sheet, XlsxError, cell_ref, column_index, column_letters, read_workbook

REPO_CONTENT = Path(__file__).resolve().parents[2] / "content"

GENERATED_NOTE = "Written by python -m sf_shared.import_workbook from the team's workbook. Do not edit by hand."

# ---------------------------------------------------------------------------
# The workbook's tabs and headers, exactly as the sheet writes them.

OVERVIEW = "Overview"
CODEBOOK = "Codebook"
SYNOPSIS = "Synopsis"
REGISTER = "0 Evidence Register"
SCOPE = "1 Scope"
MILESTONES = "1a Milestones"
THEORY = "2 Theory of Change"
SOURCES = "3 Sources"
SOURCE_QUALITY = "3a Source Quality"
ALIGNMENT = "4 Alignment Judgment"
MINDS = "4.1 Artificial Minds"
CURSE = "5 Intelligence Curse Judgment"
AGENCY = "6 Agency and Ownership"
RISKS = "7 Overall Risks"
GOVERNANCE = "8 Governance Checklist"
# Google Sheets cuts tab names at 31 characters.
WELFARE = "9 Welfare and Governance Judgme"
FRAMEWORKS = "9 Reference Frameworks"
# Hidden in the workbook and not published: the enums come from the values the columns use.
VALIDATION_LISTS = "Validation Lists"

OVERVIEW_PURPOSE = "Purpose"
OVERVIEW_STARTING_POINT = "Starting point"
OVERVIEW_TABS = "Tabs (in order)"
OVERVIEW_PRINCIPLES = "Core principles"
OVERVIEW_PROTOCOL = "Update protocol (per new source)"
OVERVIEW_HEADINGS = [
    OVERVIEW_PURPOSE,
    OVERVIEW_STARTING_POINT,
    OVERVIEW_TABS,
    OVERVIEW_PRINCIPLES,
    OVERVIEW_PROTOCOL,
]

CODEBOOK_HEADERS = {"type": "Type", "code": "Code / value", "family": "Family", "definition": "Definition"}

SYNOPSIS_FAMILY_HEADERS = {"wbe": "WBE", "bci": "BCI", "neuromorphic": "Neuromorphic AI"}
SYNOPSIS_ROWS = {
    "alignment": "Alignment case",
    "intelligence_curse": "Intelligence Curse case (biological humans)",
    "human_welfare": "Human welfare risk",
    "artificial_mind_welfare": "Artificial-mind welfare risk",
    "governance": "Governance risk",
    "safeguard": "Safeguard adequacy",
    "decisive_question": "Decisive open question (alignment)",
    "curse_reason": "Reason for rating (Intelligence Curse)",
}

REGISTER_HEADERS = {
    "id": "Entry ID",
    "source": "Source ID",
    "locator": "Locator",
    "claim": "Exact claim",
    "codes": "Link / milestone / risk ID",
    "family": "Family",
    "feeds": "Ratings it feeds (direction)",
    "source_type": "Source type and independence",
    "outcome": "Outcome addressed",
    "alignment_problem": "Alignment problem",
    "scenario_1": "Scenario code 1",
    "scenario_2": "Scenario code 2",
    "scenario_3": "Scenario code 3",
    "stage": "Stage",
    "directness": "Directness",
    "role": "Evidence role",
    "basis": "Evidence basis",
}

SCOPE_HEADERS = {
    "family": "Technology family / unit of analysis",
    "intervention": "Technology family definition",
    "deployment_scenario": "Deployment scenarios considered (codes → Codebook)",
    "affected_groups": "Target population and affected groups (who benefits / who bears risk)",
    "time_horizon": "Time horizon",
    "comparator": "Comparator",
    "problems_claimed": "Problem(s) claimed to address",
    "source_ids": "Source IDs / basis",
}
SCOPE_CROSS_FAMILY = "Cross-family"
# The cross-family row writes "-" in the columns that don't apply to it.
SCOPE_NOT_APPLICABLE = "-"

MILESTONE_HEADERS = {
    "family": "Family",
    "milestone": "Milestone",
    "applies_to": "Applies to",
    "success_criterion": "Success criterion",
    "status": "Status",
    "criterion_met": "Criterion met?",
    "evidence": "Evidence (entries and basis)",
    "bottleneck": "Main bottleneck",
    "timing": "Timing (dated sources only)",
    "confidence": "Confidence",
    "note": "Note",
}

THEORY_HEADERS = {
    "id": "Link ID",
    "scenario": "Scenario",
    "step": "Step in causal chain",
    "outcome": "Outcome",
    "claim": "Claim",
    "status": "Evidence status",
    "supporting": "Supporting entries",
    "contrary": "Contrary entries",
    "qualifying": "Qualifying entries",
    "best_directness": "Directness of best evidence",
    "assumption": "Assumption still required",
    "objection": "Strongest objection (and whether answered)",
}

SOURCES_HEADERS = {
    "id": "Source ID",
    "added_by": "Added by",
    "category": "Category",
    "claim": "Claim (+/-)",
    "title": "Resource Title",
    "resource_type": "Resource Type",
    "date": "Resource Date",
    "authors": "Author(s)",
    "summary": "3 sentence summary",
    "mechanism": "Mechanism",
    "link": "Link",
    "claim_1": "Claim 1",
    "claim_2": "Claim 2",
    "families": "Families addressed (roll-up)",
    "scenarios": "Scenarios addressed (roll-up)",
    "entries_coded": "Entries coded",
}
# The tab 3 columns row_to_source reads, under the names the Notion export uses.
NOTION_COLUMNS = ["id", "added_by", "category", "claim", "title", "resource_type", "date", "authors", "summary", "mechanism", "link"]

QUALITY_HEADERS = {
    "id": "Source ID",
    "title": "Title (lookup)",
    "source_type": "Source type",
    "empirical_theoretical": "Empirical / theoretical",
    "original_secondary": "Original / secondary",
    "peer_review": "Peer-review status",
    "affiliation": "Affiliation / independence",
}

ALIGNMENT_HEADERS = {
    "family": "Family",
    "scenario": "Scenario",
    "problem": "Problem addressed",
    "mechanism": "Mechanism, or effect on the problem",
    "supporting": "Supporting entries",
    "contrary": "Contrary or qualifying entries",
    "reason": "Main gap, or reason for rating",
    "rating": "Rating",
    "confidence": "Confidence",
    "decisive_question": "Decisive open question",
}
ALIGNMENT_FAMILY_ROW = "Family judgment"

MINDS_HEADERS = {
    "family": "Family",
    "stage": "Stage",
    "consciousness": "Consciousness",
    "moral_status": "Moral status grounded in",
    "identity": "Identity, copying and modification",
    "welfare": "Welfare harms or benefits named",
    "protections": "Protections proposed",
    "sources": "Sources",
    "entries": "Evidence entries",
}
MINDS_FACETS = ["consciousness", "moral_status", "identity", "welfare", "protections"]

CURSE_HEADERS = {
    "family": "Family",
    "mechanism": "Mechanism claimed",
    "who_gains": "Who gains, who loses",
    "who_owns": "Who owns infrastructure, data and returns",
    "replacement": "Complements, delays or deepens replacement?",
    "benefit": "Benefit over comparator",
    "rating": "Rating",
    "confidence": "Confidence",
    "reason": "Reason for rating",
}
# These four columns become the assessment's questions, with the header as the question.
CURSE_QUESTIONS = ["who_gains", "who_owns", "replacement", "benefit"]

AGENCY_HEADERS = {
    "family": "Family",
    "group": "Group or dimension",
    "effect": "Effect",
    "mechanism": "Mechanism",
    "ownership_questions": "Ownership questions (answered in database?)",
    "entries": "Evidence entries",
}
AGENCY_GATE = "Ownership gate"

RISK_HEADERS = {
    "id": "Risk ID",
    "risk": "Risk",
    "family": "Family",
    "domain": "Domain",
    "category": "Category",
    "exposed": "Who is exposed (scale)",
    "severity": "Potential severity",
    "likelihood": "Likelihood",
    "reversibility": "Reversibility",
    "detectability": "Detectability",
    "remedies": "Remedies and safeguards",
    "control": "Who controls / route to exit",
    "confidence": "Confidence",
    "entries": "Evidence entries",
}

GOVERNANCE_HEADERS = {
    "id": "Item",
    "family": "Family",
    "question": "Governance question",
    "status": "Status",
    "entries": "Evidence entries",
    "summary": "Summary",
}

WELFARE_HEADERS = {
    "family": "Family",
    "exposed": "Who is exposed",
    "harms": "Main harms (risk IDs)",
    "human_welfare_severity": "Human welfare: severity",
    "human_welfare_likelihood": "Human welfare: likelihood",
    "human_welfare_confidence": "Human welfare: confidence",
    "artificial_mind_welfare_severity": "Artificial-mind welfare: severity",
    "artificial_mind_welfare_likelihood": "Artificial-mind welfare: likelihood",
    "artificial_mind_welfare_confidence": "Artificial-mind welfare: confidence",
    "governance_severity": "Governance: severity",
    "governance_likelihood": "Governance: likelihood",
    "governance_confidence": "Governance: confidence",
    "safeguards": "Safeguards adequate?",
    "safeguards_confidence": "Safeguards: confidence",
    "rationale": "Rationale",
}

FRAMEWORK_HEADERS = {
    "id": "Ref ID",
    "reference": "Reference",
    "url": "Link",
    "contributes": "What it contributes",
    "applied": "Applied in workbook",
}

# ---------------------------------------------------------------------------
# Controlled values. Every cell in these columns must be one of the keys;
# anything else stops the import instead of being guessed.

FAMILY_BY_NAME = {"WBE": "wbe", "BCI": "bci", "Neuromorphic AI": "neuromorphic"}
ENTRY_FAMILY_BY_NAME = {**FAMILY_BY_NAME, "Cross-family": "cross_family"}
FAMILY_BY_CODE_PREFIX = {"WBE": "wbe", "BCI": "bci", "NM": "neuromorphic"}
CODE_PREFIX_BY_FAMILY = {"wbe": "WBE", "bci": "BCI", "neuromorphic": "NM"}
NAME_BY_FAMILY = {"wbe": "WBE", "bci": "BCI", "neuromorphic": "Neuromorphic AI"}
FAMILIES = ["wbe", "bci", "neuromorphic"]

CASE_RATING = {
    "Strong": "strong",
    "Moderate": "moderate",
    "Weak": "weak",
    "Unclear": "unclear",
    "Not claimed": "not_claimed",
}
CONFIDENCE = {"High": "high", "Medium": "medium", "Low": "low"}
SEVERITY = {"Very high": "very_high", "High": "high", "Medium": "medium", "Low": "low", "Unclear": "unclear"}
LIKELIHOOD = {"High": "high", "Medium": "medium", "Low": "low", "Not assessable": "not_assessable"}
# Tab 9 uses this for a whole domain that doesn't apply (BCI artificial minds).
NOT_APPLICABLE = "Not applicable"
LEVEL = {"High": "high", "Medium": "medium", "Low": "low", "Unclear": "unclear"}
RISK_DOMAIN = {
    "Human welfare": "human_welfare",
    "Artificial-mind welfare": "artificial_mind_welfare",
    "Governance": "governance",
}
MILESTONE_STATUS = {
    "Not demonstrated": "not_demonstrated",
    "Prototype": "prototype",
    "Replicated": "replicated",
    "Mature": "mature",
    "Unclear": "unclear",
}
EVIDENCE_STATUS = {
    "Supporting evidence found": "supporting",
    "Contrary evidence found": "contrary",
    "Conflicting evidence": "conflicting",
    "No relevant evidence found": "no_relevant_evidence",
    "Search incomplete": "search_incomplete",
}
# The site labels not_addressed "Not addressed by any source" (enums.py), so a
# reader who never sees the workbook isn't pointed at its database.
GOVERNANCE_STATUS = {
    "Not addressed in database": "not_addressed",
    "Proposal found": "proposal_found",
    "Evidence found": "evidence_found",
}
AGENCY_EFFECT = {"Strengthens": "strengthens", "Weakens": "weakens", "Mixed": "mixed", "Not addressed": "not_addressed"}
DIRECTNESS = {
    "Direct (family itself)": "direct",
    "Close technical prerequisite": "close_prerequisite",
    "Related NeuroAI system": "related_neuroai",
    "Conceptually relevant only": "conceptual",
}
ROLE = {"Supports": "supports", "Contrary": "contrary", "Qualifies": "qualifies", "Prerequisite only": "prerequisite_only"}
BASIS = {"Demonstrated": "demonstrated", "Projected": "projected", "Argued": "argued", "Assumed": "assumed"}
# Stored as the sheet writes them; the table only guards against typos and new values.
OUTCOME = {value: value for value in ["AI Alignment", "Intelligence Curse", "Both", "Neither"]}
ALIGNMENT_PROBLEM = {value: value for value in ["A-VS", "A-OV", "A-IN", "A-CT", "A-VE", "A-RA", "A-X", "N/A"]}
STAGE = {value: value for value in ["S1", "S2", "S3", "S4", "S5", "S6", "N/A"]}
# "Safeguards adequate?" has its own list (Adequate, Partial, Inadequate, Unclear),
# but the site row uses the case scale. Only Unclear has an agreed meaning there,
# so the others stop the import until the team picks a scale.
SAFEGUARD_RATING = {"Unclear": "unclear"}
SAFEGUARD_UNDECIDED = ["Adequate", "Partial", "Inadequate"]
SCOPE_PROBLEM = {"Both": "both", "Alignment": "alignment", "Intelligence Curse": "intelligence_curse"}
# The arrow is U+2192, as the sheet writes it ("... (S20-S22). → Both").
SCOPE_PROBLEM_SUFFIX = re.compile(r"\s*→\s*(Both|Alignment|Intelligence Curse)\s*$")
# Tab 1a's milestone numbers are a fixed list of the site's categories.
MILESTONE_CATEGORY = {
    "M1": "technical_capability",
    "M2": "high_level_fidelity",
    "M3": "reliability_robustness",
    "M4": "safety_welfare_assurance",
    "M5": "scalable_production",
    "M6": "economic_viability",
    "M7": "legal_regulatory",
    "M8": "institutional_legitimacy",
    "M9": "equitable_access",
}
MILESTONE_HEADER_ROW = re.compile(r"(M\d+) (.+)")
# "Criterion met?" is kept word for word, but it has to be one of these shapes.
CRITERION_MET = re.compile(r"(Yes|Partly|No|Unclear)( \([^()]+\))?")
FEED_NONE = "Not used in a headline rating"
FEED_PATTERN = re.compile(
    r"(WBE|BCI|Neuromorphic AI) (Alignment|Intelligence Curse|(M\d+) (.+?)) \((supports|against or qualifies)(?:, (.+))?\)"
)
FEED_TARGET = {"Alignment": "alignment", "Intelligence Curse": "intelligence_curse"}
FEED_DIRECTION = {"supports": "supports", "against or qualifies": "against_or_qualifies"}

ENTRY_ID = re.compile(r"E\d{3}")
LINK_ID = re.compile(r"(WBE|BCI|NM)-([A-Z])-L\d+")
RISK_ID = re.compile(r"R\d{2}")
GOVERNANCE_ID = re.compile(r"G\d{2}")
FRAMEWORK_ID = re.compile(r"RF\d+")
REGISTER_SOURCE_ID = re.compile(r"S\d{2}")
NOT_ADMISSIBLE = re.compile(r"\b(E\d{3})\s+not admissible\b")
STAGE_LABEL = re.compile(r"(\d+) (.+)")
VERSION_IN_NAME = re.compile(r"(?<![A-Za-z0-9])v(\d+\.\d+)(?![0-9.])")
VERSION_FLAG = re.compile(r"\d+\.\d+")
# Formula fallbacks in the sheet, shown when a lookup fails.
FORMULA_FALLBACKS = ["Source not found", "Not found"]

# ---------------------------------------------------------------------------
# The only edits to the workbook's text.

# A hyphen and a space inside a code ("WBE- O-L6"). Applied to code cells only,
# never to prose. No v0.4 cell has one; the rule stays for later versions.
CODE_SPACE = re.compile(r"(?<=[A-Z0-9])- (?=[A-Z0-9])")
# En dash and em dash, written as code points so this file never contains them.
DASHES = [chr(0x2013), chr(0x2014)]


def entry_range(first: int, last: int) -> list[str]:
    return [f"E{number:03d}" for number in range(first, last + 1)]


# (tab, row ids, column header, exact text before, text after). Each fix only
# applies when the cell still holds the exact "before" text. When Vilija fixes
# a cell herself, the import says the fix is no longer needed instead of
# changing her new text. "'- " is a dash the sheet mangled; a quote at the end
# with none at the start lost its opening quote to the sheet. The last block
# is site wording, not sheet glitches (see its comment).
GLITCH_FIXES: list[tuple[str, list[str], str, str, str]] = [
    # This cell has a mangled dash, and it also names the workbook's search log
    # tab and uses US spelling, so its fix carries the site wording too.
    (
        CODEBOOK,
        ["Display class: Literature unresolved"],
        "Definition",
        "Unclear reasons: Conflicting evidence, Indirect evidence only, Proposal underspecified, Outcome not "
        "operationalized, No relevant evidence found (search documented) '- AND a systematic search is logged as "
        "run in 3 Search Log (Scope starting 'Systematic', Result ≠ 'Not yet run').",
        "Unclear reasons: Conflicting evidence, Indirect evidence only, Proposal underspecified, Outcome not "
        "operationalised, No relevant evidence found (search documented), AND a systematic search has been run "
        "and logged.",
    ),
    (
        CODEBOOK,
        ["Display class: Database insufficient"],
        "Definition",
        "Unclear reasons: Search incomplete, Information inaccessible '- OR any reason while no systematic search "
        "has been run.",
        "Unclear reasons: Search incomplete, Information inaccessible, OR any reason while no systematic search "
        "has been run.",
    ),
    (
        CODEBOOK,
        ["Scenario: BCI-X"],
        "Definition",
        "Other (specify) '- used for the representational-constraint proposal (S01)",
        # Also site wording (2026-11-20): "(specify)" is the sheet's fill-in
        # instruction, which means nothing to a reader.
        "Other, used for the representational-constraint proposal (S01)",
    ),
    (
        REGISTER,
        entry_range(27, 30),
        "Source type and independence",
        "Podcast; Affiliated (co-founder, Zander Labs '- commercial pBCI)",
        "Podcast; Affiliated (co-founder, Zander Labs, commercial pBCI)",
    ),
    (
        REGISTER,
        entry_range(60, 76),
        "Source type and independence",
        "Report; Affiliated (Foresight Institute '- funds and promotes WBE)",
        "Report; Affiliated (Foresight Institute, funds and promotes WBE)",
    ),
    (
        SOURCE_QUALITY,
        ["S08"],
        "Affiliation / independence",
        "Affiliated (co-founder, Zander Labs '- commercial pBCI)",
        "Affiliated (co-founder, Zander Labs, commercial pBCI)",
    ),
    (
        SOURCE_QUALITY,
        ["S16"],
        "Affiliation / independence",
        "Affiliated (Foresight Institute '- funds and promotes WBE)",
        "Affiliated (Foresight Institute, funds and promotes WBE)",
    ),
    (REGISTER, ["E117"], "Locator", "What is neuromorphic AGI?'", "'What is neuromorphic AGI?'"),
    (REGISTER, ["E118"], "Locator", "Comparative safety'", "'Comparative safety'"),
    (REGISTER, ["E119"], "Locator", "Neuromorphic AGI and motivation'", "'Neuromorphic AGI and motivation'"),
    (REGISTER, ["E120"], "Locator", "Promoting safety'", "'Promoting safety'"),
    (REGISTER, ["E121"], "Locator", "Motivational stability'; Conclusion", "'Motivational stability'; Conclusion"),
    (
        MILESTONES,
        ["BCI-M6"],
        "Note",
        "Low cost' statements (S01, S08) do not count as evidence.",
        "'Low cost' statements (S01, S08) do not count as evidence.",
    ),
    # Site wording: workbook references and typos rewritten so readers who never
    # see the workbook can follow them, and US spellings made British to match
    # the rest of Vilija's text (Raghav, 2026-11-20). Tab names, column names,
    # "sheet" and codes the workbook never defines (D03, D05, "IC") become plain
    # words. A few phrases are also reworded for clarity (for example "the use"
    # becomes "the intended use"); the rest of each cell stays as Vilija wrote
    # it. Each fix still applies only while the cell says exactly the "before"
    # text.
    (
        CODEBOOK,
        ["Scenario: *-X / *-C / *-U"],
        "Definition",
        "Other (specify) / cross-cutting (list scenarios covered) / unspecified",
        "Other / cross-cutting / unspecified",
    ),
    (
        CODEBOOK,
        ["Status rule: -"],
        "Definition",
        "Evidence status is set by rule from the Evidence Register: Supporting/Contrary counts only entries with "
        "role Supports/Contrary; 'Conflicting evidence' when both exist and the best tiers differ by ≤1 step; "
        "otherwise the side with the higher-tier entry is recorded and the other noted. Qualifies / "
        "Prerequisite-only entries never set direction. No Supports/Contrary entry → 'Search incomplete' (no "
        "systematic search has been logged), never 'No relevant evidence found'.",
        "Evidence status is set by rule from the evidence register: Supporting/Contrary counts only entries with "
        "role Supports/Contrary; 'Conflicting evidence' when both exist and the best tiers differ by ≤1 step; "
        "otherwise the side with the higher-tier entry is recorded and the other noted. Qualifies / "
        "Prerequisite-only entries never set direction. No Supports/Contrary entry → 'Search incomplete' (no "
        "systematic search has been logged), never 'No relevant evidence found'.",
    ),
    (
        CODEBOOK,
        ["Scenario: NM-E"],
        "Definition",
        "Edge / decentralized deployment",
        "Edge / decentralised deployment",
    ),
    (
        CODEBOOK,
        ["Alignment problem: A-VS"],
        "Definition",
        "Value specification: specifying or learning what the AI should optimize",
        "Value specification: specifying or learning what the AI should optimise",
    ),
    (
        CODEBOOK,
        ["Alignment problem: A-OV"],
        "Definition",
        "Scalable oversight: supervising systems, incl. more capable than the overseer",
        "Scalable oversight: supervising systems, including ones more capable than the overseer",
    ),
    (
        CODEBOOK,
        [
            "Unclear reason: Conflicting evidence / Indirect evidence only / Proposal underspecified / "
            "Outcome not operationalized / No relevant evidence found (search documented)"
        ],
        "Code / value",
        "Conflicting evidence / Indirect evidence only / Proposal underspecified / Outcome not operationalized / "
        "No relevant evidence found (search documented)",
        "Conflicting evidence / Indirect evidence only / Proposal underspecified / Outcome not operationalised / "
        "No relevant evidence found (search documented)",
    ),
    (
        CODEBOOK,
        ["Rating: Unclear"],
        "Definition",
        "No responsible directional judgment; reason mandatory",
        "No responsible directional judgement; reason mandatory",
    ),
    (
        SOURCE_QUALITY,
        ["S03", "S04", "S05", "S06", "S07", "S12", "S16", "S21", "S23", "S24", "S26", "S29"],
        "Original / secondary",
        "Summarizes other work",
        "Summarises other work",
    ),
    (
        MILESTONES,
        ["WBE-M1"],
        "Success criterion",
        "Five prerequisites: (P1) whole-brain scanning of a human brain; (P2) models turning structure into dynamics; "
        "(P3) compute and storage to run in real time; (P4) a validation method; (P5) body and environment "
        "input/output. Met = all five at the scale the use needs. Partly = at least one at mammalian whole-brain scale.",
        "Five prerequisites: (P1) whole-brain scanning of a human brain; (P2) models turning structure into dynamics; "
        "(P3) compute and storage to run in real time; (P4) a validation method; (P5) body and environment "
        "input/output. Met = all five at the scale the intended use needs. Partly = at least one at mammalian "
        "whole-brain scale.",
    ),
    (
        MILESTONES,
        ["WBE-M3"],
        "Success criterion",
        "Fidelity (M2) holds for the subjective runtime the use needs and survives copying.",
        "Fidelity (WBE-M2) holds for the subjective runtime the intended use needs and survives copying.",
    ),
    (
        MILESTONES,
        ["BCI-M3"],
        "Success criterion",
        "Decoding meets M2 across sessions, people and at least 2 task types without full recalibration.",
        "Decoding meets BCI-M2 across sessions, people and at least 2 task types without full recalibration.",
    ),
    (
        MILESTONES,
        ["WBE-M5"],
        "Success criterion",
        "Projected scanning throughput, compute and storage meet the scale the use needs.",
        "Projected scanning throughput, compute and storage meet the scale the intended use needs.",
    ),
    (
        MILESTONES,
        ["WBE-M6"],
        "Note",
        "High-fidelity development estimated at $2-4B over about 10 years (S16, no consensus); S16's figures conflict "
        "(mouse connectome $30-400M vs $2.5-10M low-fidelity). Candidate source on running costs: Andregg 2023.",
        "High-fidelity development estimated at $2-4B over about 10 years (S16, no consensus); S16's figures conflict "
        "(mouse connectome $30-400M vs $2.5-10M low-fidelity). A possible further source on running costs, not yet "
        "reviewed: Andregg 2023.",
    ),
    (
        MILESTONES,
        ["WBE-M7"],
        "Success criterion",
        "A legal basis exists for creating, copying and running emulations in the use.",
        "A legal basis exists for creating, copying and running emulations for the intended use.",
    ),
    (
        REGISTER,
        ["E007"],
        "Exact claim",
        "Speaker shortened her timeline to dangerous AI from 10 to 5 years.",
        "The speaker shortened her timeline to dangerous AI from 10 to 5 years.",
    ),
    (
        REGISTER,
        ["E009", "E010", "E032", "E033", "E034"],
        "Locator",
        "Abstract (per sheet summary)",
        "Abstract (via our source summary)",
    ),
    (REGISTER, ["E031", "E101"], "Locator", "Sheet summary", "Our source summary"),
    (
        REGISTER,
        ["E037"],
        "Exact claim",
        "A workshop judged whole-brain emulation 'high impact, low feasibility'.",
        "A workshop judged whole brain emulation 'high impact, low feasibility'.",
    ),
    (REGISTER, ["E059"], "Link / milestone / risk ID", "IC comparator (D05)", "Intelligence Curse comparator"),
    (REGISTER, ["E085"], "Locator", "Analysis (per sheet summary)", "Analysis (via our source summary)"),
    (
        REGISTER,
        ["E097"],
        "Exact claim",
        "Whole-brain emulations closely resemble human minds, so differential treatment of them is harder to justify.",
        "Whole brain emulations closely resemble human minds, so differential treatment of them is harder to justify.",
    ),
    (REGISTER, ["E102"], "Locator", "§Introduction; review", "Introduction; review"),
    (
        THEORY,
        ["WBE-O-L1"],
        "Assumption still required",
        "Scanning, functional modelling and compute prerequisites all met (see 1a Milestones).",
        "Scanning, functional modelling and compute prerequisites all met (see WBE-M1).",
    ),
    (
        THEORY,
        ["WBE-L-L3"],
        "Claim",
        "Ownership mechanism: the source specifies who owns scans, emulations and compute, and who receives returns "
        "(see Ownership Gate).",
        "Ownership mechanism: the source specifies who owns scans, emulations and compute, and who receives returns "
        "(see the ownership gate).",
    ),
    (
        THEORY,
        ["BCI-E-L7"],
        "Claim",
        "Ownership: productivity gains from enhancement are retained by the user (Ownership Gate: data, firmware, "
        "returns, exit).",
        "Ownership: productivity gains from enhancement are retained by the user (ownership gate: data, firmware, "
        "returns, exit).",
    ),
    (
        THEORY,
        ["NM-E-L3"],
        "Claim",
        "Ownership: users own and control edge models and their returns (see Ownership Gate).",
        "Ownership: users own and control edge models and their returns (see the ownership gate).",
    ),
    (
        SCOPE,
        ["WBE"],
        "Technology family definition",
        "Whole brain emulation: scanning a specific human brain at sufficient resolution and running a computational "
        "model that reproduces that person's cognition (stages S1 component simulation → S6 deployed populations). "
        "Systems that model only parts of a brain are not treated as WBE (e.g., partial emulation and digital twins "
        "(S1-S2)).",
        "Whole brain emulation: scanning a specific human brain at sufficient resolution and running a computational "
        "model that reproduces that person's cognition (stages S1 component simulation → S6 deployed populations). "
        "Systems that model only parts of a brain are not treated as WBE (e.g., partial emulation and digital twins, "
        "stages S1-S2).",
    ),
    (
        SCOPE,
        ["WBE"],
        "Comparator",
        "Alignment: conventional (non-neuro) alignment and oversight methods (S28). IC: labour-replacing AI without "
        "WBE (D05).",
        "Alignment: conventional (non-neuro) alignment and oversight methods (S28). Intelligence Curse: "
        "labour-replacing AI without WBE.",
    ),
    (
        SCOPE,
        ["BCI"],
        "Time horizon",
        "Near for BCI-T, BCI-W, BCI-P (devices in trials or on market: FDA IDE registrations, S16 E075; workplace "
        "EEG, S19). Medium-Long for BCI-D/O/E (only toy-task or argued evidence: S24-S27, S14). S09 claims a 5-year "
        "horizon (not accessed; tier D).",
        "Near for BCI-T, BCI-W, BCI-P (devices in trials or on the market: FDA IDE registrations, S16, E075; "
        "workplace EEG, S19). Medium-Long for BCI-D/O/E (only toy-task or argued evidence: S24-S27, S14). S09 "
        "claims a 5-year horizon (not accessed; tier D).",
    ),
    (
        SCOPE,
        ["BCI"],
        "Comparator",
        "Alignment: RLHF / RLAIF and non-BCI oversight tooling (S28). IC: labour-replacing AI without BCI (D05).",
        "Alignment: RLHF / RLAIF and non-BCI oversight tooling (S28). Intelligence Curse: labour-replacing AI "
        "without BCI.",
    ),
    (
        SCOPE,
        ["BCI"],
        "Problem(s) claimed to address",
        "Alignment: value specification / preference elicitation (BCI-D), oversight (BCI-O), research acceleration "
        "(BCI-E). IC: enhancement keeps humans relevant (BCI-E, argued); disempowerment pathways (BCI-W/S/P). → Both",
        "Alignment: value specification / preference elicitation (BCI-D), oversight (BCI-O), research acceleration "
        "(BCI-E). Intelligence Curse: enhancement keeps humans relevant (BCI-E, argued); disempowerment pathways "
        "(BCI-W/S/P). → Both",
    ),
    (
        SCOPE,
        ["Neuromorphic AI"],
        "Technology family definition",
        "Brain-inspired computing: neuromorphic hardware (spiking, in-memory, self-assembled substrates), "
        "brain-inspired AGI architectures with human-like motivational systems, and models constrained by neural "
        "data. Family boundary open (D03).",
        "Brain-inspired computing: neuromorphic hardware (spiking, in-memory, self-assembled substrates), "
        "brain-inspired AGI architectures with human-like motivational systems, and models constrained by neural "
        "data. Family boundary still open.",
    ),
    (
        SCOPE,
        ["Neuromorphic AI"],
        "Comparator",
        "Alignment: non-neuromorphic AI and standard robustness / interpretability methods (adversarial training: "
        "S13). IC: concentrated cloud AI (D05).",
        "Alignment: non-neuromorphic AI and standard robustness / interpretability methods (adversarial training: "
        "S13). Intelligence Curse: concentrated cloud AI.",
    ),
    (
        SCOPE,
        ["Neuromorphic AI"],
        "Problem(s) claimed to address",
        "Alignment: interpretability/robustness (NM-N), value specification via motivational architecture (NM-A), "
        "verification (NM-H). IC: no source claims a benefit (NM-E decentralisation unclaimed). → Alignment",
        "Alignment: interpretability/robustness (NM-N), value specification via motivational architecture (NM-A), "
        "verification (NM-H). Intelligence Curse: no source claims a benefit (NM-E decentralisation unclaimed). "
        "→ Alignment",
    ),
    (
        ALIGNMENT,
        ["Neuromorphic AI: Family judgment"],
        "Main gap, or reason for rating",
        "S30 (peer-reviewed, affiliated authors) argues brain-like motivational systems make human-style safety "
        "reasoning appropriate, but also lists instability risks and notes the theories are underdetermined. The "
        "only empirical result (S13) is a small-benchmark gain smaller than a non-neural method. Hardware sources "
        "concern governance, not alignment benefit (S05-S07).",
        "S30 (peer-reviewed, affiliated authors) argues brain-like motivational systems make human-style safety "
        "reasoning appropriate, but also lists instability risks and notes the theories are underdetermined. The "
        "only empirical result (S13) is a small-benchmark gain, smaller than that of a non-neural method. Hardware "
        "sources concern governance, not alignment benefit (S05-S07).",
    ),
    (
        ALIGNMENT,
        ["Neuromorphic AI: Neuromorphic hardware"],
        "Mechanism, or effect on the problem",
        "No benefit claimed; records verification and interpretability conditions",
        "No benefit claimed; the entries record verification and interpretability conditions",
    ),
    (
        MINDS,
        ["WBE: 4 Copied emulations"],
        "Identity, copying and modification",
        "Copies are counted individually (S22); copies made on demand, and groups of copies may count as moral "
        "entities (S21); groups of copies (S20, book not read)",
        "Copies are counted individually (S22); copies made on demand and groups of copies may count as moral "
        "entities (S21); groups of copies also come up in S20 (book not yet read)",
    ),
    (
        MINDS,
        ["WBE: 5 Modified emulations"],
        "Identity, copying and modification",
        "Engineering an emulation's values raised (S22); consent to modification not addressed (S16)",
        "Engineering an emulation's values is raised (S22); consent to modification not addressed (S16)",
    ),
    (
        MINDS,
        ["WBE: 6 Deployed populations"],
        "Welfare harms or benefits named",
        "Lives below subsistence as transfers are diluted, or minds with cheap well-being (S22); subsistence wages "
        "and deletion of short-lived copies (S20, verify)",
        "Lives below subsistence as transfers are diluted, or minds with cheap well-being (S22); subsistence wages "
        "and deletion of short-lived copies (S20, unverified)",
    ),
    (
        WELFARE,
        ["Neuromorphic AI"],
        "Rationale",
        "Governance risks are argued by preprints (S05-S07) and one peer-reviewed argument (S30). On-chip learning "
        "defeats weight inspection and countermeasures are immature. Only one risk has a likelihood judgment (S06: "
        "low for current devices).",
        "Governance risks are argued by preprints (S05-S07) and one peer-reviewed argument (S30). On-chip learning "
        "defeats weight inspection and countermeasures are immature. Only one risk has a likelihood judgement (S06: "
        "low for current devices).",
    ),
    (
        FRAMEWORKS,
        ["RF6"],
        "What it contributes",
        "Definition of the outcome measured in §5.",
        "Definition of the outcome rated in the Intelligence Curse case.",
    ),
]

# A new source's summary sentences the site leaves out. S17's third sentence is
# an internal screening note, not a summary (a decision for Raghav). Used only
# when the summary is written: when S17 is added, or with --refresh-source-text.
SUMMARY_TRIMS = {
    "S17": (
        "Examines the integration of neurobiology and brain-inspired AGI. A feasibility limitation does not by itself "
        "demonstrate misalignment. Both the alignment category and claim label are provisional pending verification "
        "of an explicit alignment argument; exclude from the core evidence corpus if none is found.",
        "Examines the integration of neurobiology and brain-inspired AGI. A feasibility limitation does not by itself "
        "demonstrate misalignment.",
    ),
}

# ---------------------------------------------------------------------------
# Where new keys go, so the JSON follows the models' field order. Existing
# keys keep their place; a new key goes after the nearest key before it here.

PAGE_KEY_ORDER = [
    "id",
    "name",
    "short_name",
    "headline",
    "intro",
    "claims_to_solve",
    "mechanism",
    "strongest_case",
    "strongest_objections",
    "scorecard",
    "artificial_minds_questions",
    "alternatives",
    "scope",
    "alignment_assessment",
    "intelligence_curse_assessment",
    "artificial_minds_by_stage",
    "welfare_governance",
    "tension",
    "unreviewed_ai_sections",
]
ROW_KEY_ORDER = [
    "id",
    "dimension",
    "problem",
    "scale",
    "rating",
    "confidence",
    "unclear_reason",
    "severity",
    "likelihood",
    "applicable",
    "basis",
    "tracker",
]
SOURCE_KEY_ORDER = [
    "id",
    "register_id",
    "title",
    "authors",
    "year",
    "url",
    "other_urls",
    "doi",
    "arxiv_id",
    "venue",
    "source_type",
    "kind",
    "technology",
    "problem",
    "claim_directions",
    "evidence_type",
    "directness",
    "independence",
    "relevance",
    "credibility",
    "credibility_unclear_reason",
    "summary",
    "ai_suggested_fields",
    "added_by",
    "reviewed_by",
    "reviewed_on",
    "quality",
    "screening_pending",
    "sample",
]
MILESTONE_KEY_ORDER = [
    "id",
    "name",
    "technology",
    "stage",
    "category",
    "status",
    "status_basis",
    "achieved_in",
    "achieved_in_basis",
    "confidence",
    "summary",
    "success_criterion",
    "main_bottleneck",
    "depends_on",
    "source_ids",
    "estimate",
    "forecasts",
    "disagreement_override",
    "disagreement_note",
    "would_move_earlier",
    "would_move_later",
    "artificial_minds_questions",
    "assessment_confidence",
    "applies_to",
    "criterion_met",
    "evidence_entries",
    "timing",
    "note",
    "sample",
]

# The scorecard rows the workbook fills, by row id (ids never change once public).
ALIGNMENT_ROW = "alignment-case"
CURSE_ROW = "intelligence-curse-case"
SAFEGUARD_ROW = "safeguard-adequacy"
RISK_ROW_DOMAINS = {
    "human-welfare-risk": "human_welfare",
    "artificial-mind-welfare-and-rights-risk": "artificial_mind_welfare",
    "governance-risk": "governance",
}

# What the import may change, per file (see the module docstring). Paths are
# written like [wbe].scorecard[alignment-case].rating: list items with an id
# are named by their id.
PAGE_ALLOWED = [
    re.compile(
        r"\[[a-z]+\]\.scorecard\[[a-z0-9-]+\]\."
        r"(rating|confidence|unclear_reason|severity|likelihood|applicable|basis)([.\[].*)?"
    ),
    re.compile(
        r"\[[a-z]+\]\."
        r"(scope|alignment_assessment|intelligence_curse_assessment|artificial_minds_by_stage|welfare_governance)([.\[].*)?"
    ),
]
SOURCE_FIELDS_ALWAYS = ["quality", "screening_pending", "other_urls"]
SOURCE_FIELDS_REFRESH = ["title", "authors", "summary"]
MILESTONE_FIELDS = [
    "status",
    "status_basis",
    "success_criterion",
    "main_bottleneck",
    "source_ids",
    "assessment_confidence",
    "applies_to",
    "criterion_met",
    "evidence_entries",
    "timing",
    "note",
]
# The 1a cells whose S-ids go into a timeline milestone's source_ids (after
# the sources of its evidence entries), in this order. Keys of the parsed
# assessment.
MILESTONE_SOURCE_CELLS = ["success_criterion", "evidence", "bottleneck", "timing", "note"]


class WorkbookError(Exception):
    """The workbook can't be imported as it is. The message names the tab, row and column."""


# ---------------------------------------------------------------------------
# Text helpers


def tidy_whitespace(text: str) -> str:
    """Trim the cell, and collapse runs of spaces line by line. In-cell line breaks stay."""
    lines = [re.sub(r"[ \t]{2,}", " ", line).strip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def ids_in_text(text: str, letter: str, digits: int) -> list[str]:
    """Every id like S05 in the text, in order, once each. A range "S05-S07"
    stands for every id in between (a mechanical step; the text stays as written).
    The digit count is exact, so stage codes such as S1 are never read as S01."""
    pattern = re.compile(rf"\b{letter}(\d{{{digits}}})\b(?:-{letter}(\d{{{digits}}})\b)?")
    found: list[str] = []
    for match in pattern.finditer(text):
        first = int(match.group(1))
        last = int(match.group(2)) if match.group(2) else first
        if last < first:
            raise WorkbookError(f'"{match.group(0)}" is a range that runs backwards')
        for number in range(first, last + 1):
            found.append(f"{letter}{number:0{digits}d}")
    # dict.fromkeys keeps the first occurrence and the cell's order.
    return list(dict.fromkeys(found))


def insert_in_order(record: dict, key: str, value: object, order: list[str]) -> dict:
    """Set record[key]. An existing key keeps its place; a new one goes after the
    nearest key that comes before it in `order` (or before the nearest after it)."""
    if key in record:
        record[key] = value
        return record
    if key not in order:
        record[key] = value
        return record
    position = order.index(key)
    anchor_after = None
    for earlier in reversed(order[:position]):
        if earlier in record:
            anchor_after = earlier
            break
    anchor_before = None
    if anchor_after is None:
        for later in order[position + 1 :]:
            if later in record:
                anchor_before = later
                break
    items = list(record.items())
    record.clear()
    placed = False
    for existing_key, existing_value in items:
        if anchor_before is not None and existing_key == anchor_before and not placed:
            record[key] = value
            placed = True
        record[existing_key] = existing_value
        if anchor_after is not None and existing_key == anchor_after and not placed:
            record[key] = value
            placed = True
    if not placed:
        record[key] = value
    return record


def canonical_json(data: object) -> str:
    """The one way the import writes JSON: 2-space indent, real characters, newline at the end."""
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Reading the workbook, with every edit and every cell use recorded


@dataclass
class Edit:
    where: str
    before: str
    after: str
    key: tuple[str, int, int]  # (tab, row, column), to sort and filter the report


@dataclass
class Table:
    sheet: str
    header_row: int
    columns: dict[str, int]  # field key -> column index
    headers: dict[str, str]  # field key -> header text
    rows: list[int]  # data rows (not blank), in sheet order


class Book:
    """The workbook plus the import's bookkeeping: which cells it used, what it edited, what it noticed."""

    def __init__(self, sheets: list[Sheet]):
        self.sheets = {sheet.name: sheet for sheet in sheets}
        self.order = [sheet.name for sheet in sheets]
        self.imported: set[tuple[str, int, int]] = set()  # published on the site
        self.checked: set[tuple[str, int, int]] = set()  # read for a check or as a label only
        self.tables: dict[str, list[Table]] = {}
        self.glitch_fixes: list[Edit] = []
        self.whitespace_fixes: list[Edit] = []
        self.code_fixes: list[Edit] = []
        self.other_edits: list[str] = []
        self.exclusions: list[str] = []
        self.warnings: list[str] = []  # consistency findings for the workbook's author
        self.notes: list[str] = []  # what the import did that a reader should know
        self.seen_cells: set[tuple[str, int, int]] = set()
        self.scanned_cells: set[tuple[str, int, int]] = set()
        self.glitch_table: dict[tuple[str, str, str], tuple[str, str]] = {}
        for sheet_name, row_ids, header, before, after in GLITCH_FIXES:
            for row_id in row_ids:
                self.glitch_table[(sheet_name, row_id, header)] = (before, after)
        self.glitch_applied: set[tuple[str, str, str]] = set()
        self.glitch_found: dict[tuple[str, str, str], str] = {}

    def sheet(self, name: str) -> Sheet:
        if name not in self.sheets:
            raise WorkbookError(
                f'the workbook has no tab named "{name}". Its tabs are: {", ".join(self.order)}'
            )
        return self.sheets[name]

    def read(
        self,
        sheet_name: str,
        row: int,
        column: int,
        row_id: str | None = None,
        header: str | None = None,
        code: bool = False,
        use: str = "import",
    ) -> str:
        """One cell's text, tidied, with any listed fix applied. `use` is "import"
        (it goes on the site) or "check" (read for a check or as a label)."""
        sheet = self.sheet(sheet_name)
        raw = sheet.value(row, column)
        where = f"{sheet_name}!{cell_ref(row, column)}"
        key = (sheet_name, row, column)
        first_read = key not in self.seen_cells
        self.seen_cells.add(key)

        text = tidy_whitespace(raw)
        if text != raw and first_read:
            self.whitespace_fixes.append(Edit(where, raw, text, key))
        if code:
            coded = CODE_SPACE.sub("-", text)
            if coded != text and first_read:
                self.code_fixes.append(Edit(where, text, coded, key))
            text = coded
        if row_id is not None and header is not None:
            glitch_key = (sheet_name, row_id, header)
            if glitch_key in self.glitch_table:
                before, after = self.glitch_table[glitch_key]
                self.glitch_found[glitch_key] = text
                if text == before:
                    if first_read:
                        self.glitch_fixes.append(Edit(f"{where} ({row_id}, {header})", before, after, key))
                    self.glitch_applied.add(glitch_key)
                    text = after

        if use == "import":
            for dash in DASHES:
                if dash in text:
                    raise WorkbookError(
                        f"{where} contains a long dash (U+{ord(dash):04X}), which the site never publishes. "
                        "Replace it in the workbook with a comma, colon or parentheses"
                    )
            if text in FORMULA_FALLBACKS:
                raise WorkbookError(f'{where} says "{text}": a lookup formula in the sheet failed. Fix it in the workbook')
            self.imported.add(key)
            if text and key not in self.scanned_cells:
                self.scanned_cells.add(key)
                self.scan_for_glitches(where, text)
        else:
            self.checked.add(key)
        return text

    def scan_for_glitches(self, where: str, text: str) -> None:
        """List suspected glitches the fix table doesn't cover. They are never fixed by guessing."""
        if re.search(r"'-\s", text):
            self.warnings.append(f"{where}: possible mangled dash (\"'- \") with no listed fix: {text!r}")
        for problem in unbalanced_quote_problems(text):
            self.warnings.append(f"{where}: {problem}: {text!r}")

    def find_table(self, sheet_name: str, headers: dict[str, str], start_row: int = 0) -> Table:
        """Find the header row by its full set of header names; map each column by its header text."""
        sheet = self.sheet(sheet_name)
        expected = list(headers.values())
        key_by_header = {text: key for key, text in headers.items()}
        best: tuple[int, int, set[str]] | None = None
        for row in range(start_row, sheet.row_count):
            values = {tidy_whitespace(value) for value in sheet.row_values(row)} - {""}
            if set(expected) <= values:
                unexpected = sorted(values - set(expected))
                if unexpected:
                    raise WorkbookError(
                        f"{sheet_name}: header row {row + 1} has columns the import doesn't know: "
                        f"{', '.join(repr(name) for name in unexpected)}. Add them to the import, or remove them"
                    )
                columns: dict[str, int] = {}
                for column in range(sheet.width(row)):
                    text = tidy_whitespace(sheet.value(row, column))
                    if text == "":
                        continue
                    field_key = key_by_header[text]
                    if field_key in columns:
                        raise WorkbookError(f'{sheet_name}: header "{text}" appears twice in row {row + 1}')
                    columns[field_key] = column
                    self.read(sheet_name, row, column, use="check")
                data_rows = [index for index in range(row + 1, sheet.row_count) if not sheet.is_blank_row(index)]
                table = Table(sheet_name, row, columns, dict(headers), data_rows)
                self.tables.setdefault(sheet_name, []).append(table)
                return table
            overlap = len(set(expected) & values)
            if best is None or overlap > best[1]:
                best = (row, overlap, values)
        if best is None:
            raise WorkbookError(f"{sheet_name}: the tab is empty")
        row, _, values = best
        missing = [name for name in expected if name not in values]
        unexpected = sorted(values - set(expected))
        message = (
            f"{sheet_name}: no row has all the expected headers. The closest is row {row + 1}, "
            f"which is missing {', '.join(repr(name) for name in missing)}"
        )
        if unexpected:
            message += f" and has {', '.join(repr(name) for name in unexpected)} instead"
        raise WorkbookError(message)


def unbalanced_quote_problems(text: str) -> list[str]:
    """A closing single quote with no opening one before it, e.g. "Comparative safety'".
    Apostrophes inside words ("person's") are not quotes and are ignored."""
    problems: list[str] = []
    open_quote = False
    for index, character in enumerate(text):
        if character != "'":
            continue
        before = text[index - 1] if index > 0 else " "
        after = text[index + 1] if index + 1 < len(text) else " "
        if before.isalnum() and after.isalpha():
            continue  # an apostrophe inside a word
        if not before.isalnum() and before not in "?!." and (after.isalnum() or after in "("):
            open_quote = True
        elif open_quote:
            open_quote = False
        elif before == "s" and after == " ":
            continue  # a plural possessive like "users' "
        else:
            problems.append("closing quote with no opening quote, and no listed fix")
            break
    return problems


class TableRow:
    """One data row of a table. Cells are read through the Book, so edits and use are recorded."""

    def __init__(self, book: Book, table: Table, row: int, row_id: str | None = None):
        self.book = book
        self.table = table
        self.row = row
        self.row_id = row_id

    def ref(self, key: str) -> str:
        return f"{self.table.sheet}!{cell_ref(self.row, self.table.columns[key])} ({self.table.headers[key]})"

    def label(self) -> str:
        return f"{self.table.sheet} row {self.row + 1}" + (f" ({self.row_id})" if self.row_id else "")

    def text(self, key: str, code: bool = False, use: str = "import") -> str:
        return self.book.read(
            self.table.sheet,
            self.row,
            self.table.columns[key],
            row_id=self.row_id,
            header=self.table.headers[key],
            code=code,
            use=use,
        )

    def required(self, key: str, code: bool = False) -> str:
        text = self.text(key, code=code)
        if text == "":
            raise WorkbookError(f"{self.ref(key)} is empty, and the site needs it")
        return text

    def optional(self, key: str) -> str | None:
        text = self.text(key)
        return text if text != "" else None

    def choice(self, key: str, values: dict[str, object], allow_empty: bool = False) -> object:
        text = self.text(key)
        if text == "" and allow_empty:
            return None
        if text not in values:
            allowed = ", ".join(repr(value) for value in values)
            raise WorkbookError(f'{self.ref(key)}: "{text}" is not a value the import knows. It expects one of: {allowed}')
        return values[text]

    def id_list(self, key: str, letter: str, digits: int) -> list[str]:
        """A cell that is only a list of ids, like "E037, E043, E065"."""
        text = self.text(key)
        if text == "":
            return []
        single = rf"{letter}\d{{{digits}}}(?:-{letter}\d{{{digits}}})?"
        if not re.fullmatch(rf"{single}(?:\s*[,;]\s*{single})*", text):
            raise WorkbookError(f'{self.ref(key)}: expected only ids like {letter}{"0" * (digits - 1)}1, found "{text}"')
        return ids_in_text(text, letter, digits)


def table_rows(book: Book, table: Table) -> list[TableRow]:
    return [TableRow(book, table, row) for row in table.rows]


# ---------------------------------------------------------------------------
# What the import builds before writing anything


@dataclass
class Parsed:
    title: str = ""
    overview: dict = field(default_factory=dict)
    overview_counts: list[tuple[str, int, str]] = field(default_factory=list)  # (noun, number, cell)
    codebook: list[dict] = field(default_factory=list)
    scenario_codes: set[str] = field(default_factory=set)
    frameworks: list[dict] = field(default_factory=list)
    sources: dict[str, dict] = field(default_factory=dict)  # register id -> tab 3 facts
    quality: dict[str, dict] = field(default_factory=dict)  # register id -> 3a block
    categories: list[dict] = field(default_factory=list)
    category_labels: dict[str, str] = field(default_factory=dict)  # "M1" -> "Technical capability"
    assessments: list[dict] = field(default_factory=list)
    assessment_rows: list[str] = field(default_factory=list)  # row ids like "BCI-M1-1", same order
    entries: list[dict] = field(default_factory=list)
    entry_by_id: dict[str, dict] = field(default_factory=dict)
    links: list[dict] = field(default_factory=list)
    risks: list[dict] = field(default_factory=list)
    governance: list[dict] = field(default_factory=list)
    scope: dict[str, dict] = field(default_factory=dict)
    scope_notes: list[str] = field(default_factory=list)
    cross_family_scope: dict | None = None
    alignment: dict[str, dict] = field(default_factory=dict)
    minds: dict[str, list[dict]] = field(default_factory=dict)
    curse: dict[str, dict] = field(default_factory=dict)
    agency: dict[str, dict] = field(default_factory=dict)
    welfare: dict[str, dict] = field(default_factory=dict)


class Context:
    """The parsed workbook plus helpers that need it (known ids for references)."""

    def __init__(self, book: Book):
        self.book = book
        self.parsed = Parsed()

    def source_slugs(self, text: str, where: str) -> list[str]:
        """The site ids (s05) of the register sources a text cites, ranges expanded."""
        slugs: list[str] = []
        for register_id in ids_in_text(text, "S", 2):
            if register_id not in self.parsed.sources:
                raise WorkbookError(f"{where} cites {register_id}, which is not in {SOURCES}")
            slugs.append(register_id.lower())
        return slugs

    def claim(self, text: str, where: str) -> dict:
        """A team claim holding a workbook cell word for word, citing the sources it names."""
        claim: dict = {"text": text, "provenance": "team"}
        slugs = self.source_slugs(text, where)
        if slugs:
            claim["source_ids"] = slugs
        return claim

    def known_entries(self, ids: list[str], where: str) -> list[str]:
        for entry_id in ids:
            if entry_id not in self.parsed.entry_by_id:
                raise WorkbookError(f"{where} cites {entry_id}, which is not in {REGISTER}")
        return ids


# ---------------------------------------------------------------------------
# One parser per tab


def parse_overview(context: Context) -> None:
    book = context.book
    sheet = book.sheet(OVERVIEW)
    title = book.read(OVERVIEW, 0, 0)
    if title == "":
        raise WorkbookError(f"{OVERVIEW}!A1 is empty; it holds the workbook's title")
    context.parsed.title = title

    # Find the blocks first without marking cells, so the blocks the site leaves
    # out ("Starting point") still show in the unused-cells report.
    blocks: dict[str, list[int]] = {}
    current: str | None = None
    for row in range(1, sheet.row_count):
        text = tidy_whitespace(sheet.value(row, 0))
        if text in OVERVIEW_HEADINGS:
            if text in blocks:
                raise WorkbookError(f'{OVERVIEW}: the heading "{text}" appears twice')
            book.read(OVERVIEW, row, 0, use="check")
            current = text
            blocks[current] = []
        elif text == "":
            current = None
        elif current is not None:
            blocks[current].append(row)
    for heading in (OVERVIEW_PURPOSE, OVERVIEW_PRINCIPLES, OVERVIEW_PROTOCOL):
        if heading not in blocks or not blocks[heading]:
            raise WorkbookError(f'{OVERVIEW}: no "{heading}" heading with text under it in column A')
    if len(blocks[OVERVIEW_PURPOSE]) != 1:
        raise WorkbookError(f'{OVERVIEW}: "{OVERVIEW_PURPOSE}" should have one line under it, found {len(blocks[OVERVIEW_PURPOSE])}')

    context.parsed.overview = {
        "purpose": book.read(OVERVIEW, blocks[OVERVIEW_PURPOSE][0], 0),
        "principles": [book.read(OVERVIEW, row, 0) for row in blocks[OVERVIEW_PRINCIPLES]],
        "update_protocol": [book.read(OVERVIEW, row, 0) for row in blocks[OVERVIEW_PROTOCOL]],
    }
    # The tab list is not published, but its counts are checked against the tabs.
    for row in blocks.get(OVERVIEW_TABS, []):
        text = book.read(OVERVIEW, row, 0, use="check")
        for match in re.finditer(
            r"(\d+) (claim-level entries|causal links|sources|risks|family-specific governance questions)", text
        ):
            context.parsed.overview_counts.append((match.group(2), int(match.group(1)), f"{OVERVIEW}!A{row + 1}"))


def parse_codebook(context: Context) -> None:
    book = context.book
    table = book.find_table(CODEBOOK, CODEBOOK_HEADERS)
    for row in table_rows(book, table):
        row_type = row.required("type")
        # The row id is the type and the code as the sheet writes it. It is set
        # before the code cell is read, so GLITCH_FIXES can fix that cell too
        # (and a fixed code doesn't change the row's id).
        sheet_code = CODE_SPACE.sub("-", tidy_whitespace(book.sheet(CODEBOOK).value(row.row, table.columns["code"])))
        row.row_id = f"{row_type}: {sheet_code}"
        code = row.required("code", code=True)
        context.parsed.codebook.append(
            {"type": row_type, "code": code, "family": row.required("family"), "definition": row.required("definition")}
        )
        if row_type == "Scenario":
            if code.startswith("*-"):
                # The combined row "*-X / *-C / *-U" defines those suffixes for every family prefix.
                for suffix in re.findall(r"\*-([A-Z])", code):
                    for prefix in FAMILY_BY_CODE_PREFIX:
                        context.parsed.scenario_codes.add(f"{prefix}-{suffix}")
            else:
                context.parsed.scenario_codes.add(code)


def parse_sources(context: Context) -> None:
    book = context.book
    table = book.find_table(SOURCES, SOURCES_HEADERS)
    for row in table_rows(book, table):
        register_id = row.required("id", code=True)
        if not REGISTER_SOURCE_ID.fullmatch(register_id):
            raise WorkbookError(f'{row.ref("id")}: "{register_id}" is not a source id like S01')
        if register_id in context.parsed.sources:
            raise WorkbookError(f"{row.ref('id')}: {register_id} appears twice")
        row.row_id = register_id
        context.parsed.sources[register_id] = {"row": row}


def parse_quality(context: Context) -> None:
    book = context.book
    table = book.find_table(SOURCE_QUALITY, QUALITY_HEADERS)
    for row in table_rows(book, table):
        register_id = row.required("id", code=True)
        row.row_id = register_id
        if register_id not in context.parsed.sources:
            raise WorkbookError(f"{row.ref('id')}: {register_id} is not in {SOURCES}")
        if register_id in context.parsed.quality:
            raise WorkbookError(f"{row.ref('id')}: {register_id} appears twice")
        title = row.text("title", use="check")
        sheet_title = context.parsed.sources[register_id]["row"].text("title", use="check")
        if title != sheet_title:
            book.warnings.append(
                f"{row.ref('title')}: {register_id}'s title differs from {SOURCES}: {title!r} vs {sheet_title!r}"
            )
        context.parsed.quality[register_id] = {
            "source_type": row.optional("source_type"),
            "empirical_theoretical": row.optional("empirical_theoretical"),
            "original_secondary": row.optional("original_secondary"),
            "peer_review": row.optional("peer_review"),
            "affiliation": row.optional("affiliation"),
        }


def parse_milestones(context: Context) -> None:
    book = context.book
    table = book.find_table(MILESTONES, MILESTONE_HEADERS)
    category_column = table.columns["family"]
    question_column = table.columns["milestone"]

    # First pass: the row ids, so a split milestone (two rows) gets -1 and -2.
    data_rows: list[tuple[int, str, str]] = []
    current_number: str | None = None
    for row in table.rows:
        first_cell = book.read(MILESTONES, row, category_column, use="check")
        if first_cell in FAMILY_BY_NAME:
            if current_number is None:
                raise WorkbookError(f"{MILESTONES} row {row + 1}: a milestone row before any M1-M9 heading row")
            number = book.read(MILESTONES, row, table.columns["milestone"], code=True, use="check")
            if number != current_number:
                raise WorkbookError(
                    f"{MILESTONES}!{cell_ref(row, table.columns['milestone'])}: says {number!r} under the "
                    f"{current_number} heading"
                )
            data_rows.append((row, FAMILY_BY_NAME[first_cell], number))
            continue
        heading = MILESTONE_HEADER_ROW.fullmatch(first_cell)
        if heading is None or heading.group(1) not in MILESTONE_CATEGORY:
            raise WorkbookError(
                f'{MILESTONES}!{cell_ref(row, category_column)}: "{first_cell}" is neither a family '
                f"({', '.join(FAMILY_BY_NAME)}) nor a heading like \"M1 Technical capability\""
            )
        current_number = heading.group(1)
        if current_number in context.parsed.category_labels:
            raise WorkbookError(f"{MILESTONES} row {row + 1}: the {current_number} heading appears twice")
        question = book.read(MILESTONES, row, question_column)
        if question == "":
            raise WorkbookError(f"{MILESTONES}!{cell_ref(row, question_column)}: the {current_number} question is empty")
        book.read(MILESTONES, row, category_column)  # the label is published
        context.parsed.category_labels[current_number] = heading.group(2)
        context.parsed.categories.append(
            {
                "id": current_number,
                "category": MILESTONE_CATEGORY[current_number],
                "label": heading.group(2),
                "question": question,
            }
        )

    counts: dict[tuple[str, str], int] = {}
    for _, family, number in data_rows:
        counts[(family, number)] = counts.get((family, number), 0) + 1
    seen: dict[tuple[str, str], int] = {}
    for row_index, family, number in data_rows:
        seen[(family, number)] = seen.get((family, number), 0) + 1
        row_id = f"{CODE_PREFIX_BY_FAMILY[family]}-{number}"
        if counts[(family, number)] > 1:
            row_id += f"-{seen[(family, number)]}"
        row = TableRow(book, table, row_index, row_id)
        row.text("family")
        row.text("milestone", code=True)
        criterion_met = row.required("criterion_met")
        if not CRITERION_MET.fullmatch(criterion_met):
            raise WorkbookError(
                f'{row.ref("criterion_met")}: "{criterion_met}" is not Yes, Partly, No or Unclear '
                "(with an optional note in brackets)"
            )
        evidence = row.required("evidence")
        excluded = NOT_ADMISSIBLE.findall(evidence)
        entries = [entry for entry in ids_in_text(evidence, "E", 3) if entry not in excluded]
        for entry_id in excluded:
            book.exclusions.append(
                f'{row.ref("evidence")} ({row_id}): {entry_id} left out of evidence_entries, '
                'the cell says "not admissible"'
            )
        context.parsed.assessments.append(
            {
                "family": family,
                "milestone": number,
                "category": MILESTONE_CATEGORY[number],
                "applies_to": row.required("applies_to"),
                "success_criterion": row.required("success_criterion"),
                "status": row.choice("status", MILESTONE_STATUS),
                "criterion_met": criterion_met,
                "evidence": evidence,
                "evidence_entries": entries,
                "bottleneck": row.optional("bottleneck"),
                "timing": row.optional("timing"),
                "confidence": row.choice("confidence", CONFIDENCE),
                "note": row.optional("note"),
            }
        )
        context.parsed.assessment_rows.append(row_id)


def parse_feeds(text: str, where: str, context: Context) -> list[dict]:
    """Column G: "<Family> <target> (<direction>[, note])", several joined by "; "."""
    if text == FEED_NONE:
        return []
    feeds: list[dict] = []
    for part in [piece.strip() for piece in text.split(";")]:
        match = FEED_PATTERN.fullmatch(part)
        if match is None:
            raise WorkbookError(
                f'{where}: "{part}" is not "<family> <rating> (<direction>)", for example '
                f'"BCI Alignment (supports)" or "WBE M1 Technical capability (against or qualifies)"'
            )
        family_name, target_text, milestone, milestone_label, direction, note = match.groups()
        if milestone is not None:
            label = context.parsed.category_labels.get(milestone)
            if label is None or label != milestone_label:
                raise WorkbookError(
                    f'{where}: "{milestone} {milestone_label}" doesn\'t match the {MILESTONES} heading '
                    f'"{milestone} {label}"'
                )
            target = milestone
        else:
            target = FEED_TARGET[target_text]
        feeds.append(
            {
                "family": FAMILY_BY_NAME[family_name],
                "target": target,
                "direction": FEED_DIRECTION[direction],
                "note": note,
            }
        )
    return feeds


def parse_register(context: Context) -> None:
    book = context.book
    table = book.find_table(REGISTER, REGISTER_HEADERS)
    for row in table_rows(book, table):
        entry_id = row.required("id", code=True)
        if not ENTRY_ID.fullmatch(entry_id):
            raise WorkbookError(f'{row.ref("id")}: "{entry_id}" is not an entry id like E001')
        if entry_id in context.parsed.entry_by_id:
            raise WorkbookError(f"{row.ref('id')}: {entry_id} appears twice")
        row.row_id = entry_id
        register_source = row.required("source", code=True)
        if register_source not in context.parsed.sources:
            raise WorkbookError(f"{row.ref('source')}: {register_source} is not in {SOURCES}")
        codes = [code.strip() for code in row.text("codes", code=True).split(";")]
        scenarios: list[str] = []
        for key in ("scenario_1", "scenario_2", "scenario_3"):
            scenario = row.text(key, code=True)
            if scenario == "":
                continue
            if scenario not in context.parsed.scenario_codes:
                raise WorkbookError(f'{row.ref(key)}: "{scenario}" is not a scenario code in the {CODEBOOK}')
            scenarios.append(scenario)
        feeds_text = row.required("feeds")
        entry = {
            "id": entry_id,
            "source_id": register_source.lower(),
            "register_id": register_source,
            "locator": row.required("locator"),
            "claim": row.required("claim"),
            "codes": [code for code in codes if code != ""],
            "family": row.choice("family", ENTRY_FAMILY_BY_NAME),
            "feeds": parse_feeds(feeds_text, row.ref("feeds"), context),
            "feeds_text": feeds_text,
            "source_type_independence": row.required("source_type"),
            "outcome": row.choice("outcome", OUTCOME),
            "alignment_problem": row.choice("alignment_problem", ALIGNMENT_PROBLEM),
            "scenarios": scenarios,
            "stage": row.choice("stage", STAGE),
            "directness": row.choice("directness", DIRECTNESS),
            "role": row.choice("role", ROLE),
            "basis": row.choice("basis", BASIS),
        }
        context.parsed.entries.append(entry)
        context.parsed.entry_by_id[entry_id] = entry


def parse_theory(context: Context) -> None:
    book = context.book
    table = book.find_table(THEORY, THEORY_HEADERS)
    seen: set[str] = set()
    for row in table_rows(book, table):
        link_id = row.required("id", code=True)
        match = LINK_ID.fullmatch(link_id)
        if match is None:
            raise WorkbookError(f'{row.ref("id")}: "{link_id}" is not a link id like WBE-O-L1')
        if link_id in seen:
            raise WorkbookError(f"{row.ref('id')}: {link_id} appears twice")
        seen.add(link_id)
        row.row_id = link_id
        scenario_code = f"{match.group(1)}-{match.group(2)}"
        if scenario_code not in context.parsed.scenario_codes:
            raise WorkbookError(f'{row.ref("id")}: the scenario code "{scenario_code}" is not in the {CODEBOOK}')
        context.parsed.links.append(
            {
                "id": link_id,
                "family": FAMILY_BY_CODE_PREFIX[match.group(1)],
                "scenario_code": scenario_code,
                "scenario": row.required("scenario"),
                "step": row.required("step"),
                "outcome": row.choice("outcome", OUTCOME),
                "claim": row.required("claim"),
                "status": row.choice("status", EVIDENCE_STATUS),
                "supporting": context.known_entries(row.id_list("supporting", "E", 3), row.ref("supporting")),
                "contrary": context.known_entries(row.id_list("contrary", "E", 3), row.ref("contrary")),
                "qualifying": context.known_entries(row.id_list("qualifying", "E", 3), row.ref("qualifying")),
                "best_directness": row.choice("best_directness", DIRECTNESS, allow_empty=True),
                "assumption": row.optional("assumption"),
                "objection": row.optional("objection"),
            }
        )


def parse_risks(context: Context) -> None:
    book = context.book
    table = book.find_table(RISKS, RISK_HEADERS)
    seen: set[str] = set()
    for row in table_rows(book, table):
        risk_id = row.required("id", code=True)
        if not RISK_ID.fullmatch(risk_id):
            raise WorkbookError(f'{row.ref("id")}: "{risk_id}" is not a risk id like R01')
        if risk_id in seen:
            raise WorkbookError(f"{row.ref('id')}: {risk_id} appears twice")
        seen.add(risk_id)
        row.row_id = risk_id
        families: list[str] = []
        for name in [piece.strip() for piece in row.required("family").split(";")]:
            if name not in FAMILY_BY_NAME:
                raise WorkbookError(f'{row.ref("family")}: "{name}" is not one of {", ".join(FAMILY_BY_NAME)}')
            families.append(FAMILY_BY_NAME[name])
        context.parsed.risks.append(
            {
                "id": risk_id,
                "risk": row.required("risk"),
                "families": list(dict.fromkeys(families)),
                "domain": row.choice("domain", RISK_DOMAIN),
                "category": row.required("category"),
                "exposed": row.required("exposed"),
                "severity": row.choice("severity", SEVERITY),
                "likelihood": row.choice("likelihood", LIKELIHOOD),
                "reversibility": row.choice("reversibility", LEVEL),
                "detectability": row.choice("detectability", LEVEL),
                "remedies": row.required("remedies"),
                "control": row.required("control"),
                "confidence": row.choice("confidence", CONFIDENCE),
                "entries": context.known_entries(row.id_list("entries", "E", 3), row.ref("entries")),
            }
        )


def parse_governance(context: Context) -> None:
    book = context.book
    table = book.find_table(GOVERNANCE, GOVERNANCE_HEADERS)
    seen: set[str] = set()
    for row in table_rows(book, table):
        item_id = row.required("id", code=True)
        if not GOVERNANCE_ID.fullmatch(item_id):
            raise WorkbookError(f'{row.ref("id")}: "{item_id}" is not a checklist id like G01')
        if item_id in seen:
            raise WorkbookError(f"{row.ref('id')}: {item_id} appears twice")
        seen.add(item_id)
        row.row_id = item_id
        context.parsed.governance.append(
            {
                "id": item_id,
                "family": row.choice("family", FAMILY_BY_NAME),
                "question": row.required("question"),
                "status": row.choice("status", GOVERNANCE_STATUS),
                "entries": context.known_entries(row.id_list("entries", "E", 3), row.ref("entries")),
                "summary": row.optional("summary"),
            }
        )


def parse_scope(context: Context) -> None:
    book = context.book
    table = book.find_table(SCOPE, SCOPE_HEADERS)
    # The lines above the header are the tab's own notes (title, key question,
    # the provisional time horizon bands).
    for row in range(table.header_row):
        text = book.read(SCOPE, row, 0)
        if text:
            context.parsed.scope_notes.append(text)

    for row in table_rows(book, table):
        # The family label names the page; it isn't itself published.
        family_name = row.text("family", use="check")
        row.row_id = family_name
        if family_name == SCOPE_CROSS_FAMILY:
            for key in ("affected_groups", "time_horizon", "comparator", "problems_claimed"):
                if row.text(key, use="check") not in ("", SCOPE_NOT_APPLICABLE):
                    # Real text here would be new: leave it in the unused-cells report.
                    book.checked.discard((SCOPE, row.row, table.columns[key]))
            context.parsed.cross_family_scope = {
                "intervention": row.required("intervention"),
                "deployment_scenario": row.optional("deployment_scenario"),
                "source_ids": context.source_slugs(row.text("source_ids"), row.ref("source_ids")),
                "source_ids_text": row.optional("source_ids"),
            }
            continue
        if family_name not in FAMILY_BY_NAME:
            raise WorkbookError(
                f'{row.ref("family")}: "{family_name}" is not one of {", ".join(FAMILY_BY_NAME)} or {SCOPE_CROSS_FAMILY}'
            )
        family = FAMILY_BY_NAME[family_name]
        if family in context.parsed.scope:
            raise WorkbookError(f"{row.label()}: {family_name} appears twice")

        problems_cell = row.required("problems_claimed")
        suffix = SCOPE_PROBLEM_SUFFIX.search(problems_cell)
        if suffix is None:
            raise WorkbookError(
                f'{row.ref("problems_claimed")}: the cell should end with "→ Both", "→ Alignment" or '
                '"→ Intelligence Curse" (the problem the family claims), and it doesn\'t'
            )
        problems_text = problems_cell[: suffix.start()].strip()

        def claim_for(key: str) -> dict:
            return context.claim(row.required(key), row.ref(key))

        context.parsed.scope[family] = {
            "intervention": claim_for("intervention"),
            "deployment_scenario": claim_for("deployment_scenario"),
            "affected_groups": claim_for("affected_groups"),
            "time_horizon": claim_for("time_horizon"),
            "comparator": claim_for("comparator"),
            "problems_claimed": context.claim(problems_text, row.ref("problems_claimed")),
            "problem": SCOPE_PROBLEM[suffix.group(1)],
            "source_ids": context.source_slugs(row.text("source_ids"), row.ref("source_ids")),
            # The cell as written, so a range like "S24-S29" is shown as Vilija wrote it.
            "source_ids_text": row.optional("source_ids"),
        }


def parse_alignment(context: Context) -> None:
    book = context.book
    table = book.find_table(ALIGNMENT, ALIGNMENT_HEADERS)
    for row in table_rows(book, table):
        family = row.choice("family", FAMILY_BY_NAME)
        scenario = row.required("scenario")
        row.row_id = f"{NAME_BY_FAMILY[family]}: {scenario}"
        if scenario == ALIGNMENT_FAMILY_ROW:
            if family in context.parsed.alignment:
                raise WorkbookError(f"{row.label()}: a second {ALIGNMENT_FAMILY_ROW} row for {NAME_BY_FAMILY[family]}")
            context.parsed.alignment[family] = {"row": row, "scenarios": []}
            continue
        if family not in context.parsed.alignment:
            raise WorkbookError(f"{row.label()}: a scenario row before the family's {ALIGNMENT_FAMILY_ROW} row")
        context.parsed.alignment[family]["scenarios"].append(
            {
                "scenario": scenario,
                "problem": row.required("problem"),
                "mechanism": row.optional("mechanism"),
                "supporting": context.known_entries(row.id_list("supporting", "E", 3), row.ref("supporting")),
                "contrary_or_qualifying": context.known_entries(row.id_list("contrary", "E", 3), row.ref("contrary")),
                "gap": row.optional("reason"),
            }
        )
    for family in FAMILIES:
        if family not in context.parsed.alignment:
            raise WorkbookError(f"{ALIGNMENT}: no {ALIGNMENT_FAMILY_ROW} row for {NAME_BY_FAMILY[family]}")


def parse_minds(context: Context) -> None:
    book = context.book
    table = book.find_table(MINDS, MINDS_HEADERS)
    for row in table_rows(book, table):
        family = row.choice("family", FAMILY_BY_NAME)
        stage_label = row.required("stage")
        row.row_id = f"{NAME_BY_FAMILY[family]}: {stage_label}"
        numbered = STAGE_LABEL.fullmatch(stage_label)
        stage_number = int(numbered.group(1)) if numbered else None
        # Keys in the model's field order (ArtificialMindsStage).
        record = {
            "stage": f"S{stage_number}" if stage_number is not None else None,
            "stage_label": stage_label,
            "stage_number": stage_number,
        }
        for facet in MINDS_FACETS:
            record[facet] = row.optional(facet)
        record["source_ids"] = context.source_slugs(row.text("sources"), row.ref("sources"))
        record["entries"] = context.known_entries(row.id_list("entries", "E", 3), row.ref("entries"))
        context.parsed.minds.setdefault(family, []).append(record)
    for family in FAMILIES:
        if family not in context.parsed.minds:
            raise WorkbookError(f"{MINDS}: no rows for {NAME_BY_FAMILY[family]}")


def parse_curse(context: Context) -> None:
    book = context.book
    table = book.find_table(CURSE, CURSE_HEADERS)
    for row in table_rows(book, table):
        family = row.choice("family", FAMILY_BY_NAME)
        row.row_id = NAME_BY_FAMILY[family]
        if family in context.parsed.curse:
            raise WorkbookError(f"{row.label()}: a second row for {NAME_BY_FAMILY[family]}")
        context.parsed.curse[family] = {"row": row}
    for family in FAMILIES:
        if family not in context.parsed.curse:
            raise WorkbookError(f"{CURSE}: no row for {NAME_BY_FAMILY[family]}")


def parse_agency(context: Context) -> None:
    book = context.book
    table = book.find_table(AGENCY, AGENCY_HEADERS)
    for row in table_rows(book, table):
        family = row.choice("family", FAMILY_BY_NAME)
        group = row.required("group")
        row.row_id = f"{NAME_BY_FAMILY[family]}: {group}"
        holder = context.parsed.agency.setdefault(family, {"agency": [], "ownership_gate": None})
        if group == AGENCY_GATE:
            if holder["ownership_gate"] is not None:
                raise WorkbookError(f"{row.label()}: a second {AGENCY_GATE} row for {NAME_BY_FAMILY[family]}")
            # The gate's text sits in the ownership questions column; the other cells are empty.
            holder["ownership_gate"] = row.required("ownership_questions")
            continue
        holder["agency"].append(
            {
                "group": group,
                "effect": row.choice("effect", AGENCY_EFFECT),
                "mechanism": row.optional("mechanism"),
                "ownership_questions": row.optional("ownership_questions"),
                "entries": context.known_entries(row.id_list("entries", "E", 3), row.ref("entries")),
            }
        )
    for family in FAMILIES:
        if family not in context.parsed.agency or context.parsed.agency[family]["ownership_gate"] is None:
            raise WorkbookError(f"{AGENCY}: no {AGENCY_GATE} row for {NAME_BY_FAMILY[family]}")


def parse_welfare(context: Context) -> None:
    book = context.book
    table = book.find_table(WELFARE, WELFARE_HEADERS)
    for row in table_rows(book, table):
        family = row.choice("family", FAMILY_BY_NAME)
        row.row_id = NAME_BY_FAMILY[family]
        if family in context.parsed.welfare:
            raise WorkbookError(f"{row.label()}: a second row for {NAME_BY_FAMILY[family]}")
        domains: dict[str, dict] = {}
        for domain in RISK_ROW_DOMAINS.values():
            severity_text = row.text(f"{domain}_severity")
            likelihood_text = row.text(f"{domain}_likelihood")
            if NOT_APPLICABLE in (severity_text, likelihood_text):
                if severity_text != likelihood_text:
                    raise WorkbookError(
                        f"{row.label()}: {domain} severity is {severity_text!r} but likelihood is "
                        f"{likelihood_text!r}. \"{NOT_APPLICABLE}\" has to be in both or neither"
                    )
                severity = None
                likelihood = None
                applicable = False
            else:
                severity = row.choice(f"{domain}_severity", SEVERITY)
                likelihood = row.choice(f"{domain}_likelihood", LIKELIHOOD)
                applicable = True
            domains[domain] = {
                "severity": severity,
                "likelihood": likelihood,
                "applicable": applicable,
                "confidence": row.choice(f"{domain}_confidence", CONFIDENCE),
                "severity_text": severity_text,
                "likelihood_text": likelihood_text,
            }
        safeguards_text = row.text("safeguards")
        if safeguards_text in SAFEGUARD_UNDECIDED:
            raise WorkbookError(
                f'{row.ref("safeguards")}: "{safeguards_text}" has no agreed place on the site\'s rating scale yet '
                "(only Unclear does). Decide how the safeguard row shows it, then add it to SAFEGUARD_RATING"
            )
        context.parsed.welfare[family] = {
            "row": row,
            "domains": domains,
            "safeguards": row.choice("safeguards", SAFEGUARD_RATING),
            "safeguards_text": safeguards_text,
            "safeguards_confidence": row.choice("safeguards_confidence", CONFIDENCE),
        }
    for family in FAMILIES:
        if family not in context.parsed.welfare:
            raise WorkbookError(f"{WELFARE}: no row for {NAME_BY_FAMILY[family]}")


def parse_frameworks(context: Context) -> None:
    book = context.book
    sheet = book.sheet(FRAMEWORKS)
    table = book.find_table(FRAMEWORKS, FRAMEWORK_HEADERS)
    for row in table_rows(book, table):
        framework_id = row.required("id", code=True)
        if not FRAMEWORK_ID.fullmatch(framework_id):
            raise WorkbookError(f'{row.ref("id")}: "{framework_id}" is not a reference id like RF1')
        row.row_id = framework_id
        link_text = row.text("url")
        urls = URL_PATTERN.findall(link_text)
        rel_link = sheet.links.get((row.row, table.columns["url"]))
        # The cell's own text wins; the hyperlink behind it is the fallback.
        if urls:
            url = urls[0].rstrip(".,")
            if rel_link is not None and rel_link != url:
                book.warnings.append(f"{row.ref('url')}: the cell says {url} but its hyperlink goes to {rel_link}")
        elif rel_link is not None:
            url = rel_link
        else:
            raise WorkbookError(f"{row.ref('url')}: no link in the cell text or behind it")
        context.parsed.frameworks.append(
            {
                "id": framework_id,
                "reference": row.required("reference"),
                "url": url,
                "contributes": row.required("contributes"),
                "applied": row.required("applied"),
            }
        )


# ---------------------------------------------------------------------------
# Building the page sections from the judgment tabs (the Synopsis is only a cross-check)


def alignment_assessment(context: Context, family: str) -> dict:
    holder = context.parsed.alignment[family]
    row: TableRow = holder["row"]
    return {
        "problem_addressed": row.required("problem"),
        "mechanism": context.claim(row.required("mechanism"), row.ref("mechanism")),
        "questions": [],
        "rating": row.choice("rating", CASE_RATING),
        "confidence": row.choice("confidence", CONFIDENCE),
        "unclear_reason": None,
        "reason": context.claim(row.required("reason"), row.ref("reason")),
        "decisive_question": context.claim(row.required("decisive_question"), row.ref("decisive_question")),
        "scenarios": holder["scenarios"],
    }


def curse_assessment(context: Context, family: str) -> dict:
    row: TableRow = context.parsed.curse[family]["row"]
    questions = []
    for key in CURSE_QUESTIONS:
        questions.append({"question": CURSE_HEADERS[key], "answer": context.claim(row.required(key), row.ref(key))})
    agency = context.parsed.agency[family]
    return {
        "mechanism": context.claim(row.required("mechanism"), row.ref("mechanism")),
        "questions": questions,
        "rating": row.choice("rating", CASE_RATING),
        "confidence": row.choice("confidence", CONFIDENCE),
        "unclear_reason": None,
        "reason": context.claim(row.required("reason"), row.ref("reason")),
        "decisive_question": None,
        "agency": agency["agency"],
        "ownership_gate": agency["ownership_gate"],
    }


def welfare_governance(context: Context, family: str) -> dict:
    row: TableRow = context.parsed.welfare[family]["row"]
    return {
        "exposed": context.claim(row.required("exposed"), row.ref("exposed")),
        "harms": context.claim(row.required("harms"), row.ref("harms")),
        "rationale": context.claim(row.required("rationale"), row.ref("rationale")),
    }


def row_updates(context: Context, family: str) -> dict[str, dict]:
    """The workbook fields of each scorecard row, by row id, in the rows' key order."""
    alignment = alignment_assessment(context, family)
    curse = curse_assessment(context, family)
    welfare = context.parsed.welfare[family]
    welfare_row: TableRow = welfare["row"]
    updates: dict[str, dict] = {
        ALIGNMENT_ROW: {
            "rating": alignment["rating"],
            "confidence": alignment["confidence"],
            "unclear_reason": None,
            "basis": alignment["reason"],
        },
        CURSE_ROW: {
            "rating": curse["rating"],
            "confidence": curse["confidence"],
            "unclear_reason": None,
            "basis": curse["reason"],
        },
        SAFEGUARD_ROW: {
            "rating": welfare["safeguards"],
            "confidence": welfare["safeguards_confidence"],
            "unclear_reason": None,
            "basis": context.claim(welfare_row.required("rationale"), welfare_row.ref("rationale")),
        },
    }
    for row_id, domain in RISK_ROW_DOMAINS.items():
        facts = welfare["domains"][domain]
        updates[row_id] = {
            "rating": None,
            "confidence": facts["confidence"],
            "severity": facts["severity"],
            "likelihood": facts["likelihood"],
            "applicable": facts["applicable"],
            "basis": None,
        }
    return updates


# Keys a case row or a risk row must not keep (the import owns them on scorecard rows).
CASE_ROW_DROPPED = ["severity", "likelihood", "applicable"]
RISK_ROW_DROPPED = ["unclear_reason"]


def update_pages(pages: list[dict], context: Context) -> list[dict]:
    pages = copy.deepcopy(pages)
    by_id = {page.get("id"): page for page in pages}
    for family in FAMILIES:
        page = by_id.get(family)
        if page is None:
            raise WorkbookError(f'technologies.json has no page with id "{family}"')
        rows_by_id = {row.get("id"): row for row in page.get("scorecard", [])}
        for row_id, fields in row_updates(context, family).items():
            row = rows_by_id.get(row_id)
            if row is None:
                raise WorkbookError(f'technologies.json page "{family}" has no scorecard row "{row_id}"')
            dropped = RISK_ROW_DROPPED if row_id in RISK_ROW_DOMAINS else CASE_ROW_DROPPED
            for key in dropped:
                row.pop(key, None)
            for key, value in fields.items():
                insert_in_order(row, key, value, ROW_KEY_ORDER)
        insert_in_order(page, "scope", context.parsed.scope[family], PAGE_KEY_ORDER)
        insert_in_order(page, "alignment_assessment", alignment_assessment(context, family), PAGE_KEY_ORDER)
        insert_in_order(page, "intelligence_curse_assessment", curse_assessment(context, family), PAGE_KEY_ORDER)
        insert_in_order(page, "artificial_minds_by_stage", context.parsed.minds[family], PAGE_KEY_ORDER)
        insert_in_order(page, "welfare_governance", welfare_governance(context, family), PAGE_KEY_ORDER)
    return pages


def build_scorecard(context: Context, version: str, sha256: str) -> dict:
    parsed = context.parsed
    scorecard = {
        "generated": GENERATED_NOTE,
        "workbook": {"title": parsed.title, "version": version, "source_sha256": sha256},
        "overview": parsed.overview,
        "codebook": parsed.codebook,
        "frameworks": parsed.frameworks,
        "milestone_categories": parsed.categories,
        "milestone_assessments": parsed.assessments,
        "entries": parsed.entries,
        "links": parsed.links,
        "risks": parsed.risks,
        "governance": parsed.governance,
        # The Scope tab's own notes (the rows above its header, including the
        # provisional time horizon bands) and its Cross-family row.
        "scope_notes": parsed.scope_notes,
        "cross_family_scope": parsed.cross_family_scope,
    }
    return scorecard


def notion_row(context: Context, register_id: str) -> dict[str, str]:
    """A tab 3 row under the Notion export's column names, for row_to_source."""
    row: TableRow = context.parsed.sources[register_id]["row"]
    values: dict[str, str] = {}
    for key in NOTION_COLUMNS:
        text = row.text(key)
        if key == "date":
            text = str(year_of(row))
        values[SOURCES_HEADERS[key]] = text
    return values


def year_of(row: TableRow) -> int:
    """Resource Date is stored as a number ("2023.0"). A year outside 1800-2100
    is most likely an Excel date serial, so it stops the import."""
    text = row.text("date")
    match = re.fullmatch(r"(\d{4})(?:\.0+)?", text)
    if match is None or not 1800 <= int(match.group(1)) <= 2100:
        raise WorkbookError(f'{row.ref("date")}: "{text}" is not a year between 1800 and 2100')
    return int(match.group(1))


def link_urls(context: Context, register_id: str) -> list[str]:
    row: TableRow = context.parsed.sources[register_id]["row"]
    text = row.text("link")
    urls = [url.rstrip(".,") for url in URL_PATTERN.findall(text)]
    leftover = URL_PATTERN.sub("", text).strip()
    if leftover:
        context.book.notes.append(
            f"{row.ref('link')}: link labels have no field on the site and are not imported: "
            + " | ".join(line.strip() for line in leftover.split("\n") if line.strip())
        )
    if not urls:
        rel_link = context.book.sheet(SOURCES).links.get((row.row, row.table.columns["link"]))
        if rel_link is not None:
            urls = [rel_link]
    return urls


def summary_text(context: Context, register_id: str) -> str:
    row: TableRow = context.parsed.sources[register_id]["row"]
    text = row.required("summary")
    if register_id in SUMMARY_TRIMS:
        before, after = SUMMARY_TRIMS[register_id]
        if text != before:
            raise WorkbookError(
                f"{row.ref('summary')}: {register_id}'s summary is not the text SUMMARY_TRIMS expects. "
                "Check what to publish, then update SUMMARY_TRIMS"
            )
        context.book.other_edits.append(
            f"{row.ref('summary')}: {register_id} summary published as its first sentences only: {after!r}"
        )
        return after
    return text


def update_sources(sources: list[dict], context: Context, refresh_source_text: bool) -> tuple[list[dict], list[str]]:
    """Returns the new list and the ids of the sources it added."""
    sources = copy.deepcopy(sources)
    book = context.book
    by_register: dict[str, dict] = {}
    for source in sources:
        if source.get("register_id") and not source.get("sample"):
            by_register[source["register_id"]] = source

    added: list[str] = []
    differs: dict[str, list[str]] = {"titles": [], "summaries": [], "author lists": []}
    for register_id in context.parsed.sources:
        row: TableRow = context.parsed.sources[register_id]["row"]
        pending = is_screening_pending(row.text("resource_type"))
        is_new = register_id not in by_register
        if is_new:
            warnings: list[str] = []
            record = row_to_source(notion_row(context, register_id), warnings, admit_screening_pending=True)
            for warning in warnings:
                book.notes.append(f"{SOURCES} {warning}")
            if record is None:
                raise WorkbookError(f"{row.label()}: {register_id} can't be added as a source (see the notes above)")
            record["summary"]["text"] = summary_text(context, register_id)
            if any(existing.get("id") == record["id"] for existing in sources):
                raise WorkbookError(f'{row.label()}: the site already has a source with id "{record["id"]}"')
            position = insert_position(sources, register_id)
            sources.insert(position, record)
            by_register[register_id] = record
            added.append(record["id"])
            book.notes.append(f"added source {register_id} ({record['title']}) to sources.json")
        source = by_register[register_id]

        if register_id in context.parsed.quality:
            insert_in_order(source, "quality", context.parsed.quality[register_id], SOURCE_KEY_ORDER)
        if pending:
            insert_in_order(source, "screening_pending", True, SOURCE_KEY_ORDER)
        else:
            source.pop("screening_pending", None)

        urls = link_urls(context, register_id)
        if urls and urls[0] != source.get("url") and urls[0] not in source.get("other_urls", []):
            book.warnings.append(
                f"{row.ref('link')}: {register_id}'s first link {urls[0]} is not the site's url {source.get('url')}"
            )
        known = [source.get("url")] + list(source.get("other_urls", []))
        missing = [url for url in urls if url not in known]
        if missing:
            insert_in_order(source, "other_urls", list(source.get("other_urls", [])) + missing, SOURCE_KEY_ORDER)

        if refresh_source_text and not is_new:
            source["title"] = row.required("title")
            source["authors"] = parse_authors(row.text("authors"), register_id)
            source["summary"]["text"] = summary_text(context, register_id)
        elif not is_new:
            # Not imported for existing sources, but compared, so a reader knows how far the site differs.
            if row.text("title", use="check") != source.get("title"):
                differs["titles"].append(register_id)
            if row.text("summary", use="check") != source.get("summary", {}).get("text"):
                differs["summaries"].append(register_id)
            if parse_authors(row.text("authors", use="check"), register_id) != source.get("authors"):
                differs["author lists"].append(register_id)
            for key in ("date", "added_by", "category", "claim", "mechanism"):
                row.text(key, use="check")
            if year_of(row) != source.get("year"):
                book.warnings.append(
                    f"{row.ref('date')}: {register_id} year is {year_of(row)} in the sheet, {source.get('year')} on the site"
                )
    if any(differs.values()):
        parts = [f"{len(ids)} {kind} ({short_list(ids, 30)})" for kind, ids in differs.items() if ids]
        book.notes.append(
            f"{SOURCES}: the site keeps its own approved text where it differs from the sheet: {'; '.join(parts)}. "
            "Pass --refresh-source-text to replace titles, authors and summaries with the sheet's"
        )
    return sources, added


def insert_position(sources: list[dict], register_id: str) -> int:
    """After the register source with the highest number below this one (S17 goes after s16)."""
    number = int(register_id[1:])
    best: tuple[int, int] | None = None  # (register number, index)
    for index, source in enumerate(sources):
        other = source.get("register_id")
        if other and not source.get("sample") and REGISTER_SOURCE_ID.fullmatch(other):
            other_number = int(other[1:])
            if other_number < number and (best is None or other_number > best[0]):
                best = (other_number, index)
    if best is not None:
        return best[1] + 1
    for index, source in enumerate(sources):
        if source.get("register_id") and not source.get("sample"):
            return index
    return len(sources)


def update_milestones(milestones: list[dict], context: Context) -> tuple[list[dict], list[str]]:
    """The WBE timeline milestones, matched by category to tab 1a's WBE rows. Returns the ids updated."""
    milestones = copy.deepcopy(milestones)
    updated: list[str] = []
    seen_categories: set[str] = set()
    for assessment, row_id in zip(context.parsed.assessments, context.parsed.assessment_rows):
        if assessment["family"] != "wbe":
            continue
        category = assessment["category"]
        if category in seen_categories:
            raise WorkbookError(f"{MILESTONES}: two WBE rows for {assessment['milestone']}; the timeline can't take both")
        seen_categories.add(category)
        matches = [
            milestone
            for milestone in milestones
            if milestone.get("technology") == "wbe" and not milestone.get("sample") and milestone.get("category") == category
        ]
        if not matches:
            context.book.notes.append(
                f"{MILESTONES} {row_id}: no WBE timeline milestone has category {category}; "
                "the row shows on the technology page only"
            )
            continue
        if len(matches) > 1:
            ids = ", ".join(milestone["id"] for milestone in matches)
            raise WorkbookError(f"milestones.json: several WBE milestones have category {category} ({ids})")
        milestone = matches[0]
        evidence_sources: list[str] = []
        for entry_id in assessment["evidence_entries"]:
            evidence_sources.append(context.parsed.entry_by_id[entry_id]["source_id"])
        where = f"{MILESTONES} {row_id}"
        status_basis = context.claim(assessment["evidence"], where)
        cited = list(dict.fromkeys(evidence_sources + status_basis.get("source_ids", [])))
        if cited:
            status_basis["source_ids"] = cited
        # Every source the row cites: its entries' sources, then the S-ids in
        # its cells, each once, in the order first seen.
        row_sources = list(evidence_sources)
        for key in MILESTONE_SOURCE_CELLS:
            if assessment[key]:
                row_sources.extend(context.source_slugs(assessment[key], where))
        fields = {
            "status": assessment["status"],
            "status_basis": status_basis,
            "success_criterion": context.claim(assessment["success_criterion"], where),
            "main_bottleneck": context.claim(assessment["bottleneck"], where) if assessment["bottleneck"] else None,
            "source_ids": list(dict.fromkeys(row_sources)),
            "assessment_confidence": assessment["confidence"],
            "applies_to": assessment["applies_to"],
            "criterion_met": assessment["criterion_met"],
            "evidence_entries": assessment["evidence_entries"],
            "timing": assessment["timing"],
            "note": assessment["note"],
        }
        for key, value in fields.items():
            insert_in_order(milestone, key, value, MILESTONE_KEY_ORDER)
        updated.append(milestone["id"])
        context.book.notes.append(
            f"timeline milestone {milestone['id']} (name kept: {milestone.get('name')!r}) now carries {row_id}: "
            f"{assessment['success_criterion']!r}"
        )
    return milestones, updated


# ---------------------------------------------------------------------------
# The allowlist: compare old and new JSON, and refuse any change outside it


def changed_paths(old: object, new: object, path: str = "") -> list[str]:
    """Every path where old and new differ. Lists of records with unique ids are
    matched by id, so an insertion doesn't make every later item look changed."""
    if type(old) is not type(new):
        return [path]
    if isinstance(old, dict) and isinstance(new, dict):
        paths: list[str] = []
        for key in list(old) + [key for key in new if key not in old]:
            child = f"{path}.{key}" if path else key
            if key not in old or key not in new:
                paths.append(child)
            else:
                paths.extend(changed_paths(old[key], new[key], child))
        return paths
    if isinstance(old, list) and isinstance(new, list):
        if records_with_ids(old) and records_with_ids(new):
            old_by_id = {item["id"]: item for item in old}
            new_by_id = {item["id"]: item for item in new}
            paths = []
            for item_id in list(old_by_id) + [item_id for item_id in new_by_id if item_id not in old_by_id]:
                child = f"{path}[{item_id}]"
                if item_id not in old_by_id or item_id not in new_by_id:
                    paths.append(child)
                else:
                    paths.extend(changed_paths(old_by_id[item_id], new_by_id[item_id], child))
            return paths
        return [] if old == new else [path]
    return [] if old == new else [path]


def records_with_ids(items: list) -> bool:
    if not items or not all(isinstance(item, dict) and isinstance(item.get("id"), str) for item in items):
        return False
    ids = [item["id"] for item in items]
    return len(ids) == len(set(ids))


def source_patterns(register_slugs: list[str], added: list[str], refresh_source_text: bool) -> list[re.Pattern]:
    fields = SOURCE_FIELDS_ALWAYS + (SOURCE_FIELDS_REFRESH if refresh_source_text else [])
    patterns = []
    if register_slugs:
        slugs = "|".join(re.escape(slug) for slug in register_slugs)
        patterns.append(re.compile(rf"\[({slugs})\]\.({'|'.join(fields)})([.\[].*)?"))
    for slug in added:
        patterns.append(re.compile(rf"\[{re.escape(slug)}\]"))
    return patterns


def milestone_patterns(updated: list[str]) -> list[re.Pattern]:
    if not updated:
        return []
    ids = "|".join(re.escape(milestone_id) for milestone_id in updated)
    return [re.compile(rf"\[({ids})\]\.({'|'.join(MILESTONE_FIELDS)})([.\[].*)?")]


def check_allowed(name: str, old: object, new: object, patterns: list[re.Pattern]) -> None:
    for path in changed_paths(old, new):
        if not any(pattern.fullmatch(path) for pattern in patterns):
            raise RuntimeError(f"bug in the import: it changed {name} {path}, which it does not own")


# ---------------------------------------------------------------------------
# Consistency checks. These never change the output; they list what the
# workbook's author should look at.


def check_overview_counts(context: Context) -> None:
    parsed = context.parsed
    actual = {
        "claim-level entries": len(parsed.entries),
        "causal links": len(parsed.links),
        "sources": len(parsed.sources),
        "risks": len(parsed.risks),
        "family-specific governance questions": len(parsed.governance),
    }
    for noun, number, where in parsed.overview_counts:
        if actual[noun] != number:
            context.book.warnings.append(f"{where} says {number} {noun}, but the tab has {actual[noun]}")


def check_synopsis(context: Context) -> None:
    """The Synopsis is formula output over tabs 4, 5 and 9. The judgment tabs win; differences are listed."""
    book = context.book
    sheet = book.sheet(SYNOPSIS)
    header_row = None
    columns: dict[str, int] = {}
    for row in range(sheet.row_count):
        values = [tidy_whitespace(value) for value in sheet.row_values(row)]
        if all(name in values for name in SYNOPSIS_FAMILY_HEADERS.values()):
            header_row = row
            for family, name in SYNOPSIS_FAMILY_HEADERS.items():
                columns[family] = values.index(name)
                book.read(SYNOPSIS, row, values.index(name), use="check")
            break
    if header_row is None:
        book.warnings.append(f"{SYNOPSIS}: no header row with {', '.join(SYNOPSIS_FAMILY_HEADERS.values())}; not cross-checked")
        return
    label_rows: dict[str, int] = {}
    for row in range(header_row + 1, sheet.row_count):
        label = book.read(SYNOPSIS, row, 0, use="check")
        for key, text in SYNOPSIS_ROWS.items():
            if label == text:
                label_rows[key] = row
    for key, text in SYNOPSIS_ROWS.items():
        if key not in label_rows:
            book.warnings.append(f'{SYNOPSIS}: no row labelled "{text}"; not cross-checked')

    def case_text(rating_label: str, confidence_label: str) -> str:
        return f"{rating_label} ({confidence_label.lower()} confidence)"

    for family in FAMILIES:
        alignment_row: TableRow = context.parsed.alignment[family]["row"]
        curse_row: TableRow = context.parsed.curse[family]["row"]
        welfare = context.parsed.welfare[family]
        welfare_row: TableRow = welfare["row"]
        expected = {
            "alignment": case_text(alignment_row.text("rating"), alignment_row.text("confidence")),
            "intelligence_curse": case_text(curse_row.text("rating"), curse_row.text("confidence")),
            "safeguard": case_text(welfare["safeguards_text"], welfare_row.text("safeguards_confidence")),
            "decisive_question": alignment_row.text("decisive_question"),
            "curse_reason": curse_row.text("reason"),
        }
        for domain in RISK_ROW_DOMAINS.values():
            facts = welfare["domains"][domain]
            confidence = welfare_row.text(f"{domain}_confidence").lower()
            if facts["applicable"]:
                expected[domain] = (
                    f"Severity {facts['severity_text'].lower()}; likelihood {facts['likelihood_text'].lower()} "
                    f"({confidence} confidence)"
                )
            else:
                expected[domain] = f"{NOT_APPLICABLE} ({confidence} confidence)"
        for key, value in expected.items():
            if key not in label_rows:
                continue
            synopsis_value = book.read(SYNOPSIS, label_rows[key], columns[family], use="check")
            if synopsis_value != value:
                book.warnings.append(
                    f"{SYNOPSIS}!{cell_ref(label_rows[key], columns[family])} ({NAME_BY_FAMILY[family]}, "
                    f'{SYNOPSIS_ROWS[key]}) says "{synopsis_value}", but the judgment tab gives "{value}". '
                    "The import uses the judgment tab"
                )


def check_undefined_codes(context: Context) -> None:
    parsed = context.parsed
    defined = {link["id"] for link in parsed.links}
    defined |= {risk["id"] for risk in parsed.risks}
    defined |= {item["id"] for item in parsed.governance}
    defined |= {f"{CODE_PREFIX_BY_FAMILY[a['family']]}-{a['milestone']}" for a in parsed.assessments}
    unknown: dict[str, list[str]] = {}
    for entry in parsed.entries:
        for code in entry["codes"]:
            if code not in defined:
                unknown.setdefault(code, []).append(entry["id"])
    for code, entry_ids in unknown.items():
        context.book.warnings.append(
            f'{REGISTER} "{REGISTER_HEADERS["codes"]}": "{code}" (in {", ".join(entry_ids)}) matches no link, '
            "milestone, risk or checklist id, and no tab defines it"
        )

    codebook_problems = {row["code"] for row in parsed.codebook if row["type"] == "Alignment problem"}
    used_problems = list(dict.fromkeys(entry["alignment_problem"] for entry in parsed.entries))
    for code in used_problems:
        if code != "N/A" and code not in codebook_problems:
            count = sum(1 for entry in parsed.entries if entry["alignment_problem"] == code)
            context.book.warnings.append(
                f'{REGISTER} "{REGISTER_HEADERS["alignment_problem"]}": "{code}" is used {count} times but the '
                f"{CODEBOOK} does not define it"
            )

    stages_by_family: dict[str, set[str]] = {}
    for row in parsed.codebook:
        if row["type"] == "Stage" and row["family"] in FAMILY_BY_NAME:
            stages_by_family.setdefault(FAMILY_BY_NAME[row["family"]], set()).add(row["code"])
    for entry in parsed.entries:
        family = entry["family"]
        if entry["stage"] != "N/A" and family in stages_by_family and entry["stage"] not in stages_by_family[family]:
            context.book.warnings.append(
                f"{REGISTER} {entry['id']}: stage {entry['stage']} is not a {NAME_BY_FAMILY[family]} stage in the {CODEBOOK}"
            )

    # Codes like D05 in any published cell. A cell whose fix removed the code is
    # still listed, marked as already fixed on the site.
    seen: dict[str, list[str]] = {}
    for where, text, site_text in published_texts(context):
        for code in re.findall(r"\bD\d{2}\b", text):
            on_site = re.search(rf"\b{code}\b", site_text) is not None
            seen.setdefault(code, []).append(where if on_site else f"{where} ({FIXED_ON_SITE})")
    for code, places in seen.items():
        context.book.warnings.append(f'"{code}" appears in {", ".join(dict.fromkeys(places))}, but no tab defines it')


def check_back_references(context: Context) -> None:
    """Where a tab cites an entry for an item, the entry's own column E should name that item."""
    parsed = context.parsed
    warnings = context.book.warnings

    def codes_of(entry_id: str) -> list[str]:
        return parsed.entry_by_id[entry_id]["codes"]

    def report(where: str, item: str, entry_id: str) -> None:
        codes = "; ".join(codes_of(entry_id)) or "(empty)"
        warnings.append(f'{where} cites {entry_id} for {item}, but {entry_id}\'s "{REGISTER_HEADERS["codes"]}" is "{codes}"')

    for link in parsed.links:
        for entry_id in link["supporting"] + link["contrary"] + link["qualifying"]:
            if link["id"] not in codes_of(entry_id):
                report(f"{THEORY} {link['id']}", link["id"], entry_id)
    for risk in parsed.risks:
        for entry_id in risk["entries"]:
            if risk["id"] not in codes_of(entry_id):
                report(f"{RISKS} {risk['id']}", risk["id"], entry_id)
    for item in parsed.governance:
        for entry_id in item["entries"]:
            if item["id"] not in codes_of(entry_id):
                report(f"{GOVERNANCE} {item['id']}", item["id"], entry_id)
    for assessment, row_id in zip(parsed.assessments, parsed.assessment_rows):
        code = f"{CODE_PREFIX_BY_FAMILY[assessment['family']]}-{assessment['milestone']}"
        for entry_id in assessment["evidence_entries"]:
            if code not in codes_of(entry_id):
                report(f"{MILESTONES} {row_id} ({assessment['applies_to']})", code, entry_id)
    for family, stages in parsed.minds.items():
        for stage in stages:
            for entry_id in stage["entries"]:
                if "AM" not in codes_of(entry_id):
                    report(f'{MINDS} {NAME_BY_FAMILY[family]} "{stage["stage_label"]}"', "AM", entry_id)


def check_alignment_against_register(context: Context) -> None:
    """Tab 4's scenario entry lists against the register's column G. Rating cards
    use column G; tab 4's rows are shown as written. Never reconciled in code."""
    parsed = context.parsed
    for family in FAMILIES:
        tab_support: list[str] = []
        tab_against: list[str] = []
        for scenario in parsed.alignment[family]["scenarios"]:
            tab_support.extend(scenario["supporting"])
            tab_against.extend(scenario["contrary_or_qualifying"])
        g_support: list[str] = []
        g_against: list[str] = []
        for entry in parsed.entries:
            for feed in entry["feeds"]:
                if feed["family"] == family and feed["target"] == "alignment":
                    (g_support if feed["direction"] == "supports" else g_against).append(entry["id"])
        name = NAME_BY_FAMILY[family]
        for entry_id in dict.fromkeys(tab_support + tab_against):
            side = "supporting" if entry_id in tab_support else "contrary or qualifying"
            feeds_text = parsed.entry_by_id[entry_id]["feeds_text"]
            if entry_id not in g_support and entry_id not in g_against:
                context.book.warnings.append(
                    f'{ALIGNMENT} lists {entry_id} as {side} for {name}, but its "{REGISTER_HEADERS["feeds"]}" is "{feeds_text}"'
                )
            elif (entry_id in tab_support) != (entry_id in g_support):
                context.book.warnings.append(
                    f'{ALIGNMENT} lists {entry_id} as {side} for {name}, but its "{REGISTER_HEADERS["feeds"]}" is "{feeds_text}"'
                )
        for entry_id in dict.fromkeys(g_support + g_against):
            if entry_id not in tab_support and entry_id not in tab_against:
                feeds_text = parsed.entry_by_id[entry_id]["feeds_text"]
                context.book.warnings.append(
                    f'{REGISTER} {entry_id} feeds {name} Alignment ("{feeds_text}"), but no {ALIGNMENT} row for {name} lists it'
                )


def check_main_harms(context: Context) -> None:
    parsed = context.parsed
    for family in FAMILIES:
        row: TableRow = parsed.welfare[family]["row"]
        listed = ids_in_text(row.text("harms"), "R", 2)
        by_family = [risk["id"] for risk in parsed.risks if family in risk["families"]]
        name = NAME_BY_FAMILY[family]
        for risk_id in by_family:
            if risk_id not in listed:
                context.book.warnings.append(
                    f'{RISKS} {risk_id} names {name} in its Family column, but {row.ref("harms")} for {name} leaves it out. '
                    f"The site shows it on the {name} page (the Family column is the statement)"
                )
        for risk_id in listed:
            if risk_id not in by_family:
                context.book.warnings.append(
                    f'{row.ref("harms")} for {name} lists {risk_id}, whose Family column does not name {name}'
                )


def check_stage_labels(context: Context) -> None:
    parsed = context.parsed
    labels: dict[tuple[str, str], str] = {}
    for row in parsed.codebook:
        if row["type"] == "Stage" and row["family"] in FAMILY_BY_NAME:
            labels[(FAMILY_BY_NAME[row["family"]], row["code"])] = row["definition"]
    for family, stages in parsed.minds.items():
        for stage in stages:
            if stage["stage"] is None:
                continue
            codebook_label = labels.get((family, stage["stage"]))
            own_label = STAGE_LABEL.fullmatch(stage["stage_label"]).group(2)
            if codebook_label is not None and codebook_label != own_label:
                context.book.warnings.append(
                    f'{MINDS} {NAME_BY_FAMILY[family]} "{stage["stage_label"]}" differs from the {CODEBOOK} label for '
                    f'{stage["stage"]}: "{codebook_label}" (the site shows tab 4.1\'s words)'
                )


def check_quality_against_site(context: Context, sources: list[dict]) -> None:
    by_register = {source.get("register_id"): source for source in sources if source.get("register_id")}
    for register_id, quality in context.parsed.quality.items():
        source = by_register.get(register_id)
        status = quality.get("peer_review") or ""
        if source is None or source.get("source_type") != "peer_reviewed":
            continue
        if not status.startswith("Peer-reviewed") or "unconfirmed" in status or "not verified" in status:
            context.book.warnings.append(
                f'{SOURCE_QUALITY} {register_id}: the site types it "peer_reviewed", but its peer-review status is "{status}"'
            )


def check_register_source_type(context: Context) -> None:
    """Column H is a formula over 3a ("Source type; Affiliation / independence")."""
    for entry in context.parsed.entries:
        quality = context.parsed.quality.get(entry["register_id"])
        if quality is None:
            continue
        expected = f"{quality['source_type']}; {quality['affiliation']}"
        if entry["source_type_independence"] != expected:
            context.book.warnings.append(
                f'{REGISTER} {entry["id"]}: "{REGISTER_HEADERS["source_type"]}" is "{entry["source_type_independence"]}", '
                f'but {SOURCE_QUALITY} gives "{expected}"'
            )


def check_entries_coded(context: Context) -> None:
    counts: dict[str, int] = {}
    for entry in context.parsed.entries:
        counts[entry["register_id"]] = counts.get(entry["register_id"], 0) + 1
    for register_id, facts in context.parsed.sources.items():
        row: TableRow = facts["row"]
        text = row.text("entries_coded", use="check")
        if text == "":
            continue
        try:
            stated = int(float(text))
        except ValueError:
            context.book.warnings.append(f'{row.ref("entries_coded")}: "{text}" is not a number')
            continue
        if stated != counts.get(register_id, 0):
            context.book.warnings.append(
                f'{row.ref("entries_coded")}: {register_id} says {stated} entries, the register has {counts.get(register_id, 0)}'
            )


# Added to a warning about sheet text that a GLITCH_FIXES entry already rewrote,
# so the report still points Vilija at her cell without suggesting the site
# shows the old words.
FIXED_ON_SITE = "the site shows the fixed wording"


def published_texts(context: Context) -> list[tuple[str, str, str]]:
    """(cell, sheet text, site text) for every non-empty cell the import publishes.
    The sheet text is the cell as the workbook has it, which the checks report on.
    The site text has the cell's GLITCH_FIXES entry applied, if one matched, so a
    check can tell when the site no longer shows what it found."""
    fixed = {edit.key: edit.after for edit in context.book.glitch_fixes}
    texts: list[tuple[str, str, str]] = []
    order = context.book.order
    for key in sorted(context.book.imported, key=lambda key: (order.index(key[0]), key[1], key[2])):
        sheet_name, row, column = key
        text = tidy_whitespace(context.book.sheet(sheet_name).value(row, column))
        if text:
            texts.append((f"{sheet_name}!{cell_ref(row, column)}", text, fixed.get(key, text)))
    return texts


TAB_WORDS = {
    "Evidence",
    "Register",
    "Scope",
    "Milestones",
    "Theory",
    "Sources",
    "Source",
    "Quality",
    "Alignment",
    "Judgment",
    "Artificial",
    "Minds",
    "Intelligence",
    "Agency",
    "Overall",
    "Risks",
    "Governance",
    "Checklist",
    "Welfare",
    "Reference",
    "Frameworks",
    "Search",
    "IC",
}
TAB_REFERENCE = re.compile(
    r"\b(\d{1,2}(?:\.\d)?a?) ((?:[A-Z][A-Za-z]*|IC)(?:(?: of| and)? (?:[A-Z][A-Za-z]*|IC))*)(?: col ([A-Z])\b)?"
)


def check_sheet_references(context: Context) -> None:
    """Published text that points into the spreadsheet: tab names, column letters, the Synopsis."""
    book = context.book
    for where, text, site_text in published_texts(context):
        covered: list[tuple[int, int]] = []
        for match in TAB_REFERENCE.finditer(text):
            number, words, column = match.groups()
            if words.split(" ")[0] not in TAB_WORDS:
                continue
            reference = f"{number} {words}"
            target = None
            for name in book.order:
                if name.startswith(f"{number} ") and (name.startswith(reference) or reference.startswith(name)):
                    target = name
            covered.append((match.start(), match.end()))
            fixed = "" if match.group(0) in site_text else f" ({FIXED_ON_SITE})"
            if target is None:
                book.warnings.append(f'{where}: refers to a tab "{reference}" that the workbook does not have{fixed}')
            elif column is not None:
                sheet = book.sheet(target)
                width = max((sheet.width(row) for row in range(sheet.row_count)), default=0)
                if column_index(column) >= width:
                    book.warnings.append(
                        f'{where}: refers to "{target}" col {column}, but that tab ends at column '
                        f"{column_letters(width - 1)}{fixed}"
                    )
                else:
                    book.warnings.append(f'{where}: spreadsheet reference in published text: "{match.group(0)}"{fixed}')
            else:
                book.warnings.append(f'{where}: spreadsheet reference in published text: "{reference}"{fixed}')
        for match in re.finditer(r"\b(?:column|col) [A-Z]\b|\bSynopsis\b", text):
            if any(start <= match.start() < end for start, end in covered):
                continue
            fixed = "" if match.group(0) in site_text else f" ({FIXED_ON_SITE})"
            book.warnings.append(f'{where}: spreadsheet reference in published text: "{match.group(0)}"{fixed}')


def check_out_of_date_marks(context: Context) -> None:
    for where, text, _site_text in published_texts(context):
        for match in re.finditer(r"\b(S\d{2})\b[^.]*\bmarked out of date\b", text):
            register_id = match.group(1)
            facts = context.parsed.sources.get(register_id)
            if facts is None:
                continue
            row: TableRow = facts["row"]
            row_text = " ".join(context.book.sheet(SOURCES).row_values(row.row))
            if "out of date" not in row_text.lower():
                context.book.warnings.append(
                    f"{where} says {register_id} is marked out of date, but its {SOURCES} row has no such mark"
                )


AUTHOR_YEAR = re.compile(r"\b([A-Z][a-z]+)(?: (?:&|and) [A-Z][a-z]+)? ((?:18|19|20)\d{2})\b")


def check_author_year_citations(context: Context, sources: list[dict]) -> None:
    """Citations like "Andregg 2023" that match no source in the register."""
    site_by_register = {source.get("register_id"): source for source in sources if source.get("register_id")}
    known: list[tuple[str, int]] = []
    for register_id, facts in context.parsed.sources.items():
        row: TableRow = facts["row"]
        names = row.text("authors", use="check") + " " + " ".join(site_by_register.get(register_id, {}).get("authors", []))
        known.append((names.lower(), year_of(row)))
    for where, text, _site_text in published_texts(context):
        for match in AUTHOR_YEAR.finditer(text):
            surname, year = match.group(1), int(match.group(2))
            if not any(surname.lower() in names and year == source_year for names, source_year in known):
                context.book.warnings.append(f'{where}: cites "{match.group(0)}", which matches no source in {SOURCES}')


SPELLING_PAIRS = [("labour", "labor"), ("behaviour", "behavior"), ("judgement", "judgment"), ("favour", "favor")]


def check_spelling(context: Context) -> None:
    words: dict[str, str] = {}  # each word in the sheet text, and the first cell it is in
    site_words: set[str] = set()  # the words the site shows, after GLITCH_FIXES
    for where, text, site_text in published_texts(context):
        for word in re.findall(r"[A-Za-z]+", text):
            words.setdefault(word.lower(), where)
        site_words.update(word.lower() for word in re.findall(r"[A-Za-z]+", site_text))
    pairs: list[tuple[str, str]] = []
    for word in words:
        british = re.fullmatch(r"(\w+)is(e|es|ed|ing|ation|ations)", word)
        if british and f"{british.group(1)}iz{british.group(2)}" in words:
            pairs.append((word, f"{british.group(1)}iz{british.group(2)}"))
    for british, american in SPELLING_PAIRS:
        for word in words:
            if word.startswith(british) and american + word[len(british) :] in words:
                pairs.append((word, american + word[len(british) :]))
    for british, american in dict.fromkeys(pairs):
        fixed = "" if american in site_words else f"; {FIXED_ON_SITE}"
        context.book.warnings.append(
            f'mixed spelling: "{british}" ({words[british]}) and "{american}" ({words[american]}{fixed})'
        )


def run_checks(context: Context, sources: list[dict]) -> None:
    check_overview_counts(context)
    check_synopsis(context)
    check_undefined_codes(context)
    check_back_references(context)
    check_alignment_against_register(context)
    check_main_harms(context)
    check_stage_labels(context)
    check_register_source_type(context)
    check_entries_coded(context)
    check_quality_against_site(context, sources)
    check_sheet_references(context)
    check_out_of_date_marks(context)
    check_author_year_citations(context, sources)
    check_spelling(context)


# ---------------------------------------------------------------------------
# The report


def short_list(items: list[str], limit: int = 6) -> str:
    if len(items) <= limit:
        return ", ".join(items)
    return ", ".join(items[:limit]) + f", ... ({len(items)} in all)"


def unused_cells(book: Book) -> list[str]:
    """Non-empty cells the import neither published nor read for a check, grouped by column."""
    lines: list[str] = []
    for sheet_name in book.order:
        sheet = book.sheets[sheet_name]
        if sheet_name == VALIDATION_LISTS:
            lines.append(f"{sheet_name}: hidden tab, not imported ({len(sheet.cells)} cells with text)")
            continue
        groups: dict[str, list[str]] = {}
        for row, column in sorted(sheet.cells):
            key = (sheet_name, row, column)
            if key in book.imported or key in book.checked:
                continue
            label = f"row {row + 1}"
            for table in book.tables.get(sheet_name, []):
                if row > table.header_row:
                    for field_key, table_column in table.columns.items():
                        if table_column == column:
                            label = f'column "{table.headers[field_key]}"'
            groups.setdefault(label, []).append(cell_ref(row, column))
        for label, refs in groups.items():
            lines.append(f"{sheet_name}, {label}: {short_list(refs)}")
    return lines


def checked_only_cells(book: Book) -> list[str]:
    lines: list[str] = []
    for sheet_name in book.order:
        refs = [
            cell_ref(row, column)
            for (name, row, column) in sorted(book.checked, key=lambda key: (key[1], key[2]))
            if name == sheet_name and (name, row, column) not in book.imported and book.sheets[name].value(row, column)
        ]
        if refs:
            lines.append(f"{sheet_name}: {short_list(refs, 10)}")
    return lines


def format_edit(edit: Edit) -> str:
    return f"{edit.where}: {edit.before!r} -> {edit.after!r}"


def build_report(
    book: Book, context: Context, version: str, version_origin: str, sha256: str, file_lines: list[str]
) -> list[str]:
    lines = [f"Workbook version {version} (from {version_origin}), sha256 {sha256}"]
    parsed = context.parsed
    lines.append(
        f"Read: {len(parsed.entries)} entries, {len(parsed.links)} links, {len(parsed.risks)} risks, "
        f"{len(parsed.governance)} checklist items, {len(parsed.assessments)} milestone rows, "
        f"{len(parsed.codebook)} codebook rows, {len(parsed.frameworks)} frameworks, {len(parsed.sources)} sources"
    )

    def section(title: str, items: list[str]) -> None:
        lines.append("")
        lines.append(f"{title} ({len(items)}):")
        for item in items:
            lines.append(f"  {item}")
        if not items:
            lines.append("  none")

    def in_sheet_order(edits: list[Edit]) -> list[Edit]:
        return sorted(edits, key=lambda edit: (book.order.index(edit.key[0]), edit.key[1], edit.key[2]))

    section("Glitch fixes applied", [format_edit(edit) for edit in in_sheet_order(book.glitch_fixes)])
    no_longer = []
    for glitch_key, (before, _) in book.glitch_table.items():
        if glitch_key in book.glitch_applied:
            continue
        sheet_name, row_id, header = glitch_key
        if glitch_key in book.glitch_found:
            no_longer.append(f'{sheet_name} {row_id} "{header}": now reads {book.glitch_found[glitch_key]!r}, not {before!r}')
        else:
            no_longer.append(f'{sheet_name} {row_id} "{header}": cell not found')
    section("Glitch fixes no longer needed (remove them from GLITCH_FIXES)", no_longer)
    # Only published cells: tidying a cell that was only compared changes nothing on the site.
    published = [edit for edit in book.whitespace_fixes if edit.key in book.imported]
    section("Whitespace tidied", [format_edit(edit) for edit in in_sheet_order(published)])
    section("Codes normalised", [format_edit(edit) for edit in in_sheet_order(book.code_fixes)])
    section("Other edits", book.other_edits)
    section("Left out of evidence_entries", book.exclusions)
    section("Consistency warnings for the workbook's author", book.warnings)
    section("Notes", book.notes)
    section("Cells read for checks or as labels only (not published)", checked_only_cells(book))
    section("Cells with text the import did not use", unused_cells(book))
    lines.append("")
    lines.extend(file_lines)
    return lines


# ---------------------------------------------------------------------------
# Running it


def resolve_version(workbook_path: Path, flag: str | None, notes: list[str]) -> tuple[str, str]:
    from_name = VERSION_IN_NAME.search(workbook_path.name)
    if flag is not None:
        if not VERSION_FLAG.fullmatch(flag):
            raise WorkbookError(f'--version "{flag}" should look like 0.4')
        if from_name is not None and from_name.group(1) != flag:
            notes.append(f"--version {flag} differs from the file name's v{from_name.group(1)}; using {flag}")
        return flag, "--version"
    if from_name is not None:
        return from_name.group(1), "the file name"
    raise WorkbookError(
        "no workbook version: pass --version (for example --version 0.4). No cell in the workbook states it, "
        "and the file name has no v0.4-style version"
    )


def parse_workbook(book: Book) -> Context:
    context = Context(book)
    parse_overview(context)
    parse_codebook(context)
    parse_sources(context)
    parse_quality(context)
    parse_milestones(context)
    parse_register(context)
    parse_theory(context)
    parse_risks(context)
    parse_governance(context)
    parse_scope(context)
    parse_alignment(context)
    parse_minds(context)
    parse_curse(context)
    parse_agency(context)
    parse_welfare(context)
    parse_frameworks(context)
    # The milestone evidence cells must cite real entries too.
    for assessment, row_id in zip(context.parsed.assessments, context.parsed.assessment_rows):
        context.known_entries(assessment["evidence_entries"], f"{MILESTONES} {row_id}")
    return context


def read_text(path: Path) -> str | None:
    return path.read_text(encoding="utf-8") if path.exists() else None


def default_validator(content_dir: Path) -> tuple[bool, list[str]]:
    # Imported here so a half-finished validate.py doesn't stop the import from loading.
    from sf_shared.validate import validate_content

    report = validate_content(content_dir)
    return report.ok, report.errors + report.warnings


def run_import(
    workbook_path: Path,
    content_dir: Path,
    version_flag: str | None,
    dry_run: bool = False,
    refresh_source_text: bool = False,
    skip_validate: bool = False,
    validator: Callable[[Path], tuple[bool, list[str]]] | None = None,
    out: Callable[[str], None] = print,
) -> int:
    """The whole import. Returns the exit status: 0 when it worked, 1 when it stopped."""
    try:
        notes: list[str] = []
        version, version_origin = resolve_version(workbook_path, version_flag, notes)
        sha256 = hashlib.sha256(workbook_path.read_bytes()).hexdigest() if workbook_path.exists() else ""
        book = Book(read_workbook(workbook_path))
        book.notes.extend(notes)
        context = parse_workbook(book)

        names = ["scorecard.json", "technologies.json", "sources.json", "milestones.json"]
        old_texts = {name: read_text(content_dir / name) for name in names}
        for name in ["technologies.json", "sources.json", "milestones.json"]:
            if old_texts[name] is None:
                raise WorkbookError(f"{content_dir / name} not found")
        old_pages = json.loads(old_texts["technologies.json"])
        old_sources = json.loads(old_texts["sources.json"])
        old_milestones = json.loads(old_texts["milestones.json"])

        new_pages = update_pages(old_pages, context)
        new_sources, added_sources = update_sources(old_sources, context, refresh_source_text)
        new_milestones, updated_milestones = update_milestones(old_milestones, context)
        scorecard = build_scorecard(context, version, sha256)
        run_checks(context, new_sources)

        register_slugs = [s["id"] for s in new_sources if s.get("register_id") in context.parsed.sources and not s.get("sample")]
        check_allowed("technologies.json", old_pages, new_pages, PAGE_ALLOWED)
        source_allowed = source_patterns(register_slugs, added_sources, refresh_source_text)
        check_allowed("sources.json", old_sources, new_sources, source_allowed)
        check_allowed("milestones.json", old_milestones, new_milestones, milestone_patterns(updated_milestones))

        new_texts = {
            "scorecard.json": canonical_json(scorecard),
            "technologies.json": canonical_json(new_pages),
            "sources.json": canonical_json(new_sources),
            "milestones.json": canonical_json(new_milestones),
        }
        changed = [name for name in names if new_texts[name] != old_texts[name]]
        file_lines = []
        for name in names:
            if name not in changed:
                file_lines.append(f"{name}: unchanged")
            elif old_texts[name] is None:
                file_lines.append(f"{name}: new")
            else:
                file_lines.append(f"{name}: updated")
    except (WorkbookError, XlsxError) as error:
        out(f"FAILED: {error}")
        return 1

    for line in build_report(book, context, version, version_origin, sha256, file_lines):
        out(line)

    if dry_run:
        for name in changed:
            diff = difflib.unified_diff(
                (old_texts[name] or "").splitlines(keepends=True),
                new_texts[name].splitlines(keepends=True),
                fromfile=f"a/{name}",
                tofile=f"b/{name}",
            )
            out("".join(diff).rstrip("\n"))

    if not changed:
        out("Nothing to write: content/ already matches the workbook.")
        return 0

    if skip_validate:
        out("Validation skipped (--skip-validate). Only use this while the schema is being changed.")
    else:
        check = validator if validator is not None else default_validator
        with tempfile.TemporaryDirectory() as temp:
            trial = Path(temp) / "content"
            shutil.copytree(content_dir, trial)
            for name in changed:
                (trial / name).write_text(new_texts[name], encoding="utf-8")
            ok, messages = check(trial)
        if not ok:
            out("")
            out("FAILED: the new content doesn't validate, so nothing was written:")
            for message in messages:
                out(f"  {message}")
            return 1
        out("The new content validates.")

    if dry_run:
        out("Dry run: nothing written.")
        return 0

    # Sources and milestones first: the other two files cite them, so the site
    # never reads an entry whose source isn't written yet.
    write_order = ["sources.json", "milestones.json", "scorecard.json", "technologies.json"]
    for name in sorted(changed, key=write_order.index):
        target = content_dir / name
        temporary = content_dir / f".{name}.import-tmp"
        temporary.write_text(new_texts[name], encoding="utf-8")
        # One step per file, so the site never reads a half-written file.
        os.replace(temporary, target)
    out(f"Wrote {', '.join(changed)} in {content_dir}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("workbook", type=Path, help="the .xlsx file (never commit it)")
    parser.add_argument("--version", dest="version", help='the workbook version, e.g. "0.4" (default: from the file name)')
    parser.add_argument("--content", type=Path, default=REPO_CONTENT, help="the content folder (default: the repo's content/)")
    parser.add_argument("--dry-run", action="store_true", help="print the report and a diff, write nothing")
    parser.add_argument(
        "--refresh-source-text",
        action="store_true",
        help="also replace register sources' titles, authors and summaries with the sheet's text",
    )
    parser.add_argument("--skip-validate", action="store_true", help="development only: write without validating")
    args = parser.parse_args(argv)
    return run_import(
        args.workbook,
        args.content,
        args.version,
        dry_run=args.dry_run,
        refresh_source_text=args.refresh_source_text,
        skip_validate=args.skip_validate,
    )


if __name__ == "__main__":
    sys.exit(main())
