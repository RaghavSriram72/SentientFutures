// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "lib/tests/*.test.ts"
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CausalLink, EvidenceEntry, GovernanceItem, MilestoneAssessment, Risk, ScorecardData } from "@/lib/types";
import {
  codebookByType,
  codebookRow,
  entriesFeeding,
  entriesForFamily,
  entriesForSource,
  entriesWithIds,
  entryCountsBySource,
  familyCounts,
  feedGroups,
  feedKey,
  feedKeys,
  governanceByStatus,
  governanceStatusCounts,
  linksByScenario,
  milestoneCategoryInfo,
  milestoneCategoryLabel,
  milestoneRowsForCategory,
  milestoneRowsForFamily,
  outcomeLabels,
  risksByDomain,
  risksForFamily,
  stepLabel,
} from "@/lib/workbook";

function entry(id: string, overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id,
    source_id: "s01",
    register_id: "S01",
    locator: "Fixture locator",
    claim: `Claim ${id}.`,
    codes: [],
    family: "bci",
    feeds: [],
    feeds_text: "Not used in a headline rating",
    source_type_independence: "Presentation; Unknown",
    outcome: "AI Alignment",
    alignment_problem: "A-VS",
    scenarios: ["BCI-D"],
    stage: "S1",
    directness: "direct",
    role: "supports",
    basis: "argued",
    ...overrides,
  };
}

function link(id: string, scenario: string, overrides: Partial<CausalLink> = {}): CausalLink {
  const code = id.replace(/-L\d+$/, "");
  return {
    id,
    family: "wbe",
    scenario_code: code,
    scenario,
    step: "1 Capability",
    outcome: "AI Alignment",
    claim: `Claim ${id}.`,
    status: "search_incomplete",
    supporting: [],
    contrary: [],
    qualifying: [],
    best_directness: null,
    assumption: null,
    objection: null,
    ...overrides,
  };
}

function risk(id: string, families: Risk["families"], domain: Risk["domain"]): Risk {
  return {
    id,
    risk: `Risk ${id}`,
    families,
    domain,
    category: "Fixture",
    exposed: "Everyone (population-wide)",
    severity: "high",
    likelihood: "not_assessable",
    reversibility: "low",
    detectability: "low",
    remedies: "None identified",
    control: "Operator",
    confidence: "low",
    entries: [],
  };
}

function item(id: string, family: GovernanceItem["family"], status: GovernanceItem["status"]): GovernanceItem {
  return { id, family, question: `Question ${id}`, status, entries: [], summary: null };
}

function row(family: MilestoneAssessment["family"], milestone: string, appliesTo: string): MilestoneAssessment {
  return {
    family,
    milestone,
    category: milestone === "M1" ? "technical_capability" : "economic_viability",
    applies_to: appliesTo,
    success_criterion: "Fixture criterion.",
    status: "unclear",
    criterion_met: "Unclear (search incomplete)",
    evidence: "None",
    evidence_entries: [],
    bottleneck: null,
    timing: "Not sourced",
    confidence: "low",
    note: null,
  };
}

const SCORECARD: ScorecardData = {
  generated: "Fixture.",
  workbook: { title: "Fixture", version: "0.4" },
  codebook: [
    { type: "Scenario", code: "WBE-O", family: "WBE", definition: "AI overseer" },
    { type: "Stage", code: "S1", family: "WBE", definition: "Neural component simulation" },
    { type: "Stage", code: "S1", family: "BCI", definition: "Read-only / passive decoding" },
    { type: "Alignment problem", code: "A-VS", family: "All", definition: "Value specification" },
    { type: "Scenario", code: "*-X / *-C / *-U", family: "All", definition: "Other (specify) / cross-cutting / unspecified" },
    { type: "Scenario", code: "BCI-X", family: "BCI", definition: "Other (specify), used for the proposal (S01)" },
  ],
  milestone_categories: [
    { id: "M1", category: "technical_capability", label: "Technical capability", question: "Can it be built?" },
    { id: "M6", category: "economic_viability", label: "Economic viability", question: "Is it affordable?" },
  ],
  milestone_assessments: [
    row("wbe", "M1", "All WBE uses"),
    row("bci", "M1", "Neural feedback for alignment"),
    row("bci", "M1", "Oversight and enhancement"),
    row("bci", "M6", "Neural feedback; oversight"),
  ],
  entries: [
    entry("E001", { feeds_text: "Not used in a headline rating" }),
    entry("E002", { feeds: [{ family: "bci", target: "alignment", direction: "supports", note: null }] }),
    entry("E014", {
      family: "neuromorphic",
      source_id: "s05",
      feeds: [
        { family: "neuromorphic", target: "intelligence_curse", direction: "supports", note: "efficiency prerequisite only" },
        { family: "neuromorphic", target: "M6", direction: "supports", note: null },
      ],
    }),
    entry("E042", {
      family: "cross_family",
      source_id: "s13",
      feeds: [{ family: "neuromorphic", target: "alignment", direction: "supports", note: null }],
    }),
    entry("E055", {
      role: "contrary",
      feeds: [
        { family: "bci", target: "alignment", direction: "against_or_qualifies", note: null },
        { family: "bci", target: "intelligence_curse", direction: "against_or_qualifies", note: null },
      ],
    }),
    entry("E081", { feeds: [{ family: "bci", target: "intelligence_curse", direction: "against_or_qualifies", note: null }] }),
    entry("E099", { feeds: [{ family: "bci", target: "alignment", direction: "supports", note: null }] }),
  ],
  links: [
    link("WBE-O-L1", "WBE as AI overseer", { status: "contrary" }),
    link("WBE-O-L6", "WBE as AI overseer", { step: "Condition (timing, spillover, security)", status: "contrary" }),
    link("WBE-O-L7", "WBE as AI overseer", { step: "2 Deployment" }),
    link("WBE-L-L1", "WBE as digital labour", { outcome: "Intelligence Curse" }),
    link("WBE-L-L2", "WBE as digital labour", { outcome: "Both", status: "supporting" }),
    link("BCI-D-L1", "BCI neural feedback for alignment", { family: "bci" }),
  ],
  risks: [
    risk("R01", ["wbe"], "artificial_mind_welfare"),
    risk("R03", ["wbe"], "human_welfare"),
    risk("R05", ["wbe", "neuromorphic", "bci"], "governance"),
    risk("R07", ["bci"], "human_welfare"),
  ],
  governance: [
    item("G13", "bci", "not_addressed"),
    item("G14", "bci", "proposal_found"),
    item("G17", "bci", "not_addressed"),
    item("G19", "bci", "evidence_found"),
    item("G01", "wbe", "not_addressed"),
  ],
};

describe("evidence entries", () => {
  test("an entry belongs to its family and to any family it feeds", () => {
    const ids = (entries: EvidenceEntry[]) => entries.map((item) => item.id);
    assert.deepEqual(ids(entriesForFamily(SCORECARD, "neuromorphic")), ["E014", "E042"]);
    assert.deepEqual(ids(entriesForFamily(SCORECARD, "cross_family")), ["E042"]);
    assert.deepEqual(ids(entriesForFamily(SCORECARD, "wbe")), []);
  });

  test("the entries feeding a rating, in register order", () => {
    assert.deepEqual(
      entriesFeeding(SCORECARD, "bci", "alignment").map((item) => item.id),
      ["E002", "E055", "E099"],
    );
  });

  test("feed groups: supports first, a noted feed apart, the register's order inside", () => {
    const groups = feedGroups(SCORECARD, "bci", "alignment");
    assert.deepEqual(
      groups.map((group) => [group.direction, group.note, group.entries.map((item) => item.id)]),
      [
        ["supports", null, ["E002", "E099"]],
        ["against_or_qualifies", null, ["E055"]],
      ],
    );
    const noted = feedGroups(SCORECARD, "neuromorphic", "intelligence_curse");
    assert.deepEqual(
      noted.map((group) => [group.direction, group.note, group.entries.map((item) => item.id)]),
      [["supports", "efficiency prerequisite only", ["E014"]]],
    );
    assert.deepEqual(feedGroups(SCORECARD, "wbe", "alignment"), []);
  });

  test("feed keys for the evidence filters", () => {
    assert.equal(feedKey("bci", "intelligence_curse"), "bci-intelligence-curse");
    assert.equal(feedKey("neuromorphic", "M6"), "neuromorphic-m6");
    assert.deepEqual(feedKeys(SCORECARD.entries![2]), ["neuromorphic-intelligence-curse", "neuromorphic-m6"]);
    assert.deepEqual(feedKeys(SCORECARD.entries![0]), []);
  });

  test("entries by source, and their counts", () => {
    assert.deepEqual(
      entriesForSource(SCORECARD, "s05").map((item) => item.id),
      ["E014"],
    );
    assert.deepEqual(entryCountsBySource(SCORECARD), { s01: 5, s05: 1, s13: 1 });
  });

  test("entries by id keep the order given and skip unknown ids", () => {
    assert.deepEqual(
      entriesWithIds(SCORECARD, ["E099", "E404", "E001"]).map((item) => item.id),
      ["E099", "E001"],
    );
  });
});

describe("causal links", () => {
  test("grouped by scenario name in sheet order, never renumbered", () => {
    const pathways = linksByScenario(SCORECARD, "wbe");
    assert.deepEqual(
      pathways.map((pathway) => [pathway.scenario, pathway.scenarioCode, pathway.outcomes, pathway.links.map((item) => item.id)]),
      [
        ["WBE as AI overseer", "WBE-O", ["AI Alignment"], ["WBE-O-L1", "WBE-O-L6", "WBE-O-L7"]],
        ["WBE as digital labour", "WBE-L", ["Intelligence Curse", "Both"], ["WBE-L-L1", "WBE-L-L2"]],
      ],
    );
    // The step cells stay as written: "Condition" before "2 Deployment".
    assert.deepEqual(
      pathways[0].links.map((item) => item.step),
      ["1 Capability", "Condition (timing, spillover, security)", "2 Deployment"],
    );
    assert.deepEqual(pathways[0].statusCounts, { contrary: 2, search_incomplete: 1 });
  });
});

describe("risks and the governance checklist", () => {
  test("a risk sits on every family its Family cell names", () => {
    assert.deepEqual(risksForFamily(SCORECARD, "bci").map((item) => item.id), ["R05", "R07"]);
    assert.deepEqual(risksForFamily(SCORECARD, "neuromorphic", "governance").map((item) => item.id), ["R05"]);
  });

  test("one group per domain in the workbook's order, empty ones included", () => {
    assert.deepEqual(
      risksByDomain(SCORECARD, "wbe").map((group) => [group.domain, group.risks.map((item) => item.id)]),
      [
        ["human_welfare", ["R03"]],
        ["artificial_mind_welfare", ["R01"]],
        ["governance", ["R05"]],
      ],
    );
  });

  test("checklist items grouped by status, sheet order inside", () => {
    assert.deepEqual(
      governanceByStatus(SCORECARD, "bci").map((group) => [group.status, group.items.map((value) => value.id)]),
      [
        ["not_addressed", ["G13", "G17"]],
        ["proposal_found", ["G14"]],
        ["evidence_found", ["G19"]],
      ],
    );
    assert.deepEqual(governanceStatusCounts(SCORECARD, "bci"), { not_addressed: 2, proposal_found: 1, evidence_found: 1 });
    assert.deepEqual(governanceByStatus(SCORECARD, "neuromorphic"), []);
  });
});

describe("milestone rows", () => {
  test("a family's rows in sheet order, split rows numbered", () => {
    assert.deepEqual(
      milestoneRowsForFamily(SCORECARD, "bci").map((value) => [value.assessment.milestone, value.assessment.applies_to, value.part]),
      [
        ["M1", "Neural feedback for alignment", 1],
        ["M1", "Oversight and enhancement", 2],
        ["M6", "Neural feedback; oversight", null],
      ],
    );
    assert.deepEqual(milestoneRowsForFamily(SCORECARD, "wbe").map((value) => value.part), [null]);
  });

  test("rows for one category across families, and the category's header", () => {
    assert.deepEqual(
      milestoneRowsForCategory(SCORECARD, "technical_capability").map((value) => value.family),
      ["wbe", "bci", "bci"],
    );
    assert.equal(milestoneCategoryInfo(SCORECARD, "M6")?.label, "Economic viability");
    assert.equal(milestoneCategoryInfo(SCORECARD, "technical_capability")?.id, "M1");
    assert.equal(milestoneCategoryInfo(SCORECARD, "M9"), undefined);
  });
});

describe("display wording", () => {
  test("an outcome reads in the site's words, and Both names the two outcomes", () => {
    assert.deepEqual(outcomeLabels("AI Alignment"), ["AI alignment"]);
    assert.deepEqual(outcomeLabels("Intelligence Curse"), ["Intelligence Curse"]);
    assert.deepEqual(outcomeLabels("Both"), ["AI alignment", "Intelligence Curse"]);
    assert.deepEqual(outcomeLabels("Neither"), ["Neither"]);
  });

  test("a list of outcomes names each one once, in first-seen order", () => {
    assert.deepEqual(outcomeLabels(["Both", "AI Alignment", "Intelligence Curse"]), ["AI alignment", "Intelligence Curse"]);
    assert.deepEqual(outcomeLabels(["Intelligence Curse", "Both"]), ["Intelligence Curse", "AI alignment"]);
    assert.equal(outcomeLabels(["Both", "AI Alignment"]).join(" · "), "AI alignment · Intelligence Curse");
    assert.deepEqual(outcomeLabels([]), []);
  });

  test("an outcome the table doesn't know shows as it is", () => {
    assert.deepEqual(outcomeLabels("Something new"), ["Something new"]);
    assert.deepEqual(outcomeLabels("constructor"), ["constructor"]);
  });

  test("a step loses its leading number only", () => {
    assert.equal(stepLabel("1 Capability"), "Capability");
    assert.equal(stepLabel("3 Change in capability, incentives or power"), "Change in capability, incentives or power");
    assert.equal(stepLabel("Condition (timing, spillover, security)"), "Condition (timing, spillover, security)");
    assert.equal(stepLabel("4"), "4");
  });

  test("a milestone category shows the site's label where the enums have one", () => {
    assert.equal(
      milestoneCategoryLabel({ id: "M5", category: "scalable_production", label: "Scalable manufacture, compute and data", question: "" }),
      "Scalable manufacture, compute or data",
    );
    assert.equal(
      milestoneCategoryLabel({ id: "M8", category: "institutional_legitimacy", label: "Institutional capacity and legitimacy", question: "" }),
      "Institutional capacity and public legitimacy",
    );
    const unmapped = { id: "M10", category: "not_a_category", label: "A new header", question: "" } as unknown as Parameters<
      typeof milestoneCategoryLabel
    >[0];
    assert.equal(milestoneCategoryLabel(unmapped), "A new header");
  });
});

describe("the Codebook", () => {
  test("a family's own row wins over an All row", () => {
    assert.equal(codebookRow(SCORECARD, "Stage", "S1", "bci")?.definition, "Read-only / passive decoding");
    assert.equal(codebookRow(SCORECARD, "Alignment problem", "A-VS", "bci")?.definition, "Value specification");
  });

  test("a Cross-family entry's stage and undefined codes find nothing", () => {
    assert.equal(codebookRow(SCORECARD, "Stage", "S1", "cross_family"), undefined);
    assert.equal(codebookRow(SCORECARD, "Alignment problem", "A-X", "wbe"), undefined);
    assert.equal(codebookRow(SCORECARD, "Scenario", "BCI-C", "bci"), undefined);
  });

  test("grouped by type without moving or splitting a row", () => {
    const groups = codebookByType(SCORECARD);
    assert.deepEqual(
      groups.map((group) => [group.type, group.rows.map((value) => value.code)]),
      [
        ["Scenario", ["WBE-O", "*-X / *-C / *-U", "BCI-X"]],
        ["Stage", ["S1", "S1"]],
        ["Alignment problem", ["A-VS"]],
      ],
    );
  });
});

describe("counts", () => {
  test("a family's counts", () => {
    assert.deepEqual(familyCounts(SCORECARD, "bci"), {
      entries: 5,
      links: 1,
      linkStatuses: { search_incomplete: 1 },
      risks: 2,
      governance: 4,
      governanceStatuses: { not_addressed: 2, proposal_found: 1, evidence_found: 1 },
      milestoneRows: 3,
    });
  });

  test("an empty placeholder scorecard gives empty lists", () => {
    const empty: ScorecardData = { generated: "Placeholder.", workbook: { title: "Fixture", version: "0.4" } };
    assert.deepEqual(linksByScenario(empty, "wbe"), []);
    assert.deepEqual(risksByDomain(empty, "wbe").map((group) => group.risks), [[], [], []]);
    assert.deepEqual(milestoneRowsForFamily(empty, "bci"), []);
    assert.equal(familyCounts(empty, "wbe").entries, 0);
  });
});
