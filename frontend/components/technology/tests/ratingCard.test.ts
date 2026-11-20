// The parts of a rating card worked out at build time.
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/technology/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { buildTimeline, type TimelineItem } from "@/components/timeline/timelineModel";
import type {
  Claim,
  CodebookRow,
  EvidenceEntry,
  Milestone,
  RatingChange,
  Risk,
  ScorecardData,
  ScorecardRow,
  TechnologyPage,
} from "@/lib/types";

import {
  cardKind,
  changeValues,
  confidenceDefinition,
  familyForTechnology,
  feedTargetFor,
  gradingMeanings,
  hasTrackerContent,
  isNotAssessed,
  linkedMilestones,
  newestFirst,
  notYetAssessed,
  ratingDefinition,
  riskCount,
  riskDomainFor,
  riskLinkText,
  rowEvidence,
  scaleLabel,
} from "../ratingCardModel";

const NOT_ASSESSED: Claim = { text: "We haven't looked yet.", provenance: "unclear", unclear_reason: "search_incomplete" };
const TEAM_CLAIM: Claim = { text: "Direct evidence would change it.", provenance: "team" };

function row(overrides: Partial<ScorecardRow> = {}): ScorecardRow {
  return {
    id: "alignment-case",
    dimension: "Alignment case",
    problem: "alignment",
    scale: "case",
    rating: "unclear",
    confidence: "low",
    unclear_reason: null,
    basis: TEAM_CLAIM,
    ...overrides,
  };
}

function riskRow(overrides: Partial<ScorecardRow> = {}): ScorecardRow {
  return row({
    id: "governance-risk",
    dimension: "Governance risk",
    problem: null,
    scale: "risk",
    rating: null,
    severity: "high",
    likelihood: "not_assessable",
    applicable: true,
    basis: null,
    ...overrides,
  });
}

function milestone(id: string): Milestone {
  return {
    id,
    name: id,
    technology: "wbe",
    stage: "possible",
    category: "technical_capability",
    status: "not_demonstrated",
    status_basis: NOT_ASSESSED,
    achieved_in: null,
    achieved_in_basis: null,
    confidence: null,
    summary: NOT_ASSESSED,
    success_criterion: NOT_ASSESSED,
    main_bottleneck: NOT_ASSESSED,
    depends_on: [],
    source_ids: [],
    estimate: null,
    forecasts: [],
    disagreement_override: null,
    disagreement_note: null,
    would_move_earlier: [],
    would_move_later: [],
    artificial_minds_questions: [],
  };
}

// Three WBE timeline items, built the way the technology page builds them.
function items(): TimelineItem[] {
  return buildTimeline([milestone("wbe-scan"), milestone("wbe-legal"), milestone("wbe-cost")], 2026)[0].items;
}

function change(overrides: Partial<RatingChange> = {}): RatingChange {
  return {
    date: "2026-12-01",
    rating_before: "unclear",
    rating_after: "unclear",
    confidence_before: "low",
    confidence_after: "low",
    note: { text: "A new source.", provenance: "team", source_ids: ["s21"] },
    ...overrides,
  };
}

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
    scenarios: [],
    stage: "S1",
    directness: "direct",
    role: "supports",
    basis: "argued",
    ...overrides,
  };
}

function risk(id: string, overrides: Partial<Risk> = {}): Risk {
  return {
    id,
    risk: `Risk ${id}`,
    families: ["bci"],
    domain: "governance",
    category: "Fixture",
    exposed: "Everyone",
    severity: "high",
    likelihood: "not_assessable",
    reversibility: "low",
    detectability: "low",
    remedies: "None identified",
    control: "Operator",
    confidence: "low",
    entries: [],
    ...overrides,
  };
}

// The Codebook's Rating and Confidence rows as the workbook words them.
const CODEBOOK: CodebookRow[] = [
  { type: "Rating", code: "Weak", family: "All", definition: "Poorly targeted, demanding unsupported assumptions, or substantial contrary evidence" },
  { type: "Rating", code: "Not claimed", family: "All", definition: "Outcome not claimed; distinct from Weak/Unclear" },
  {
    type: "Confidence",
    code: "High / Medium / Low",
    family: "All",
    definition:
      "High: multiple robust sources, contrary evidence considered. Medium: some support, meaningful limits. Low: indirect, early-stage or contested basis.",
  },
];

function scorecard(overrides: Partial<ScorecardData> = {}): ScorecardData {
  return {
    generated: "Fixture",
    workbook: { title: "Fixture workbook", version: "0.4" },
    codebook: CODEBOOK,
    entries: [],
    risks: [],
    ...overrides,
  };
}

describe("cardKind", () => {
  test("tells case, safeguard and risk rows apart", () => {
    assert.equal(cardKind(row()), "case");
    assert.equal(cardKind(row({ id: "intelligence-curse-case", problem: "intelligence_curse" })), "case");
    assert.equal(cardKind(row({ id: "safeguard-adequacy", problem: null })), "safeguard");
    assert.equal(cardKind(riskRow()), "risk");
  });
});

describe("scaleLabel", () => {
  test("names the problem a case row is about", () => {
    assert.equal(scaleLabel(row()), "Case · Alignment");
    assert.equal(scaleLabel(row({ problem: "intelligence_curse" })), "Case · Intelligence Curse");
  });

  test("a row without a problem shows only its scale", () => {
    assert.equal(scaleLabel(riskRow()), "Risk");
  });
});

describe("ratingDefinition", () => {
  test("is the Codebook's Rating row for the rating's label, word for word", () => {
    assert.equal(
      ratingDefinition(CODEBOOK, "weak"),
      "Poorly targeted, demanding unsupported assumptions, or substantial contrary evidence",
    );
    assert.equal(ratingDefinition(CODEBOOK, "not_claimed"), "Outcome not claimed; distinct from Weak/Unclear");
  });

  test("is empty when the Codebook has no row for it", () => {
    assert.equal(ratingDefinition(CODEBOOK, "strong"), "");
    assert.equal(ratingDefinition([], "weak"), "");
  });
});

describe("confidenceDefinition", () => {
  test("cuts the one Codebook cell at its own labels, each part starting with a capital", () => {
    assert.equal(confidenceDefinition(CODEBOOK, "high"), "Multiple robust sources, contrary evidence considered.");
    assert.equal(confidenceDefinition(CODEBOOK, "medium"), "Some support, meaningful limits.");
    assert.equal(confidenceDefinition(CODEBOOK, "low"), "Indirect, early-stage or contested basis.");
  });

  test("is empty without the cell or the label", () => {
    assert.equal(confidenceDefinition([], "low"), "");
    const noLow: CodebookRow[] = [{ type: "Confidence", code: "High", family: "All", definition: "High: solid." }];
    assert.equal(confidenceDefinition(noLow, "low"), "");
    assert.equal(confidenceDefinition(noLow, "high"), "Solid.");
  });

  test("a label word inside the text doesn't start a new part", () => {
    const tricky: CodebookRow[] = [
      { type: "Confidence", code: "x", family: "All", definition: "High: not Low in any way. Low: thin." },
    ];
    assert.equal(confidenceDefinition(tricky, "high"), "Not Low in any way.");
    assert.equal(confidenceDefinition(tricky, "low"), "Thin.");
  });
});

describe("gradingMeanings", () => {
  test("lists every rating and confidence in the scale's order, each with its Codebook meaning or none", () => {
    const meanings = gradingMeanings(CODEBOOK);
    assert.deepEqual(meanings.ratings, [
      { value: "strong", definition: "" },
      { value: "moderate", definition: "" },
      { value: "weak", definition: "Poorly targeted, demanding unsupported assumptions, or substantial contrary evidence" },
      { value: "unclear", definition: "" },
      { value: "not_claimed", definition: "Outcome not claimed; distinct from Weak/Unclear" },
    ]);
    assert.deepEqual(meanings.confidences, [
      { value: "high", definition: "Multiple robust sources, contrary evidence considered." },
      { value: "medium", definition: "Some support, meaningful limits." },
      { value: "low", definition: "Indirect, early-stage or contested basis." },
    ]);
  });
});

describe("rowEvidence", () => {
  const entries = [
    entry("E001", { feeds: [{ family: "bci", target: "alignment", direction: "against_or_qualifies" }] }),
    entry("E002", { feeds: [{ family: "bci", target: "alignment", direction: "supports" }] }),
    entry("E003", { feeds: [{ family: "wbe", target: "alignment", direction: "supports" }] }),
    entry("E004", {
      feeds: [
        { family: "bci", target: "intelligence_curse", direction: "supports", note: "efficiency prerequisite only" },
        { family: "bci", target: "M6", direction: "supports" },
      ],
    }),
    entry("E005", { feeds: [{ family: "bci", target: "alignment", direction: "supports" }] }),
  ];

  test("groups the family's entries for the row's rating, supports first, in register order", () => {
    const evidence = rowEvidence(scorecard({ entries }), "bci", row());
    assert.ok(evidence);
    assert.deepEqual(
      evidence.groups.map((group) => [group.heading, group.count, group.entries.map((item) => item.id)]),
      [
        ["Supports", "Supports: 2", ["E002", "E005"]],
        ["Against or qualifies", "Against or qualifies: 1", ["E001"]],
      ],
    );
    assert.equal(evidence.total, 3);
    assert.equal(evidence.href, "/evidence/?feeds=bci-alignment");
  });

  test("a feed's note heads its group with column G's words", () => {
    const evidence = rowEvidence(scorecard({ entries }), "bci", row({ id: "intelligence-curse-case", problem: "intelligence_curse" }));
    assert.ok(evidence);
    assert.deepEqual(
      evidence.groups.map((group) => [group.heading, group.count]),
      [["Supports, efficiency prerequisite only", "Supports, efficiency prerequisite only: 1"]],
    );
    assert.equal(evidence.href, "/evidence/?feeds=bci-intelligence-curse");
  });

  test("rows nothing can feed, or nothing does, have none", () => {
    assert.equal(rowEvidence(scorecard({ entries }), "bci", row({ id: "safeguard-adequacy", problem: null })), null);
    assert.equal(rowEvidence(scorecard({ entries }), "bci", riskRow()), null);
    assert.equal(rowEvidence(scorecard({ entries }), "neuromorphic", row()), null);
  });
});

describe("feedTargetFor and riskDomainFor", () => {
  test("map the row ids the workbook module names", () => {
    assert.equal(feedTargetFor(row()), "alignment");
    assert.equal(feedTargetFor(row({ id: "intelligence-curse-case" })), "intelligence_curse");
    assert.equal(feedTargetFor(row({ id: "safeguard-adequacy" })), null);
    assert.equal(riskDomainFor(riskRow({ id: "human-welfare-risk" })), "human_welfare");
    assert.equal(riskDomainFor(riskRow({ id: "artificial-mind-welfare-and-rights-risk" })), "artificial_mind_welfare");
    assert.equal(riskDomainFor(riskRow()), "governance");
    assert.equal(riskDomainFor(row()), null);
  });
});

describe("riskCount and riskLinkText", () => {
  const risks = [
    risk("R01"),
    risk("R02", { domain: "human_welfare" }),
    risk("R03", { families: ["wbe", "neuromorphic", "bci"] }),
    risk("R04", { families: ["wbe"] }),
  ];

  test("counts the family's risks in the row's domain, a risk on several pages included", () => {
    assert.equal(riskCount(scorecard({ risks }), "bci", riskRow()), 2);
    assert.equal(riskCount(scorecard({ risks }), "bci", riskRow({ id: "human-welfare-risk" })), 1);
    assert.equal(riskCount(scorecard({ risks }), "bci", riskRow({ id: "artificial-mind-welfare-and-rights-risk" })), 0);
    assert.equal(riskCount(scorecard({ risks }), "bci", row()), 0);
  });

  test("names the domain, with the count for several and without it for one", () => {
    assert.equal(riskLinkText(2, riskRow()), "See the 2 governance risks");
    assert.equal(riskLinkText(6, riskRow({ id: "human-welfare-risk" })), "See the 6 human welfare risks");
    assert.equal(
      riskLinkText(1, riskRow({ id: "artificial-mind-welfare-and-rights-risk" })),
      "See the artificial-mind welfare risk",
    );
  });
});

describe("familyForTechnology", () => {
  test("finds the page by its name", () => {
    const pages = [
      { id: "wbe", name: "Whole brain emulation" },
      { id: "neuromorphic", name: "Neuromorphic AI" },
    ];
    assert.equal(familyForTechnology(pages, "Neuromorphic AI"), "neuromorphic");
    assert.equal(familyForTechnology(pages, "Something else"), null);
  });
});

describe("linkedMilestones", () => {
  test("follows the team's order and leaves out unknown ids", () => {
    const linked = row({ tracker: { milestone_ids: ["wbe-cost", "wbe-missing", "wbe-scan"] } });
    const ids = linkedMilestones(linked, items()).map((item) => item.milestone.id);
    assert.deepEqual(ids, ["wbe-cost", "wbe-scan"]);
  });

  test("a row without a tracker informs nothing", () => {
    assert.deepEqual(linkedMilestones(row(), items()), []);
  });
});

describe("isNotAssessed", () => {
  test("is the unclear claim for an unfinished search, or no claim", () => {
    assert.equal(isNotAssessed(NOT_ASSESSED), true);
    assert.equal(isNotAssessed(null), true);
    assert.equal(isNotAssessed(undefined), true);
  });

  test("any other claim counts as written", () => {
    assert.equal(isNotAssessed(TEAM_CLAIM), false);
    assert.equal(isNotAssessed({ ...NOT_ASSESSED, unclear_reason: "conflicting_evidence" }), false);
  });
});

describe("hasTrackerContent", () => {
  test("a row with no tracker, or an empty one, has none", () => {
    assert.equal(hasTrackerContent(row(), []), false);
    assert.equal(hasTrackerContent(row({ tracker: {} }), []), false);
    assert.equal(hasTrackerContent(row({ tracker: { what_would_change: NOT_ASSESSED, history: [] } }), []), false);
  });

  test("any field the team filled counts, and so does the placeholder box", () => {
    assert.equal(hasTrackerContent(row({ tracker: { placeholder: true } }), []), true);
    assert.equal(hasTrackerContent(row({ tracker: { what_would_change: TEAM_CLAIM } }), []), true);
    assert.equal(hasTrackerContent(row({ tracker: { last_updated: "2026-11-16" } }), []), true);
    assert.equal(hasTrackerContent(row({ tracker: { history: [change()] } }), []), true);
    assert.equal(hasTrackerContent(row({ tracker: { milestone_ids: ["wbe-scan"] } }), items().slice(0, 1)), true);
  });
});

describe("notYetAssessed", () => {
  test("names both tracker parts for an empty row, and never the evidence", () => {
    assert.deepEqual(notYetAssessed(row(), []), ["what would change the assessment", "the milestones it informs"]);
  });

  test("names nothing for a full row", () => {
    const full = row({ tracker: { what_would_change: TEAM_CLAIM, milestone_ids: ["wbe-scan"] } });
    assert.deepEqual(notYetAssessed(full, linkedMilestones(full, items())), []);
  });

  test("treats the not-assessed claim as missing", () => {
    const pending = row({ tracker: { what_would_change: NOT_ASSESSED } });
    assert.deepEqual(notYetAssessed(pending, items().slice(0, 1)), ["what would change the assessment"]);
  });
});

describe("newestFirst", () => {
  test("reverses a copy and leaves the content alone", () => {
    const history = [change({ date: "2026-11-01" }), change({ date: "2026-12-01" })];
    const reversed = newestFirst(history);
    assert.deepEqual(
      reversed.map((item) => item.date),
      ["2026-12-01", "2026-11-01"],
    );
    assert.deepEqual(
      history.map((item) => item.date),
      ["2026-11-01", "2026-12-01"],
    );
  });
});

describe("changeValues", () => {
  test("uses the case labels and marks what stayed the same", () => {
    const values = changeValues(change({ rating_after: "weak", confidence_after: "low" }));
    assert.deepEqual(values, [
      { label: "Rating", before: "Unclear", after: "Weak", changed: true },
      { label: "Confidence", before: "Low", after: "Low", changed: false },
    ]);
  });

  test("an entry where nothing changed", () => {
    const values = changeValues(change());
    assert.equal(values[0].changed, false);
    assert.equal(values[1].changed, false);
  });
});

// The real content, so a new workbook import that renames a rating or
// rewords the Confidence cell's labels shows up here, not as a grading key
// that silently loses its meanings.
describe("the imported workbook", () => {
  const content = new URL("../../../../content/", import.meta.url);
  const real = JSON.parse(readFileSync(new URL("scorecard.json", content), "utf8")) as ScorecardData;
  const pages = JSON.parse(readFileSync(new URL("technologies.json", content), "utf8")) as TechnologyPage[];

  test("the grading key has a Codebook meaning for every rating and confidence", () => {
    const meanings = gradingMeanings(real.codebook ?? []);
    for (const item of [...meanings.ratings, ...meanings.confidences]) {
      assert.notEqual(item.definition, "", item.value);
    }
    assert.equal(
      meanings.ratings.find((item) => item.value === "weak")?.definition,
      "Poorly targeted, demanding unsupported assumptions, or substantial contrary evidence",
    );
  });

  test("every case card on every page has evidence, and every entry it shows feeds that rating", () => {
    for (const page of pages) {
      const family = familyForTechnology(pages, page.name);
      assert.ok(family, page.id);
      for (const item of page.scorecard) {
        if (cardKind(item) !== "case") {
          continue;
        }
        const evidence = rowEvidence(real, family, item);
        assert.ok(evidence, `${page.id} ${item.id}`);
        const target = feedTargetFor(item);
        for (const group of evidence.groups) {
          for (const shown of group.entries) {
            const feeds = (shown.feeds ?? []).filter((feed) => feed.family === family && feed.target === target);
            assert.ok(feeds.length > 0, `${shown.id} on ${page.id} ${item.id}`);
          }
        }
      }
    }
  });
});
