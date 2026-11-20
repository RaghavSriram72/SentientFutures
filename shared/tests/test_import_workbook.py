"""The workbook import (import_workbook.py) and its xlsx reader (xlsx.py).

Every test builds a small synthetic workbook here with zipfile. The real
workbook is never read: it is gitignored and must never be committed.

The synthetic workbook has every tab the import reads, a few rows each, and
the awkward cases the real one has or could have: a rich-text run with a
phonetic hint, an inline string, a year stored as 2023.0, a hyperlink kept
only in the sheet's rels, a merged heading row, rows with empty trailing
cells, the U+2192 arrow at the end of a scope cell, a mangled "'- " dash, a
source range "S20-S22", a stage code S1 in prose and "E004 not admissible".
"""

import copy
import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import escape

import pytest

from sf_shared import import_workbook as iw
from sf_shared.import_notion import row_to_source
from sf_shared.xlsx import XlsxError, column_letters, read_workbook

# Written as code points, so this file never contains the characters it checks for.
EN_DASH = chr(0x2013)
EM_DASH = chr(0x2014)
COMBINING_ACUTE = chr(0x0301)

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

# ---------------------------------------------------------------------------
# Writing a minimal .xlsx


@dataclass
class Inline:
    text: str


@dataclass
class Num:
    text: str


@dataclass
class Rich:
    parts: list[str]
    phonetic: str = ""


@dataclass
class Formula:
    formula: str
    cached: str | None


@dataclass
class Error:
    code: str


@dataclass
class Bool:
    value: bool


@dataclass
class SheetSpec:
    name: str
    rows: list[list]
    links: dict[str, str] = field(default_factory=dict)
    merged: list[str] = field(default_factory=list)
    hidden: bool = False


def text_element(text: str) -> str:
    return f'<t xml:space="preserve">{escape(text)}</t>'


def build_xlsx(path: Path, sheets: list[SheetSpec], raw_sheets: dict[str, str] | None = None) -> Path:
    """Write the sheets as an .xlsx. raw_sheets replaces a sheet's XML by name, for odd cases."""
    shared: list[str] = []
    shared_index: dict[str, int] = {}

    def shared_string(item: str) -> int:
        if item not in shared_index:
            shared_index[item] = len(shared)
            shared.append(item)
        return shared_index[item]

    sheet_parts: list[tuple[str, str, str | None]] = []
    for number, spec in enumerate(sheets, start=1):
        rows_xml = []
        for row_number, row in enumerate(spec.rows, start=1):
            cells = []
            for column, value in enumerate(row):
                ref = f"{column_letters(column)}{row_number}"
                if value is None or value == "":
                    continue
                if isinstance(value, str):
                    index = shared_string(f"<si>{text_element(value)}</si>")
                    cells.append(f'<c r="{ref}" t="s"><v>{index}</v></c>')
                elif isinstance(value, Inline):
                    cells.append(f'<c r="{ref}" t="inlineStr"><is>{text_element(value.text)}</is></c>')
                elif isinstance(value, Num):
                    cells.append(f'<c r="{ref}"><v>{value.text}</v></c>')
                elif isinstance(value, Rich):
                    runs = "".join(f"<r><rPr><b/></rPr>{text_element(part)}</r>" for part in value.parts)
                    phonetic = f'<rPh sb="0" eb="1">{text_element(value.phonetic)}</rPh>' if value.phonetic else ""
                    index = shared_string(f"<si>{runs}{phonetic}</si>")
                    cells.append(f'<c r="{ref}" t="s"><v>{index}</v></c>')
                elif isinstance(value, Formula):
                    cached = f"<v>{escape(value.cached)}</v>" if value.cached is not None else ""
                    cells.append(f'<c r="{ref}" t="str"><f>{escape(value.formula)}</f>{cached}</c>')
                elif isinstance(value, Error):
                    cells.append(f'<c r="{ref}" t="e"><v>{value.code}</v></c>')
                elif isinstance(value, Bool):
                    cells.append(f'<c r="{ref}" t="b"><v>{1 if value.value else 0}</v></c>')
                else:
                    raise TypeError(value)
            rows_xml.append(f'<row r="{row_number}">{"".join(cells)}</row>')
        merged = ""
        if spec.merged:
            merged = f'<mergeCells count="{len(spec.merged)}">' + "".join(f'<mergeCell ref="{ref}"/>' for ref in spec.merged) + "</mergeCells>"
        hyperlinks = ""
        rels = None
        if spec.links:
            hyperlinks = "<hyperlinks>" + "".join(
                f'<hyperlink ref="{ref}" r:id="rId{index}"/>' for index, ref in enumerate(spec.links, start=1)
            ) + "</hyperlinks>"
            rels = f'<Relationships xmlns="{PACKAGE_NS}">' + "".join(
                f'<Relationship Id="rId{index}" Type="{REL_NS}/hyperlink" Target="{escape(url)}" TargetMode="External"/>'
                for index, url in enumerate(spec.links.values(), start=1)
            ) + "</Relationships>"
        xml = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="{MAIN_NS}" xmlns:r="{REL_NS}">'
            f'<sheetData>{"".join(rows_xml)}</sheetData>{merged}{hyperlinks}</worksheet>'
        )
        if raw_sheets and spec.name in raw_sheets:
            xml = raw_sheets[spec.name]
        sheet_parts.append((f"worksheets/sheet{number}.xml", xml, rels))

    sheets_xml = "".join(
        f'<sheet name="{escape(spec.name)}" sheetId="{number}" r:id="rId{number}"'
        + (' state="hidden"' if spec.hidden else "")
        + "/>"
        for number, spec in enumerate(sheets, start=1)
    )
    workbook = f'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{MAIN_NS}" xmlns:r="{REL_NS}"><sheets>{sheets_xml}</sheets></workbook>'
    workbook_rels = f'<Relationships xmlns="{PACKAGE_NS}">' + "".join(
        f'<Relationship Id="rId{number}" Type="{REL_NS}/worksheet" Target="worksheets/sheet{number}.xml"/>'
        for number in range(1, len(sheets) + 1)
    )
    workbook_rels += f'<Relationship Id="rIdStrings" Type="{REL_NS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>'
    strings = f'<sst xmlns="{MAIN_NS}" count="{len(shared)}" uniqueCount="{len(shared)}">{"".join(shared)}</sst>'

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/sharedStrings.xml", strings)
        for part, xml, rels in sheet_parts:
            archive.writestr(f"xl/{part}", xml)
            if rels is not None:
                archive.writestr(f"xl/worksheets/_rels/{part.split('/')[1]}.rels", rels)
    return path


# ---------------------------------------------------------------------------
# The synthetic workbook


S17_SUMMARY = iw.SUMMARY_TRIMS["S17"][0]
S17_PUBLISHED = iw.SUMMARY_TRIMS["S17"][1]


def table(headers: dict[str, str], rows: list[dict]) -> list[list]:
    """A header row and data rows, with each data row given by header key."""
    keys = list(headers)
    result: list[list] = [list(headers.values())]
    for row in rows:
        unknown = set(row) - set(keys)
        assert not unknown, unknown
        values = [row.get(key, "") for key in keys]
        while values and values[-1] == "":
            values.pop()  # an empty trailing cell, as Sheets saves it
        result.append(values)
    return result


def source_row(register_id: str, **changes) -> dict:
    row = {
        "id": register_id,
        "added_by": "Aila",
        "category": "AI Alignment",
        "claim": "AI Alignment",
        "title": f"Title of {register_id}",
        "resource_type": "Research report",
        "date": Num("2023.0"),
        "authors": "Ada Lovelace",
        "summary": f"Sheet summary of {register_id}.",
        "mechanism": "Whole Brain Emulation",
        "link": f"https://example.org/{register_id.lower()}",
        "claim_1": "AI Alignment",
        "families": "WBE",
        "scenarios": "WBE-C",
        "entries_coded": Num("0"),
    }
    row.update(changes)
    return row


def quality_row(register_id: str, **changes) -> dict:
    row = {
        "id": register_id,
        "title": f"Title of {register_id}",
        "source_type": "Report",
        "empirical_theoretical": "Theoretical",
        "original_secondary": "Original evidence",
        "peer_review": "Not peer-reviewed",
        "affiliation": "Independent",
    }
    row.update(changes)
    return row


def entry_row(entry_id: str, source: str, **changes) -> dict:
    row = {
        "id": entry_id,
        "source": source,
        "locator": "Summary page",
        "claim": f"Claim of {entry_id}.",
        "codes": "WBE-O-L1",
        "family": "WBE",
        "feeds": "Not used in a headline rating",
        "source_type": "Report; Independent",
        "outcome": "AI Alignment",
        "alignment_problem": "A-VS",
        "scenario_1": "WBE-O",
        "stage": "S1",
        "directness": "Direct (family itself)",
        "role": "Supports",
        "basis": "Argued",
    }
    row.update(changes)
    return row


def workbook_sheets() -> dict[str, SheetSpec]:
    """The default synthetic workbook, by tab name. Tests change cells before building it."""
    sources = [
        source_row("S01", resource_type="Foresight Workshop Presentation", entries_coded=Num("2")),
        source_row(
            "S08",
            link="https://example.org/s08\nhttps://example.org/s08-second",
            resource_type="Existential Hope Podcast",
            entries_coded=Num("1"),
        ),
        source_row("S13", entries_coded=Num("2")),
        source_row("S16", resource_type="Research report announcement"),
        source_row(
            "S17",
            category="AI Alignment",
            claim="AI Misalignment",
            title="Can we accurately bridge neurobiology to brain-inspired AGI to effectively emulate the human brain?",
            resource_type="Journal article; screening pending",
            authors="Diana Deca; Caswell Barry; Samit Chakrabarty",
            summary=S17_SUMMARY,
            mechanism="Whole Brain Emulation / Neuromorphic AI",
            entries_coded=Num("1"),
        ),
        source_row("S20"),
        source_row("S21"),
        source_row("S22", entries_coded=Num("1")),
    ]
    quality = [
        quality_row("S01", source_type="Presentation", affiliation="Unknown"),
        quality_row("S08", source_type="Podcast", affiliation="Affiliated (co-founder, Zander Labs '- commercial pBCI)"),
        quality_row("S13", source_type="Preprint", peer_review="Not peer-reviewed"),
        quality_row("S16", affiliation="Affiliated (Foresight Institute '- funds and promotes WBE)"),
        quality_row("S17", source_type="Peer-reviewed article", peer_review="Peer-reviewed"),
        quality_row("S20"),
        quality_row("S21"),
        quality_row("S22", source_type="Book / chapter", peer_review="Peer-reviewed (edited volume)"),
    ]
    # 3a's "Title (lookup)" repeats tab 3's title.
    quality[4]["title"] = sources[4]["title"]

    entries = [
        entry_row(
            "E001",
            "S01",
            locator="Summary  page ",
            claim=Rich(["A generative model ", "could act as a proxy."], phonetic="ignored"),
            codes="BCI-D-L1",
            family="BCI",
            feeds="BCI Alignment (supports)",
            source_type="Presentation; Unknown",
            scenario_1="BCI-D",
        ),
        entry_row(
            "E004",
            "S01",
            claim="Cost of testing BCI approaches is 'relatively low'.",
            codes="BCI-M6",
            family="BCI",
            feeds="BCI M6 Economic viability (against or qualifies)",
            source_type="Presentation; Unknown",
            scenario_1="BCI-D",
            role="Qualifies",
            basis="Assumed",
        ),
        entry_row(
            "E027",
            "S08",
            codes="BCI-D-L1",
            family="BCI",
            feeds="BCI Alignment (supports); BCI Intelligence Curse (supports)",
            source_type="Podcast; Affiliated (co-founder, Zander Labs '- commercial pBCI)",
            scenario_1="BCI-D",
        ),
        entry_row(
            "E037",
            "S13",
            codes="WBE-M1; WBE-O-L1",
            feeds="WBE M1 Technical capability (against or qualifies)",
            source_type="Preprint; Independent",
            scenario_1="WBE-C",
            stage="S3",
            role="Contrary",
        ),
        entry_row(
            "E042",
            "S13",
            codes="NM-A-L1; AM",
            family="Cross-family",
            feeds="Neuromorphic AI Alignment (supports)",
            source_type="Preprint; Independent",
            outcome="Both",
            alignment_problem="A-X",
            scenario_1="NM-A",
            scenario_2="NM-C",
            directness="Related NeuroAI system",
            basis="Projected",
        ),
        entry_row(
            "E077",
            "S17",
            codes="WBE-M1",
            family="Cross-family",
            source_type="Peer-reviewed article; Independent",
            alignment_problem="N/A",
            scenario_1="WBE-C",
            stage="N/A",
            directness="Conceptually relevant only",
            role="Qualifies",
        ),
        entry_row(
            "E096",
            "S22",
            codes="G01; R01; AM",
            source_type="Book / chapter; Independent",
            scenario_1="WBE-C",
            stage="S6",
        ),
    ]

    scope = [
        ["§1 Scope (descriptive, unrated)"],
        ["Key question: How strong is the case that [technology family] could improve AI alignment?"],
        ["Time horizon bands are provisional: Near ≤ 5 y (to 2031) · Medium 5-15 y (2031-2041) · Long > 15 y (after 2041)"],
    ] + table(
        iw.SCOPE_HEADERS,
        [
            {
                "family": "WBE",
                "intervention": "Whole brain emulation (stages S1 component simulation → S6 deployed populations). Digital twins (S1-S2) are not WBE.",
                "deployment_scenario": "WBE-O AI overseer",
                "affected_groups": "Emulated persons; biological workers.",
                "time_horizon": "Long (> 15 y). No source dates S3; S13: whole-brain simulation 'many years out'.",
                "comparator": "Alignment: conventional methods (S16). IC: labour-replacing AI without WBE (D05).",
                "problems_claimed": "Alignment: scalable oversight (WBE-O). Intelligence Curse: displacement argued (S20-S22). → Both",
                "source_ids": "S13, S16, S20-S22",
            },
            {
                "family": "BCI",
                "intervention": "Brain-computer interfaces (S01).",
                "deployment_scenario": "BCI-D neural data for alignment",
                "affected_groups": "Users; workers.",
                "time_horizon": "Near for BCI-T (S08).",
                "comparator": "Alignment: RLHF (S13).",
                "problems_claimed": "Alignment: value specification (BCI-D). IC: disempowerment pathways (BCI-W/S/P). → Both",
                "source_ids": "S01, S08",
            },
            {
                "family": "Neuromorphic AI",
                "intervention": "Brain-inspired computing. Family boundary open (D03).",
                "deployment_scenario": "NM-A brain-inspired AGI architecture",
                "affected_groups": "Users of edge AI.",
                "time_horizon": "Long for NM-A (S13).",
                "comparator": "Alignment: standard robustness methods (S13).",
                "problems_claimed": "Alignment: value specification via motivational architecture (NM-A). IC: no source claims a benefit. → Alignment",
                "source_ids": "S13, S17",
            },
            {
                "family": "Cross-family",
                "intervention": "Sources spanning families are coded per claim and never set a family rating alone.",
                "deployment_scenario": "*-C / *-U codes",
                "affected_groups": "-",
                "time_horizon": "-",
                "comparator": "-",
                "problems_claimed": "-",
                "source_ids": "S13, S16",
            },
        ],
    )

    milestone_rows = [list(iw.MILESTONE_HEADERS.values())]
    milestone_rows.append(["M1 Technical capability", "Can the relevant components be built and operated? Counts as evidence: progress on a named prerequisite. Does not count: optimism."])
    milestone_rows += table(
        iw.MILESTONE_HEADERS,
        [
            {
                "family": "WBE",
                "milestone": "M1",
                "applies_to": "All WBE uses",
                "success_criterion": "Five prerequisites (P1 to P5) at the scale the use needs.",
                "status": "Not demonstrated",
                "criterion_met": "No",
                "evidence": "E037 (components demonstrated; whole brain argued)",
                "bottleneck": "P2 turning a connectome into a runnable model",
                "timing": "No date in any source (S13 'many years out')",
                "confidence": "Medium",
                "note": "Best result: 1 mm³ of human cortex (S16).",
            },
            {
                "family": "BCI",
                "milestone": "M1",
                "applies_to": "Neural feedback for alignment",
                "success_criterion": "Three prerequisites, with at least 10 participants.",
                "status": "Replicated",
                "criterion_met": "Partly",
                "evidence": "E001, E027 (demonstrated)",
                "bottleneck": "Recording evaluative signals in realistic settings",
                "timing": "Met now at laboratory scale (S13)",
                "confidence": "Medium",
            },
            {
                "family": "BCI",
                "milestone": "M1",
                "applies_to": "Oversight and enhancement",
                "success_criterion": "As above, shown in healthy users.",
                "status": "Not demonstrated",
                "criterion_met": "No",
                "evidence": "None (argued only)",
                "bottleneck": "No demonstration in healthy users",
                "timing": "Not sourced",
                "confidence": "Low",
                "note": "S01 likely relevant but not accessible.",
            },
            {
                "family": "Neuromorphic AI",
                "milestone": "M1",
                "applies_to": "Hardware",
                "success_criterion": "Chip built and benchmarked, replicated by at least 2 groups.",
                "status": "Replicated",
                "criterion_met": "Yes",
                "evidence": "E042 (demonstrated; secondary source)",
                "bottleneck": "Controlling plasticity (S13)",
                "timing": "Met now: chips exist (S13)",
                "confidence": "Medium",
            },
        ],
    )[1:]
    milestone_rows.append(["M6 Economic viability", "Are costs practical at the scale needed? Counts as evidence: cost data. Does not count: unquantified 'low cost'."])
    milestone_rows += table(
        iw.MILESTONE_HEADERS,
        [
            {
                "family": "WBE",
                "milestone": "M6",
                "applies_to": "All WBE uses",
                "success_criterion": "A cost model covers scanning, compute and storage.",
                "status": "Unclear",
                "criterion_met": "Unclear (conflicting evidence)",
                "evidence": "None",
                "timing": "Not sourced",
                "confidence": "Low",
                "note": "Candidate source on running costs: Andregg 2023.",
            },
            {
                "family": "BCI",
                "milestone": "M6",
                "applies_to": "Neural feedback; oversight",
                "success_criterion": "Cost per label no higher than explicit feedback.",
                "status": "Unclear",
                "criterion_met": "Unclear (indirect evidence only)",
                "evidence": "E001 (projected); E004 not admissible",
                "bottleneck": "Only a pathway-level estimate (S16)",
                "timing": "Not sourced",
                "confidence": "Low",
                "note": "Low cost' statements (S01, S08) do not count as evidence.",
            },
        ],
    )[1:]

    theory = table(
        iw.THEORY_HEADERS,
        [
            {
                "id": "WBE-O-L1",
                "scenario": "WBE as AI overseer",
                "step": "1 Capability",
                "outcome": "AI Alignment",
                "claim": "Prerequisite: a single whole human emulation can be built and run.",
                "status": "Contrary evidence found",
                "contrary": "E037",
                "best_directness": "Direct (family itself)",
                "assumption": "Scanning prerequisites met (see 1a Milestones).",
            },
            {
                "id": "BCI-D-L1",
                "scenario": "BCI neural feedback for alignment",
                "step": "Condition (timing, spillover, security)",
                "outcome": "AI Alignment",
                "claim": "Neural signals carry evaluative information.",
                "status": "Supporting evidence found",
                "supporting": "E001, E027",
                "best_directness": "Direct (family itself)",
                "assumption": "Signals generalise.",
                "objection": "Cost claims are assumed (E004). Not answered.",
            },
            {
                "id": "NM-A-L1",
                "scenario": "Brain-inspired AGI architecture",
                "step": "1 Capability",
                "outcome": "Both",
                "claim": "A motivational architecture can be specified.",
                "status": "Search incomplete",
            },
        ],
    )

    alignment = table(
        iw.ALIGNMENT_HEADERS,
        [
            {
                "family": "WBE",
                "scenario": "Family judgment",
                "problem": "Oversight; value specification",
                "mechanism": "Relocates the problem (S13, S16).",
                "reason": "Value inheritance is argued by S16, but S13 judges the arguments flawed.",
                "rating": "Weak",
                "confidence": "Low",
                "decisive_question": "Can an emulation keep specified values?",
            },
            {
                "family": "WBE",
                "scenario": "WBE as AI overseer",
                "problem": "Oversight",
                "mechanism": "Human-derived overseer supervises AI",
                "contrary": "E037",
                "reason": "No entry addresses supervising a more capable system (WBE-O-L4).",
            },
            {
                "family": "BCI",
                "scenario": "Family judgment",
                "problem": "Value specification",
                "mechanism": "Adds a feedback channel (S13).",
                "reason": "Prerequisites shown at laboratory scale (S01, S08).",
                "rating": "Unclear",
                "confidence": "Low",
                "decisive_question": "Does neural feedback add information beyond explicit feedback?",
            },
            {
                "family": "BCI",
                "scenario": "BCI neural feedback for alignment",
                "problem": "Value specification",
                "mechanism": "Neural evaluative signals as feedback",
                "supporting": "E001, E027",
                "reason": "Decoding shown.",
            },
            {
                "family": "Neuromorphic AI",
                "scenario": "Family judgment",
                "problem": "Value specification",
                "mechanism": "Replaces objective specification with motivational design (S13).",
                "reason": "Hardware sources concern governance (S20-S22).",
                "rating": "Unclear",
                "confidence": "Low",
                "decisive_question": "Can motivational mechanisms stay stable under learning?",
            },
            {
                "family": "Neuromorphic AI",
                "scenario": "Brain-inspired AGI architecture",
                "problem": "Value specification",
                "mechanism": "Human-like motivational architecture",
                "supporting": "E042",
                "reason": "All support argued (S13).",
            },
        ],
    )

    minds = table(
        iw.MINDS_HEADERS,
        [
            {
                "family": "WBE",
                "stage": "3 Whole brain emulation (one instance)",
                "consciousness": "Agnostic (S22).",
                "moral_status": "Psychological capacities (S22)",
                "identity": "A distinct entity from the original person (S22)",
                "protections": "Non-discrimination (S22)",
                "sources": "S16, S22",
                "entries": "E096",
            },
            {"family": "BCI", "stage": "All stages"},
            {"family": "Neuromorphic AI", "stage": "1 Hardware only"},
        ],
    )

    curse_rows = []
    for family, rating, reason in [
        ("WBE", "Weak", "Three book-length arguments (S20, S21, S22) predict displacement."),
        ("BCI", "Unclear", "The only agency-strengthening evidence is therapeutic (S01)."),
        ("Neuromorphic AI", "Not claimed", "No source claims a benefit. 'Not claimed' is distinct from Weak or Unclear."),
    ]:
        curse_rows.append(
            {
                "family": family,
                "mechanism": f"Mechanism claimed for {family}.",
                "who_gains": "Owners of compute gain (S20).",
                "who_owns": "Not specified.",
                "replacement": "Deepens replacement (S21).",
                "benefit": "Not shown.",
                "rating": rating,
                "confidence": "Low",
                "reason": reason,
            }
        )
    curse = table(iw.CURSE_HEADERS, curse_rows)

    agency = table(
        iw.AGENCY_HEADERS,
        [
            {
                "family": "WBE",
                "group": "Biological humans: bargaining power",
                "effect": "Weakens",
                "mechanism": "Emulation labour undercuts wages (S20).",
                "entries": "E096",
            },
            {"family": "WBE", "group": "Ownership gate", "ownership_questions": "0 answered, 2 partly answered."},
            {
                "family": "BCI",
                "group": "Control of devices",
                "effect": "Not addressed",
                "ownership_questions": "Who controls firmware? No.",
            },
            {"family": "BCI", "group": "Ownership gate", "ownership_questions": "0 answered, 1 partly answered."},
            {"family": "Neuromorphic AI", "group": "Political and institutional influence", "effect": "Not addressed"},
            {"family": "Neuromorphic AI", "group": "Ownership gate", "ownership_questions": "None answered."},
        ],
    )

    risks = table(
        iw.RISK_HEADERS,
        [
            {
                "id": "R01",
                "risk": "Suffering across copied emulations",
                "family": "WBE",
                "domain": "Artificial-mind welfare",
                "category": "Suffering",
                "exposed": "Emulated persons (large)",
                "severity": "Very high",
                "likelihood": "Not assessable",
                "reversibility": "Low",
                "detectability": "Low",
                "remedies": "Avoid creating minds with lives not worth living (S22)",
                "control": "Owner or operator of compute",
                "confidence": "Low",
                "entries": "E096",
            },
            {
                "id": "R02",
                "risk": "Research speeds up capabilities more than safety",
                "family": "WBE; Neuromorphic AI; BCI",
                "domain": "Governance",
                "category": "Misuse and dual use",
                "exposed": "Everyone",
                "severity": "High",
                "likelihood": "Low",
                "reversibility": "Medium",
                "detectability": "Unclear",
                "remedies": "None identified",
                "control": "Research funders",
                "confidence": "Medium",
            },
        ],
    )

    governance = table(
        iw.GOVERNANCE_HEADERS,
        [
            {
                "id": "G01",
                "family": "WBE",
                "question": "Ownership of brain scans",
                "status": "Proposal found",
                "entries": "E096",
                "summary": "S22: limits on copying.",
            },
            {"id": "G02", "family": "BCI", "question": "Mental privacy", "status": "Not addressed in database"},
        ],
    )

    welfare_rows = []
    for family, harms, human, mind, rationale in [
        ("WBE", "Suffering; capability spillover (R01-R02)", ("High", "Not assessable", "Low"), ("Very high", "Not assessable", "Low"), "Severity follows from copy numbers (S22)."),
        ("BCI", "Capability spillover (R02)", ("Very high", "Not assessable", "Low"), ("Not applicable", "Not applicable", "Medium"), "Two sources (S01; S08) identify the mechanism."),
        ("Neuromorphic AI", "Capability spillover (R02)", ("Medium", "Not assessable", "Low"), ("Unclear", "Not assessable", "Low"), "Argued by preprints (S13)."),
    ]:
        welfare_rows.append(
            {
                "family": family,
                "exposed": f"People exposed to {family}.",
                "harms": harms,
                "human_welfare_severity": human[0],
                "human_welfare_likelihood": human[1],
                "human_welfare_confidence": human[2],
                "artificial_mind_welfare_severity": mind[0],
                "artificial_mind_welfare_likelihood": mind[1],
                "artificial_mind_welfare_confidence": mind[2],
                "governance_severity": "High",
                "governance_likelihood": "Not assessable",
                "governance_confidence": "Low",
                "safeguards": "Unclear",
                "safeguards_confidence": "Low",
                "rationale": rationale,
            }
        )
    welfare = table(iw.WELFARE_HEADERS, welfare_rows)

    synopsis = [
        ["", "WBE", "BCI", "Neuromorphic AI"],
        ["Alignment case", Formula("INDEX(...)", "Weak (low confidence)"), "Unclear (low confidence)", "Unclear (low confidence)"],
        ["Intelligence Curse case (biological humans)", "Weak (low confidence)", "Unclear (low confidence)", "Not claimed (low confidence)"],
        ["Human welfare risk", "Severity high; likelihood not assessable (low confidence)", "Severity very high; likelihood not assessable (low confidence)", "Severity medium; likelihood not assessable (low confidence)"],
        ["Artificial-mind welfare risk", "Severity very high; likelihood not assessable (low confidence)", "Not applicable", "Severity unclear; likelihood not assessable (low confidence)"],
        ["Governance risk"] + ["Severity high; likelihood not assessable (low confidence)"] * 3,
        ["Safeguard adequacy"] + ["Unclear (low confidence)"] * 3,
        ["Decisive open question (alignment)", "Can an emulation keep specified values?", "Does neural feedback add information beyond explicit feedback?", "Can motivational mechanisms stay stable under learning?"],
        ["Reason for rating (Intelligence Curse)"] + [row["reason"] for row in curse_rows],
    ]

    codebook = [[]] + table(
        iw.CODEBOOK_HEADERS,
        [
            {"type": "Scenario", "code": "WBE-O", "family": "WBE", "definition": "AI overseer"},
            {"type": "Scenario", "code": "BCI-D", "family": "BCI", "definition": "Neural data for alignment"},
            {"type": "Scenario", "code": "NM-A", "family": "Neuromorphic AI", "definition": "Brain-inspired AGI architecture"},
            {"type": "Scenario", "code": "*-X / *-C / *-U", "family": "All", "definition": "Other (specify) / cross-cutting / unspecified"},
            {"type": "Stage", "code": "S1", "family": "WBE", "definition": "Neural component simulation"},
            {"type": "Stage", "code": "S3", "family": "WBE", "definition": "Whole brain emulation (single instance)"},
            {"type": "Stage", "code": "S6", "family": "WBE", "definition": "Deployed populations of emulations"},
            {"type": "Stage", "code": "S1", "family": "BCI", "definition": "Read-only / passive decoding"},
            {"type": "Stage", "code": "S1", "family": "Neuromorphic AI", "definition": "Neuromorphic substrate (hardware only)"},
            {"type": "Alignment problem", "code": "A-VS", "family": "All", "definition": Inline("Value specification: specifying or learning what the AI should optimize")},
            {"type": "Scenario", "code": "BCI-X", "family": "BCI", "definition": "Other (specify) '- used for the representational-constraint proposal (S01)"},
        ],
    )

    overview = [
        ["Neuroengineering proposal scorecard framework"],
        [],
        ["Purpose"],
        ["How strong is the case that [technology family] could improve AI alignment?"],
        [],
        ["Starting point"],
        ["Synopsis: one-page summary of every headline rating per family."],
        [],
        ["Tabs (in order)"],
        ["2 Theory of Change: 4 causal links with required assumptions and strongest objections."],
        [],
        ["Core principles"],
        ["1. Unit of analysis = technology family."],
        ["2. Each causal link is a separate claim."],
        [],
        ["Update protocol (per new source)"],
        ["1. Add a row to 3 Sources and code it in 3a Source Quality."],
    ]

    frameworks = [["§9 Reference Frameworks"], []] + table(
        iw.FRAMEWORK_HEADERS,
        [
            {
                "id": "RF1",
                "reference": "Future of Life Institute, FLI Governance Scorecard",
                "url": "FLI scorecard page",
                "contributes": "Scorecard format: graded dimensions with published rationale.",
                "applied": "Rationale per rating (4 Alignment Judgment col O).",
            },
            {
                "id": "RF2",
                "reference": "NIST, AI Risk Management Framework",
                "url": "https://example.org/rf2",
                "contributes": "Govern / Map / Measure / Manage functions.",
                "applied": "Not used.",
            },
        ],
    )

    return {
        iw.OVERVIEW: SheetSpec(iw.OVERVIEW, overview),
        iw.CODEBOOK: SheetSpec(iw.CODEBOOK, codebook),
        iw.SYNOPSIS: SheetSpec(iw.SYNOPSIS, synopsis),
        iw.REGISTER: SheetSpec(iw.REGISTER, table(iw.REGISTER_HEADERS, entries)),
        iw.SCOPE: SheetSpec(iw.SCOPE, scope),
        iw.MILESTONES: SheetSpec(iw.MILESTONES, milestone_rows, merged=["B2:K2", "B7:K7"]),
        iw.THEORY: SheetSpec(iw.THEORY, theory),
        iw.SOURCES: SheetSpec(iw.SOURCES, [[]] + table(iw.SOURCES_HEADERS, sources)),
        iw.SOURCE_QUALITY: SheetSpec(iw.SOURCE_QUALITY, [[]] + table(iw.QUALITY_HEADERS, quality)),
        iw.ALIGNMENT: SheetSpec(iw.ALIGNMENT, alignment),
        iw.MINDS: SheetSpec(iw.MINDS, minds),
        iw.CURSE: SheetSpec(iw.CURSE, curse),
        iw.AGENCY: SheetSpec(iw.AGENCY, agency),
        iw.RISKS: SheetSpec(iw.RISKS, risks),
        iw.GOVERNANCE: SheetSpec(iw.GOVERNANCE, governance),
        iw.WELFARE: SheetSpec(iw.WELFARE, welfare),
        iw.FRAMEWORKS: SheetSpec(iw.FRAMEWORKS, frameworks, links={"C4": "https://example.org/rf1"}),
        iw.VALIDATION_LISTS: SheetSpec(iw.VALIDATION_LISTS, [["L_Role"], ["Supports"]], hidden=True),
    }


def set_cell(sheets: dict[str, SheetSpec], tab: str, ref: str, value: object) -> None:
    """Change one cell, e.g. set_cell(sheets, iw.REGISTER, "P2", "Supportive")."""
    letters = "".join(character for character in ref if character.isalpha())
    row = int(ref[len(letters) :]) - 1
    column = 0
    for letter in letters:
        column = column * 26 + (ord(letter) - ord("A") + 1)
    column -= 1
    rows = sheets[tab].rows
    while len(rows) <= row:
        rows.append([])
    while len(rows[row]) <= column:
        rows[row].append("")
    rows[row][column] = value


def write_workbook(tmp_path: Path, sheets: dict[str, SheetSpec] | None = None, name: str = "Scorecard v0.4.xlsx") -> Path:
    if sheets is None:
        sheets = workbook_sheets()
    return build_xlsx(tmp_path / name, list(sheets.values()))


# ---------------------------------------------------------------------------
# The synthetic content folder


def claim(text: str, **extra) -> dict:
    return {"text": text, "provenance": "team", **extra}


def site_source(register_id: str, **changes) -> dict:
    record = {
        "id": register_id.lower(),
        "register_id": register_id,
        "title": f"Site title of {register_id}",
        "authors": ["A. Author"],
        "year": 2023,
        "url": f"https://example.org/{register_id.lower()}",
        "other_urls": [],
        "doi": None,
        "arxiv_id": None,
        "venue": None,
        "source_type": "report",
        "kind": None,
        "technology": ["wbe"],
        "problem": "alignment",
        "claim_directions": [],
        "evidence_type": None,
        "directness": None,
        "independence": None,
        "relevance": None,
        "credibility": None,
        "credibility_unclear_reason": None,
        "summary": claim(f"Approved site summary of {register_id}."),
        "ai_suggested_fields": [],
        "added_by": "Vilija",
        "reviewed_by": None,
        "reviewed_on": None,
        "sample": False,
    }
    record.update(changes)
    return record


def site_milestone(milestone_id: str, category: str, technology: str = "wbe", sample: bool = False) -> dict:
    unassessed = {"text": "We haven't assessed this.", "provenance": "unclear", "unclear_reason": "search_incomplete"}
    return {
        "id": milestone_id,
        "name": f"Site name of {milestone_id}",
        "technology": technology,
        "stage": "possible",
        "category": category,
        "status": "not_demonstrated",
        "status_basis": claim("Old status basis.", source_ids=["s13"]),
        "achieved_in": None,
        "achieved_in_basis": None,
        "confidence": "low",
        "summary": claim(f"Site summary of {milestone_id}."),
        "success_criterion": claim("Old criterion."),
        "main_bottleneck": claim("Old bottleneck."),
        "depends_on": [],
        "source_ids": ["s13"],
        "estimate": None,
        "forecasts": [],
        "disagreement_override": None,
        "disagreement_note": None,
        "would_move_earlier": [dict(unassessed)],
        "would_move_later": [dict(unassessed)],
        "artificial_minds_questions": [],
        "sample": sample,
    }


def site_page(family: str) -> dict:
    def case_row(row_id: str, dimension: str, problem: str | None) -> dict:
        return {
            "id": row_id,
            "dimension": dimension,
            "problem": problem,
            "scale": "case",
            "rating": "unclear",
            "confidence": "low",
            "unclear_reason": "search_incomplete",
            "basis": claim("Old basis."),
        }

    def risk_row(row_id: str, dimension: str) -> dict:
        return {"id": row_id, "dimension": dimension, "problem": None, "scale": "risk", "rating": None, "confidence": "low", "basis": None}

    rows = [
        case_row("alignment-case", "Alignment case", "alignment"),
        case_row("intelligence-curse-case", "Intelligence Curse case", "intelligence_curse"),
        risk_row("human-welfare-risk", "Human welfare risk"),
        risk_row("artificial-mind-welfare-and-rights-risk", "Artificial-mind welfare and rights risk"),
        risk_row("governance-risk", "Governance risk"),
        case_row("safeguard-adequacy", "Safeguard adequacy", None),
    ]
    if family == "wbe":
        rows[0]["tracker"] = {
            "what_would_change": claim("Direct evidence that a WBE system solves a specified alignment problem."),
            "last_updated": "2026-11-16",
            "placeholder": True,
        }
    page = {
        "id": family,
        "name": f"Site name for {family}",
        "short_name": family.upper(),
        "headline": "Could this *keep humans* in the loop?",
        "intro": claim("Site intro, written by the team."),
        "claims_to_solve": [],
        "mechanism": [],
        "strongest_case": [],
        "strongest_objections": [],
        "scorecard": rows,
        "artificial_minds_questions": [],
        "alternatives": [claim("A site-authored alternative.")] if family == "wbe" else [],
        "unreviewed_ai_sections": family != "wbe",
    }
    return page


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


@pytest.fixture
def content(tmp_path: Path) -> Path:
    folder = tmp_path / "content"
    folder.mkdir()
    write_json(folder / "technologies.json", [site_page(family) for family in ("wbe", "bci", "neuromorphic")])
    sources = [site_source(register_id) for register_id in ("S01", "S08", "S13", "S16", "S20", "S21", "S22")]
    sample = site_source("S99", id="sample-report", sample=True, url="https://example.org/sample")
    sample["register_id"] = None
    sources.insert(0, sample)
    write_json(folder / "sources.json", sources)
    write_json(
        folder / "milestones.json",
        [
            site_milestone("bci-sample", "technical_capability", technology="bci", sample=True),
            site_milestone("wbe-tech", "technical_capability"),
            site_milestone("wbe-econ", "economic_viability"),
        ],
    )
    (folder / "posts").mkdir()
    (folder / "posts" / "hello.md").write_text("---\ntitle: Hi\n---\nA post.\n", encoding="utf-8")
    (folder / "README.md").write_text("Content notes.\n", encoding="utf-8")
    return folder


def run(workbook: Path, content: Path, **options) -> tuple[int, str]:
    lines: list[str] = []
    options.setdefault("skip_validate", True)
    options.setdefault("version_flag", "0.4")
    version = options.pop("version_flag")
    status = iw.run_import(workbook, content, version, out=lines.append, **options)
    return status, "\n".join(lines)


def load(content: Path, name: str):
    return json.loads((content / name).read_text(encoding="utf-8"))


def page(content: Path, family: str) -> dict:
    return next(item for item in load(content, "technologies.json") if item["id"] == family)


def snapshot(folder: Path) -> dict[str, bytes]:
    return {str(path.relative_to(folder)): path.read_bytes() for path in sorted(folder.rglob("*")) if path.is_file()}


# ---------------------------------------------------------------------------
# The xlsx reader


def test_reader_reads_every_kind_of_cell(tmp_path: Path):
    sheets = [
        SheetSpec(
            "Cells",
            [
                ["plain", Inline("inline text"), Num("2023.0"), Rich(["rich ", "text"], phonetic="hint"), Bool(True)],
                [Formula("A1&A1", "cached value"), "line one\r\nline two", "caf" + "e" + COMBINING_ACUTE, "tab_x0009_here", ""],
            ],
            links={"B2": "https://example.org/linked"},
            merged=["A3:C3"],
        ),
        SheetSpec("Hidden", [["x"]], hidden=True),
    ]
    workbook = build_xlsx(tmp_path / "cells.xlsx", sheets)
    cells, hidden = read_workbook(workbook)

    assert cells.name == "Cells" and not cells.hidden
    assert hidden.hidden
    assert cells.row_values(0) == ["plain", "inline text", "2023.0", "rich text", "TRUE"]
    # The phonetic hint is not part of the text, and a number is marked as one.
    assert (0, 2) in cells.numbers and (0, 0) not in cells.numbers
    assert cells.value(1, 0) == "cached value"
    assert cells.value(1, 1) == "line one\nline two"
    assert cells.value(1, 2) == "café"  # NFC: one code point
    assert len(cells.value(1, 2)) == 4
    assert cells.value(1, 3) == "tab\there"
    # Past the end of a row is an empty cell, not an error.
    assert cells.value(1, 9) == "" and cells.row_values(1, 6)[-1] == ""
    assert cells.links == {(1, 1): "https://example.org/linked"}
    assert cells.merged == ["A3:C3"]


def test_reader_handles_cells_without_a_reference(tmp_path: Path):
    raw = (
        f'<worksheet xmlns="{MAIN_NS}"><sheetData>'
        '<row><c t="inlineStr"><is><t>a</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row>'
        '<row r="3"><c r="B3" t="inlineStr"><is><t>c</t></is></c><c t="inlineStr"><is><t>d</t></is></c></row>'
        "</sheetData></worksheet>"
    )
    workbook = build_xlsx(tmp_path / "noref.xlsx", [SheetSpec("Raw", [])], raw_sheets={"Raw": raw})
    (sheet,) = read_workbook(workbook)
    assert sheet.row_values(0) == ["a", "b"]
    assert sheet.row_values(2) == ["", "c", "d"]
    assert sheet.is_blank_row(1)


@pytest.mark.parametrize(
    ("cell", "message"),
    [
        (Error("#REF!"), "holds the error #REF!"),
        (Formula("A1*2", None), "formula but no saved value"),
    ],
)
def test_reader_refuses_cells_it_cannot_read_faithfully(tmp_path: Path, cell: object, message: str):
    workbook = build_xlsx(tmp_path / "bad.xlsx", [SheetSpec("Bad", [["ok", cell]])])
    with pytest.raises(XlsxError, match=message) as raised:
        read_workbook(workbook)
    assert "Bad!B1" in str(raised.value)


def test_reader_refuses_a_doctype_and_a_non_workbook(tmp_path: Path):
    raw = f'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><worksheet xmlns="{MAIN_NS}"><sheetData/></worksheet>'
    workbook = build_xlsx(tmp_path / "doctype.xlsx", [SheetSpec("Raw", [])], raw_sheets={"Raw": raw})
    with pytest.raises(XlsxError, match="DOCTYPE"):
        read_workbook(workbook)
    not_zip = tmp_path / "not.xlsx"
    not_zip.write_text("hello", encoding="utf-8")
    with pytest.raises(XlsxError, match="not an .xlsx file"):
        read_workbook(not_zip)


# ---------------------------------------------------------------------------
# Small pieces


def test_ids_in_text_expands_ranges_and_never_reads_stage_codes_as_sources():
    text = "stages S1 component simulation; No source dates S3; S13: many years out; argued (S20-S22). S13 again."
    assert iw.ids_in_text(text, "S", 2) == ["S13", "S20", "S21", "S22"]
    assert iw.ids_in_text("Main harms (R01-R03, R20)", "R", 2) == ["R01", "R02", "R03", "R20"]
    with pytest.raises(iw.WorkbookError, match="backwards"):
        iw.ids_in_text("S22-S20", "S", 2)


def test_tidy_whitespace_works_line_by_line_and_keeps_line_breaks():
    assert iw.tidy_whitespace("  a  b \nPrimary source: \n c ") == "a b\nPrimary source:\nc"


def test_insert_in_order_keeps_existing_keys_in_place():
    record = {"id": "x", "name": "n", "sample": False}
    iw.insert_in_order(record, "status", "unclear", ["id", "name", "status", "sample"])
    assert list(record) == ["id", "name", "status", "sample"]
    iw.insert_in_order(record, "name", "changed", ["id", "name", "status", "sample"])
    assert list(record) == ["id", "name", "status", "sample"] and record["name"] == "changed"


def test_row_to_source_admits_screening_pending_rows_only_when_asked():
    row = {
        "Source ID": "S17",
        "Added by": "Aila",
        "Category": "AI Alignment",
        "Claim (+/-)": "AI Misalignment",
        "Resource Title": "A paper",
        "Resource Type": "Journal article; screening pending",
        "Resource Date": "2023",
        "Author(s)": "Diana Deca; Caswell Barry",
        "3 sentence summary": "A summary.",
        "Mechanism": "Whole Brain Emulation",
        "Link": "https://example.org/s17",
    }
    warnings: list[str] = []
    assert row_to_source(row, warnings) is None
    record = row_to_source(row, warnings, admit_screening_pending=True)
    assert record is not None and record["id"] == "s17" and record["added_by"] == "Vilija"


# ---------------------------------------------------------------------------
# The import


def test_import_writes_every_tab_in_the_contract_shapes(tmp_path: Path, content: Path):
    status, report = run(write_workbook(tmp_path), content)
    assert status == 0, report
    card = load(content, "scorecard.json")

    assert list(card) == [
        "generated",
        "workbook",
        "overview",
        "codebook",
        "frameworks",
        "milestone_categories",
        "milestone_assessments",
        "entries",
        "links",
        "risks",
        "governance",
        "scope_notes",
        "cross_family_scope",
    ]
    assert card["generated"] == iw.GENERATED_NOTE
    assert card["workbook"]["title"] == "Neuroengineering proposal scorecard framework"
    assert card["workbook"]["version"] == "0.4"
    assert len(card["workbook"]["source_sha256"]) == 64
    assert card["overview"] == {
        "purpose": "How strong is the case that [technology family] could improve AI alignment?",
        "principles": ["1. Unit of analysis = technology family.", "2. Each causal link is a separate claim."],
        "update_protocol": ["1. Add a row to 3 Sources and code it in 3a Source Quality."],
    }

    # Codebook in sheet order, an inline string read as text (with its site
    # wording fix, British "optimise", applied), the "'- " fix applied.
    assert card["codebook"][9]["definition"] == "Value specification: specifying or learning what the AI should optimise"
    assert card["codebook"][-1] == {
        "type": "Scenario",
        "code": "BCI-X",
        "family": "BCI",
        "definition": "Other, used for the representational-constraint proposal (S01)",
    }
    # A link kept only in the sheet's rels is used when the cell has no URL.
    assert card["frameworks"][0]["url"] == "https://example.org/rf1"
    assert card["frameworks"][1]["url"] == "https://example.org/rf2"

    # The merged heading row gives the category, its label and its question.
    assert card["milestone_categories"][0] == {
        "id": "M1",
        "category": "technical_capability",
        "label": "Technical capability",
        "question": "Can the relevant components be built and operated? Counts as evidence: progress on a named prerequisite. Does not count: optimism.",
    }
    assessments = card["milestone_assessments"]
    assert [(row["family"], row["milestone"], row["applies_to"]) for row in assessments][:3] == [
        ("wbe", "M1", "All WBE uses"),
        ("bci", "M1", "Neural feedback for alignment"),
        ("bci", "M1", "Oversight and enhancement"),
    ]
    bci_m6 = assessments[-1]
    # Word for word in the text, but the id the cell rules out is not counted.
    assert bci_m6["evidence"] == "E001 (projected); E004 not admissible"
    assert bci_m6["evidence_entries"] == ["E001"]
    assert bci_m6["note"] == "'Low cost' statements (S01, S08) do not count as evidence."
    assert assessments[1]["note"] is None  # an empty trailing cell
    assert "E004 left out of evidence_entries" in report

    entries = {entry["id"]: entry for entry in card["entries"]}
    assert entries["E001"]["claim"] == "A generative model could act as a proxy."  # rich text runs, no phonetic hint
    assert entries["E001"]["locator"] == "Summary page"  # trimmed, spaces collapsed
    assert entries["E027"]["source_type_independence"] == "Podcast; Affiliated (co-founder, Zander Labs, commercial pBCI)"
    assert entries["E027"]["feeds"] == [
        {"family": "bci", "target": "alignment", "direction": "supports", "note": None},
        {"family": "bci", "target": "intelligence_curse", "direction": "supports", "note": None},
    ]
    assert entries["E004"]["feeds"] == [{"family": "bci", "target": "M6", "direction": "against_or_qualifies", "note": None}]
    assert entries["E077"]["feeds"] == [] and entries["E077"]["feeds_text"] == "Not used in a headline rating"
    assert entries["E042"]["family"] == "cross_family"
    assert entries["E042"]["scenarios"] == ["NM-A", "NM-C"]
    assert entries["E042"]["codes"] == ["NM-A-L1", "AM"]
    assert (entries["E042"]["directness"], entries["E042"]["role"], entries["E042"]["basis"]) == (
        "related_neuroai",
        "supports",
        "projected",
    )
    assert entries["E077"]["source_id"] == "s17" and entries["E077"]["register_id"] == "S17"

    links = {link["id"]: link for link in card["links"]}
    assert links["WBE-O-L1"]["objection"] is None
    assert links["BCI-D-L1"]["supporting"] == ["E001", "E027"]
    assert links["BCI-D-L1"]["step"] == "Condition (timing, spillover, security)"
    assert links["NM-A-L1"] == {
        "id": "NM-A-L1",
        "family": "neuromorphic",
        "scenario_code": "NM-A",
        "scenario": "Brain-inspired AGI architecture",
        "step": "1 Capability",
        "outcome": "Both",
        "claim": "A motivational architecture can be specified.",
        "status": "search_incomplete",
        "supporting": [],
        "contrary": [],
        "qualifying": [],
        "best_directness": None,
        "assumption": None,
        "objection": None,
    }
    risks = {risk["id"]: risk for risk in card["risks"]}
    assert risks["R02"]["families"] == ["wbe", "neuromorphic", "bci"]
    assert (risks["R01"]["severity"], risks["R01"]["likelihood"]) == ("very_high", "not_assessable")
    assert card["governance"][1] == {
        "id": "G02",
        "family": "bci",
        "question": "Mental privacy",
        "status": "not_addressed",
        "entries": [],
        "summary": None,
    }
    assert card["scope_notes"][2].startswith("Time horizon bands are provisional")
    assert card["cross_family_scope"] == {
        "intervention": "Sources spanning families are coded per claim and never set a family rating alone.",
        "deployment_scenario": "*-C / *-U codes",
        "source_ids": ["s13", "s16"],
        "source_ids_text": "S13, S16",
    }


def test_import_fills_the_page_sections_and_scorecard_rows(tmp_path: Path, content: Path):
    status, report = run(write_workbook(tmp_path), content)
    assert status == 0, report
    wbe = page(content, "wbe")

    scope = wbe["scope"]
    # The arrow and its problem come off the text; S1 to S3 are stages, not sources.
    assert scope["problems_claimed"] == {
        "text": "Alignment: scalable oversight (WBE-O). Intelligence Curse: displacement argued (S20-S22).",
        "provenance": "team",
        "source_ids": ["s20", "s21", "s22"],
    }
    assert scope["problem"] == "both"
    assert "source_ids" not in scope["intervention"]
    assert scope["time_horizon"]["source_ids"] == ["s13"]
    assert scope["source_ids"] == ["s13", "s16", "s20", "s21", "s22"]
    # The cell itself is kept as written, range and all, for the page to show.
    assert scope["source_ids_text"] == "S13, S16, S20-S22"
    assert list(scope)[-2:] == ["source_ids", "source_ids_text"]
    assert page(content, "neuromorphic")["scope"]["problem"] == "alignment"

    alignment = wbe["alignment_assessment"]
    assert list(alignment) == [
        "problem_addressed",
        "mechanism",
        "questions",
        "rating",
        "confidence",
        "unclear_reason",
        "reason",
        "decisive_question",
        "scenarios",
    ]
    assert (alignment["rating"], alignment["confidence"], alignment["unclear_reason"]) == ("weak", "low", None)
    assert alignment["scenarios"] == [
        {
            "scenario": "WBE as AI overseer",
            "problem": "Oversight",
            "mechanism": "Human-derived overseer supervises AI",
            "supporting": [],
            "contrary_or_qualifying": ["E037"],
            "gap": "No entry addresses supervising a more capable system (WBE-O-L4).",
        }
    ]

    curse = page(content, "neuromorphic")["intelligence_curse_assessment"]
    assert [question["question"] for question in curse["questions"]] == [
        "Who gains, who loses",
        "Who owns infrastructure, data and returns",
        "Complements, delays or deepens replacement?",
        "Benefit over comparator",
    ]
    assert curse["rating"] == "not_claimed" and curse["decisive_question"] is None
    assert curse["ownership_gate"] == "None answered."
    assert curse["agency"] == [
        {
            "group": "Political and institutional influence",
            "effect": "not_addressed",
            "mechanism": None,
            "ownership_questions": None,
            "entries": [],
        }
    ]

    stages = wbe["artificial_minds_by_stage"]
    assert stages[0]["stage"] == "S3" and stages[0]["stage_number"] == 3
    assert stages[0]["stage_label"] == "3 Whole brain emulation (one instance)"
    assert stages[0]["welfare"] is None and stages[0]["source_ids"] == ["s16", "s22"]
    assert page(content, "bci")["artificial_minds_by_stage"] == [
        {
            "stage": None,
            "stage_number": None,
            "stage_label": "All stages",
            "consciousness": None,
            "moral_status": None,
            "identity": None,
            "welfare": None,
            "protections": None,
            "source_ids": [],
            "entries": [],
        }
    ]

    rows = {row["id"]: row for row in page(content, "bci")["scorecard"]}
    assert rows["artificial-mind-welfare-and-rights-risk"] == {
        "id": "artificial-mind-welfare-and-rights-risk",
        "dimension": "Artificial-mind welfare and rights risk",
        "problem": None,
        "scale": "risk",
        "rating": None,
        "confidence": "medium",
        "severity": None,
        "likelihood": None,
        "applicable": False,
        "basis": None,
    }
    assert (rows["human-welfare-risk"]["severity"], rows["human-welfare-risk"]["applicable"]) == ("very_high", True)
    assert rows["alignment-case"]["unclear_reason"] is None
    assert rows["safeguard-adequacy"]["rating"] == "unclear"
    assert rows["safeguard-adequacy"]["basis"]["text"] == "Two sources (S01; S08) identify the mechanism."
    assert rows["safeguard-adequacy"]["basis"]["source_ids"] == ["s01", "s08"]
    assert wbe["welfare_governance"]["harms"]["text"] == "Suffering; capability spillover (R01-R02)"

    # Section keys follow the model's field order.
    assert list(page(content, "bci"))[-6:] == [
        "scope",
        "alignment_assessment",
        "intelligence_curse_assessment",
        "artificial_minds_by_stage",
        "welfare_governance",
        "unreviewed_ai_sections",
    ]


def key_order_problems(model: type, data: object, path: str) -> list[str]:
    """Every record whose keys are not in the model's field order. Keys a record
    leaves out are skipped; nested models are checked too."""
    import typing

    from pydantic import BaseModel

    def nested_model(annotation: object) -> type | None:
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            return annotation
        for argument in typing.get_args(annotation):
            found = nested_model(argument)
            if found is not None:
                return found
        return None

    if isinstance(data, list):
        return [problem for index, item in enumerate(data) for problem in key_order_problems(model, item, f"{path}[{index}]")]
    if not isinstance(data, dict):
        return []
    expected = [name for name in model.model_fields if name in data]
    problems = [] if list(data) == expected else [f"{path}: {list(data)} should be {expected}"]
    for name, info in model.model_fields.items():
        inner = nested_model(info.annotation)
        if inner is not None and name in data:
            problems += key_order_problems(inner, data[name], f"{path}.{name}")
    return problems


def test_output_matches_the_models(tmp_path: Path, content: Path):
    from sf_shared.models import Milestone, ScorecardFile, Source, TechnologyPage

    status, report = run(write_workbook(tmp_path), content)
    assert status == 0, report
    ScorecardFile.model_validate(load(content, "scorecard.json"))
    for item in load(content, "technologies.json"):
        TechnologyPage.model_validate(item)
    # The writer keeps the models' field order, so the files read the same way
    # whether the import or the migration wrote them.
    problems = key_order_problems(ScorecardFile, load(content, "scorecard.json"), "scorecard")
    problems += key_order_problems(TechnologyPage, load(content, "technologies.json"), "technologies")
    problems += key_order_problems(Source, load(content, "sources.json"), "sources")
    problems += key_order_problems(Milestone, load(content, "milestones.json"), "milestones")
    assert problems == []


@pytest.mark.parametrize(
    "table, enum_name",
    [
        ("CASE_RATING", "CaseRating"),
        ("CONFIDENCE", "Confidence"),
        ("SEVERITY", "Severity"),
        ("LIKELIHOOD", "Likelihood"),
        ("LEVEL", "RiskLevel"),
        ("RISK_DOMAIN", "RiskDomain"),
        ("MILESTONE_STATUS", "MilestoneStatus"),
        ("EVIDENCE_STATUS", "EvidenceStatus"),
        ("GOVERNANCE_STATUS", "GovernanceStatus"),
        ("AGENCY_EFFECT", "AgencyEffect"),
        ("DIRECTNESS", "EvidenceDirectness"),
        ("ROLE", "EvidenceRole"),
        ("BASIS", "EvidenceBasis"),
    ],
)
def test_each_sheet_value_maps_to_the_enum_value_with_that_label(table: str, enum_name: str):
    # The site shows the enum's label in place of the cell, so the label must be
    # the sheet's own word for the value the import stores. The one exception is
    # a sheet word that names the workbook's database: the site labels it in its
    # own words (site wording, 2026-11-20), and the import still reads the
    # sheet's word.
    from sf_shared.enums import ENUM_INFO

    relabelled = {("GovernanceStatus", "Not addressed in database"): "Not addressed by any source"}
    labels = {value: label for value, (label, _description) in ENUM_INFO[enum_name]["values"].items()}
    for sheet_value, stored in getattr(iw, table).items():
        assert labels[stored] == relabelled.get((enum_name, sheet_value), sheet_value)


def test_sources_get_s17_quality_and_missing_links(tmp_path: Path, content: Path):
    status, report = run(write_workbook(tmp_path), content)
    assert status == 0, report
    sources = load(content, "sources.json")
    ids = [source["id"] for source in sources]
    assert ids.index("s17") == ids.index("s16") + 1

    s17 = sources[ids.index("s17")]
    assert s17["summary"] == {"text": S17_PUBLISHED, "provenance": "team"}
    assert s17["screening_pending"] is True
    assert s17["authors"] == ["Diana Deca", "Caswell Barry", "Samit Chakrabarty"]
    assert s17["year"] == 2023 and s17["added_by"] == "Vilija"
    assert list(s17)[-3:] == ["quality", "screening_pending", "sample"]
    assert "first sentences only" in report

    s08 = sources[ids.index("s08")]
    assert s08["other_urls"] == ["https://example.org/s08-second"]
    assert s08["quality"]["affiliation"] == "Affiliated (co-founder, Zander Labs, commercial pBCI)"
    assert "screening_pending" not in s08
    # Approved site text stays.
    assert s08["title"] == "Site title of S08" and s08["summary"]["text"] == "Approved site summary of S08."
    assert sources[0]["id"] == "sample-report" and "quality" not in sources[0]


def test_refresh_source_text_replaces_titles_authors_and_summaries(tmp_path: Path, content: Path):
    status, report = run(write_workbook(tmp_path), content, refresh_source_text=True)
    assert status == 0, report
    s08 = next(source for source in load(content, "sources.json") if source["id"] == "s08")
    assert s08["title"] == "Title of S08"
    assert s08["authors"] == ["Ada Lovelace"]
    assert s08["summary"]["text"] == "Sheet summary of S08."


def test_wbe_timeline_milestones_take_tab_1a(tmp_path: Path, content: Path):
    status, report = run(write_workbook(tmp_path), content)
    assert status == 0, report
    milestones = {milestone["id"]: milestone for milestone in load(content, "milestones.json")}
    tech = milestones["wbe-tech"]
    assert tech["name"] == "Site name of wbe-tech" and tech["summary"]["text"] == "Site summary of wbe-tech."
    assert tech["status"] == "not_demonstrated"
    assert tech["status_basis"] == claim("E037 (components demonstrated; whole brain argued)", source_ids=["s13"])
    assert tech["success_criterion"] == claim("Five prerequisites (P1 to P5) at the scale the use needs.")
    assert tech["assessment_confidence"] == "medium" and tech["confidence"] == "low"
    assert tech["evidence_entries"] == ["E037"]
    assert tech["timing"] == "No date in any source (S13 'many years out')"
    assert list(tech)[-7:] == ["assessment_confidence", "applies_to", "criterion_met", "evidence_entries", "timing", "note", "sample"]
    # The sources the 1a row cites: E037's source (S13), then the timing (S13) and note (S16) cells.
    assert tech["source_ids"] == ["s13", "s16"]
    assert list(tech).index("source_ids") == list(site_milestone("wbe-tech", "technical_capability")).index("source_ids")

    economics = milestones["wbe-econ"]
    assert economics["status"] == "unclear"
    assert economics["main_bottleneck"] is None  # the 1a cell is empty
    assert economics["status_basis"] == claim("None")
    assert economics["source_ids"] == []  # no entries, and no S-id in any cell (was ["s13"])
    assert milestones["bci-sample"]["status_basis"]["text"] == "Old status basis."
    assert milestones["bci-sample"]["source_ids"] == ["s13"]
    assert "WBE-M1" in report and "no WBE timeline milestone" not in report


def test_milestone_source_ids_list_every_source_the_1a_row_cites(tmp_path: Path, content: Path):
    sheets = workbook_sheets()
    # WBE M1 is row 3: D success criterion, G evidence, H main bottleneck, I timing, K note.
    set_cell(sheets, iw.MILESTONES, "D3", "Five prerequisites at the scale the use needs (S21).")
    set_cell(sheets, iw.MILESTONES, "H3", "P2 turning a connectome into a runnable model (S20-S22)")
    status, report = run(write_workbook(tmp_path, sheets), content)
    assert status == 0, report
    tech = next(milestone for milestone in load(content, "milestones.json") if milestone["id"] == "wbe-tech")
    # Entry sources first (E037: S13), then the cells in order, ranges expanded, each id once.
    assert tech["source_ids"] == ["s13", "s21", "s20", "s22", "s16"]
    # status_basis still cites only the entries and the evidence cell.
    assert tech["status_basis"]["source_ids"] == ["s13"]


def test_paths_outside_the_allowlist_stay_identical(tmp_path: Path, content: Path):
    before = {name: load(content, name) for name in ("technologies.json", "sources.json", "milestones.json")}
    other_files = {name: data for name, data in snapshot(content).items() if not name.endswith(".json")}
    status, report = run(write_workbook(tmp_path), content)
    assert status == 0, report

    after_pages = {item["id"]: item for item in load(content, "technologies.json")}
    page_keys = {"scope", "alignment_assessment", "intelligence_curse_assessment", "artificial_minds_by_stage", "welfare_governance"}
    row_keys = {"rating", "confidence", "unclear_reason", "severity", "likelihood", "applicable", "basis"}
    for old_page in before["technologies.json"]:
        new_page = after_pages[old_page["id"]]
        for key, value in old_page.items():
            if key == "scorecard":
                continue
            assert key in page_keys or json.dumps(new_page[key]) == json.dumps(value), key
        for old_row, new_row in zip(old_page["scorecard"], new_page["scorecard"]):
            for key in set(old_row) | set(new_row):
                if key not in row_keys:
                    assert json.dumps(old_row.get(key)) == json.dumps(new_row.get(key)), (old_page["id"], old_row["id"], key)

    after_sources = {source["id"]: source for source in load(content, "sources.json")}
    for old in before["sources.json"]:
        new = after_sources[old["id"]]
        for key in set(old) | set(new):
            if key not in ("quality", "screening_pending", "other_urls"):
                assert json.dumps(old.get(key)) == json.dumps(new.get(key)), (old["id"], key)
    assert json.dumps(after_sources["sample-report"]) == json.dumps(before["sources.json"][0])

    owned = set(iw.MILESTONE_FIELDS)
    assert "source_ids" in owned
    after_milestones = {milestone["id"]: milestone for milestone in load(content, "milestones.json")}
    assert json.dumps(after_milestones["bci-sample"]) == json.dumps(before["milestones.json"][0])
    for old in before["milestones.json"]:
        new = after_milestones[old["id"]]
        for key in set(old) | set(new):
            if old["technology"] != "wbe" or old["sample"] or key not in owned:
                assert json.dumps(old.get(key)) == json.dumps(new.get(key)), (old["id"], key)

    assert {name: data for name, data in snapshot(content).items() if not name.endswith(".json")} == other_files


def test_the_allowlist_guard_refuses_a_change_it_does_not_own():
    old = [{"id": "wbe", "intro": {"text": "a"}, "scorecard": [{"id": "alignment-case", "rating": "weak", "dimension": "A"}]}]
    allowed = [{"id": "wbe", "intro": {"text": "a"}, "scorecard": [{"id": "alignment-case", "rating": "strong", "dimension": "A"}]}]
    iw.check_allowed("technologies.json", old, allowed, iw.PAGE_ALLOWED)
    for changed in (
        [{"id": "wbe", "intro": {"text": "b"}, "scorecard": old[0]["scorecard"]}],
        [{"id": "wbe", "intro": {"text": "a"}, "scorecard": [{"id": "alignment-case", "rating": "weak", "dimension": "B"}]}],
    ):
        with pytest.raises(RuntimeError, match="does not own"):
            iw.check_allowed("technologies.json", old, changed, iw.PAGE_ALLOWED)


def test_the_milestone_allowlist_owns_source_ids_on_updated_milestones_only():
    old = [
        {"id": "wbe-tech", "name": "A", "source_ids": ["s02", "s13"]},
        {"id": "bci-sample", "name": "B", "source_ids": ["s13"]},
    ]
    patterns = iw.milestone_patterns(["wbe-tech"])
    retargeted = copy.deepcopy(old)
    retargeted[0]["source_ids"] = ["s13", "s16"]
    iw.check_allowed("milestones.json", old, retargeted, patterns)
    for index, key, value in ((1, "source_ids", ["s16"]), (0, "name", "C")):
        changed = copy.deepcopy(old)
        changed[index][key] = value
        with pytest.raises(RuntimeError, match="does not own"):
            iw.check_allowed("milestones.json", old, changed, patterns)


def test_two_runs_give_byte_identical_files(tmp_path: Path, content: Path):
    workbook = write_workbook(tmp_path)
    assert run(workbook, content)[0] == 0
    first = snapshot(content)
    status, report = run(workbook, content)
    assert status == 0
    assert snapshot(content) == first
    assert "Nothing to write" in report


def test_dry_run_writes_nothing_and_prints_a_diff(tmp_path: Path, content: Path):
    before = snapshot(content)
    status, report = run(write_workbook(tmp_path), content, dry_run=True)
    assert status == 0, report
    assert snapshot(content) == before
    assert "+++ b/scorecard.json" in report and "Dry run: nothing written." in report


def test_new_content_is_validated_before_anything_is_written(tmp_path: Path, content: Path):
    before = snapshot(content)
    seen: list[Path] = []

    def failing_validator(folder: Path) -> tuple[bool, list[str]]:
        seen.append(folder)
        assert (folder / "scorecard.json").exists()  # a copy with the new files
        return False, ["scorecard[0]: something is wrong"]

    status, report = run(write_workbook(tmp_path), content, skip_validate=False, validator=failing_validator)
    assert status == 1
    assert "doesn't validate, so nothing was written" in report and "something is wrong" in report
    assert seen and seen[0] != content
    assert snapshot(content) == before

    status, report = run(write_workbook(tmp_path), content, skip_validate=False, validator=lambda folder: (True, []))
    assert status == 0 and "The new content validates." in report
    assert (content / "scorecard.json").exists()
    assert not list(content.glob(".*import-tmp"))


def test_report_lists_fixes_and_cells_it_did_not_use(tmp_path: Path, content: Path):
    status, report = run(write_workbook(tmp_path), content)
    assert status == 0, report
    fixes = report.split("Glitch fixes applied")[1].split("Glitch fixes no longer needed")[0]
    for where in ("Codebook!D13", "0 Evidence Register!H4", "3a Source Quality!G4", "3a Source Quality!G6", "1a Milestones!K9"):
        assert where in fixes, where
    # Listed fixes for cells this workbook doesn't have are reported, not applied.
    assert 'Codebook Display class: Database insufficient "Definition": cell not found' in report
    assert "0 Evidence Register!C2: 'Summary  page ' -> 'Summary page'" in report
    # Text the site doesn't publish is listed, not dropped silently.
    unused = report.split("Cells with text the import did not use")[1]
    assert "Overview, row 7: A7" in unused
    assert '3 Sources, column "Claim 1"' in unused
    assert "9 Reference Frameworks, row 1: A1" in unused
    assert "Validation Lists: hidden tab, not imported" in unused


def test_report_lists_consistency_warnings(tmp_path: Path, content: Path):
    status, report = run(write_workbook(tmp_path), content)
    assert status == 0, report
    warnings = report.split("Consistency warnings")[1].split("\nNotes")[0]
    expected = [
        "says 4 causal links, but the tab has 3",
        'Synopsis!C5 (BCI, Artificial-mind welfare risk) says "Not applicable"',
        '"AM" (in E042, E096) matches no link',
        '"A-X" is used 1 times but the Codebook does not define it',
        '"D05" appears in 1 Scope!F5',
        '"D03" appears in 1 Scope!B7',
        "1a Milestones BCI-M6 (Neural feedback; oversight) cites E001 for BCI-M6",
        "4 Alignment Judgment lists E037 as contrary or qualifying for WBE",
        '4.1 Artificial Minds WBE "3 Whole brain emulation (one instance)" differs from the Codebook label for S3',
        'refers to "4 Alignment Judgment" col O, but that tab ends at column J',
        'cites "Andregg 2023", which matches no source',
    ]
    for text in expected:
        assert text in warnings, text


def test_an_unlisted_glitch_is_reported_and_left_alone(tmp_path: Path, content: Path):
    sheets = workbook_sheets()
    set_cell(sheets, iw.REGISTER, "D8", "Foresight Institute '- funds research.")
    status, report = run(write_workbook(tmp_path, sheets), content)
    assert status == 0, report
    entry = next(entry for entry in load(content, "scorecard.json")["entries"] if entry["id"] == "E096")
    assert entry["claim"] == "Foresight Institute '- funds research."
    assert "0 Evidence Register!D8: possible mangled dash" in report


def test_a_fix_whose_cell_changed_is_no_longer_needed(tmp_path: Path, content: Path):
    sheets = workbook_sheets()
    set_cell(sheets, iw.CODEBOOK, "D13", "Other (specify): used for the representational-constraint proposal (S01)")
    status, report = run(write_workbook(tmp_path, sheets), content)
    assert status == 0, report
    assert load(content, "scorecard.json")["codebook"][-1]["definition"] == (
        "Other (specify): used for the representational-constraint proposal (S01)"
    )
    assert "Codebook Scenario: BCI-X \"Definition\": now reads 'Other (specify): used" in report


def test_a_fix_can_change_a_codebook_code_cell(tmp_path: Path, content: Path):
    # A Codebook row's id is its type and its code as the sheet writes it, set
    # before the code cell is read, so a listed fix reaches the code cell too.
    sheets = workbook_sheets()
    sheet_code = (
        "Conflicting evidence / Indirect evidence only / Proposal underspecified / Outcome not operationalized / "
        "No relevant evidence found (search documented)"
    )
    row = len(sheets[iw.CODEBOOK].rows) + 1
    for column, value in zip("ABCD", ["Unclear reason", sheet_code, "All", "Literature unresolved"]):
        set_cell(sheets, iw.CODEBOOK, f"{column}{row}", value)
    status, report = run(write_workbook(tmp_path, sheets), content)
    assert status == 0, report
    assert load(content, "scorecard.json")["codebook"][-1]["code"] == sheet_code.replace(
        "operationalized", "operationalised"
    )
    fixes = report.split("Glitch fixes applied")[1].split("Glitch fixes no longer needed")[0]
    assert f"Codebook!B{row} (Unclear reason: {sheet_code}, Code / value)" in fixes


@pytest.mark.parametrize(
    ("tab", "ref", "value", "message"),
    [
        (iw.REGISTER, "P2", "Supportive", '0 Evidence Register!P2 (Evidence role): "Supportive" is not a value the import knows'),
        (iw.REGISTER, "G2", "BCI Alignment (helps)", 'G2 (Ratings it feeds (direction)): "BCI Alignment (helps)" is not'),
        (iw.REGISTER, "G5", "WBE M1 Technical capabilities (supports)", "doesn't match the 1a Milestones heading"),
        (iw.REGISTER, "K2", "BCI-Q", 'is not a scenario code in the Codebook'),
        (iw.MILESTONES, "E3", "Done", '1a Milestones!E3 (Status): "Done"'),
        (iw.MILESTONES, "F3", "Maybe", "is not Yes, Partly, No or Unclear"),
        (iw.WELFARE, "D2", "Extreme", '"Extreme" is not a value the import knows'),
        (iw.WELFARE, "M2", "Partial", "has no agreed place on the site's rating scale"),
        (iw.WELFARE, "G3", "High", '"Not applicable" has to be in both or neither'),
        (iw.RISKS, "C2", "WBE; Robots", '"Robots" is not one of'),
        (iw.THEORY, "G3", "E001 and E027", "expected only ids like E001"),
        (iw.THEORY, "G3", "E999", "cites E999, which is not in 0 Evidence Register"),
        (iw.SCOPE, "G5", "Alignment: oversight. Both", 'should end with "→ Both"'),
        (iw.SCOPE, "F5", "Alignment: conventional methods (S45).", "cites S45, which is not in 3 Sources"),
        (iw.REGISTER, "D2", "A claim " + EN_DASH + " with an en dash.", "contains a long dash (U+2013)"),
        (iw.REGISTER, "H2", "Source not found", "a lookup formula in the sheet failed"),
        (iw.SOURCES, "G4", Num("45231"), 'is not a year between 1800 and 2100'),
    ],
)
def test_unknown_or_unsafe_values_stop_the_import(tmp_path: Path, content: Path, tab: str, ref: str, value: object, message: str):
    before = snapshot(content)
    sheets = workbook_sheets()
    set_cell(sheets, tab, ref, value)
    status, report = run(write_workbook(tmp_path, sheets), content)
    assert status == 1
    assert report.startswith("FAILED: ")
    assert message in report
    assert snapshot(content) == before


def test_missing_or_unexpected_headers_stop_the_import(tmp_path: Path, content: Path):
    sheets = workbook_sheets()
    set_cell(sheets, iw.RISKS, "G1", "Severity")
    status, report = run(write_workbook(tmp_path, sheets), content)
    assert status == 1
    assert "7 Overall Risks: no row has all the expected headers" in report
    assert "missing 'Potential severity'" in report and "has 'Severity' instead" in report

    sheets = workbook_sheets()
    set_cell(sheets, iw.GOVERNANCE, "G1", "Owner")
    status, report = run(write_workbook(tmp_path, sheets), content)
    assert status == 1
    assert "8 Governance Checklist: header row 1 has columns the import doesn't know: 'Owner'" in report

    sheets = workbook_sheets()
    del sheets[iw.AGENCY]
    status, report = run(write_workbook(tmp_path, sheets), content)
    assert status == 1 and 'no tab named "6 Agency and Ownership"' in report


def test_version_comes_from_the_flag_or_the_file_name(tmp_path: Path, content: Path):
    workbook = write_workbook(tmp_path, name="Neuroengineering scorecard v0.5 (1).xlsx")
    status, report = run(workbook, content, version_flag=None)
    assert status == 0, report
    assert load(content, "scorecard.json")["workbook"]["version"] == "0.5"
    assert "Workbook version 0.5 (from the file name)" in report

    unnamed = write_workbook(tmp_path, name="scorecard.xlsx")
    status, report = run(unnamed, content, version_flag=None)
    assert status == 1 and "no workbook version: pass --version" in report
    status, report = run(unnamed, content, version_flag="v4")
    assert status == 1 and 'should look like 0.4' in report


def test_the_command_line_runs_the_import(tmp_path: Path, content: Path, capsys):
    workbook = write_workbook(tmp_path)
    status = iw.main([str(workbook), "--version", "0.4", "--content", str(content), "--dry-run", "--skip-validate"])
    assert status == 0
    assert "Dry run: nothing written." in capsys.readouterr().out
    assert not (content / "scorecard.json").exists()


def test_no_long_dashes_in_the_import_code_or_tests():
    for path in (Path(iw.__file__), Path(__file__), Path(iw.__file__).with_name("xlsx.py")):
        text = path.read_text(encoding="utf-8")
        assert EM_DASH not in text and EN_DASH not in text, path

