// The hero box's lines ("Where we land"), built from the scorecard rows.
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/technology/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { CaseRating, Confidence, ScorecardRow, TechnologyPage } from "@/lib/types";

import { countNoun, isNotApplicable, rowMetaParts, sharedConfidence } from "../text";

function caseRow(id: string, rating: CaseRating, confidence: Confidence = "low"): ScorecardRow {
  return { id, dimension: id, problem: null, scale: "case", rating, confidence, basis: null };
}

function riskRow(id: string, overrides: Partial<ScorecardRow> = {}): ScorecardRow {
  return {
    id,
    dimension: id,
    problem: null,
    scale: "risk",
    rating: null,
    confidence: "low",
    severity: "high",
    likelihood: "not_assessable",
    applicable: true,
    basis: null,
    ...overrides,
  };
}

describe("sharedConfidence", () => {
  test("is said once when every row shares it", () => {
    const rows = [caseRow("a", "weak"), riskRow("r1"), riskRow("r2"), caseRow("b", "weak"), riskRow("r3"), caseRow("c", "unclear")];
    assert.equal(sharedConfidence(rows), "Low confidence in all six.");
    assert.equal(sharedConfidence([caseRow("a", "weak"), caseRow("b", "weak")]), "Low confidence in both.");
  });

  test("leaves a Not applicable row out and says so", () => {
    const rows = [
      caseRow("a", "unclear"),
      caseRow("b", "unclear"),
      riskRow("r1"),
      riskRow("r2", { confidence: "medium", severity: null, likelihood: null, applicable: false }),
      riskRow("r3"),
      caseRow("c", "unclear"),
    ];
    assert.equal(sharedConfidence(rows), "Low confidence in all five that apply.");
  });

  test("is null when the rows differ or too few count", () => {
    assert.equal(sharedConfidence([caseRow("a", "weak", "low"), caseRow("b", "weak", "medium")]), null);
    assert.equal(sharedConfidence([caseRow("a", "weak")]), null);
  });
});

// The parts joined the way MetaParts shows them, or null for no line.
function rowMeta(...args: Parameters<typeof rowMetaParts>): string | null {
  const parts = rowMetaParts(...args);
  return parts.length > 0 ? parts.join(" · ") : null;
}

describe("rowMetaParts", () => {
  test("gives a risk row its severity and likelihood, never a rating", () => {
    assert.equal(rowMeta(riskRow("r", { severity: "very_high" }), true), "Severity very high · Likelihood not assessable");
    assert.deepEqual(rowMetaParts(riskRow("r", { severity: "medium", likelihood: "low" }), false), [
      "Severity medium",
      "Likelihood low",
      "Low confidence",
    ]);
  });

  test("says Not applicable, and nothing else, for a row the workbook marks so", () => {
    const row = riskRow("r", { confidence: "medium", severity: null, likelihood: null, applicable: false });
    assert.equal(isNotApplicable(row), true);
    assert.equal(rowMeta(row, true), "Not applicable");
    assert.equal(rowMeta(row, false), "Not applicable");
  });

  test("gives a case row only its confidence, and only when not shared", () => {
    assert.equal(rowMeta(caseRow("a", "weak"), true), null);
    assert.equal(rowMeta(caseRow("a", "weak", "medium"), false), "Medium confidence");
  });
});

test("countNoun", () => {
  assert.equal(countNoun(1, "link", "links"), "1 link");
  assert.equal(countNoun(7, "link", "links"), "7 links");
});

describe("the real pages", () => {
  const pages = JSON.parse(
    readFileSync(new URL("../../../../content/technologies.json", import.meta.url), "utf8"),
  ) as TechnologyPage[];
  const byId: Record<string, TechnologyPage> = {};
  for (const page of pages) {
    byId[page.id] = page;
  }

  test("BCI's artificial-mind row stays out of the shared confidence", () => {
    assert.equal(sharedConfidence(byId.wbe.scorecard), "Low confidence in all six.");
    assert.equal(sharedConfidence(byId.bci.scorecard), "Low confidence in all five that apply.");
  });
});
