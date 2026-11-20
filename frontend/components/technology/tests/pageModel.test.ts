// Small helpers for the technology page's workbook sections.
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/technology/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { MilestoneAssessment, ScorecardData } from "@/lib/types";
import { EVIDENCE_STATUSES, milestoneRowsForFamily, type MilestoneRow } from "@/lib/workbook";

import {
  countList,
  familyCell,
  familyStages,
  firstOnly,
  idRange,
  idText,
  milestoneCount,
  registerIdText,
  riskDomainAnchor,
  timelineRefByCategory,
} from "../sections/pageModel";

function row(milestone: string, part: number | null = null): MilestoneRow {
  return { assessment: { milestone } as MilestoneAssessment, part };
}

test("countList keeps the scale's order and leaves out zeros", () => {
  assert.deepEqual(countList({ search_incomplete: 5, contrary: 2, supporting: 0 }, EVIDENCE_STATUSES), [
    { value: "contrary", count: 2 },
    { value: "search_incomplete", count: 5 },
  ]);
});

test("milestoneCount counts a split milestone once", () => {
  assert.equal(milestoneCount([row("M1", 1), row("M1", 2), row("M2")]), 2);
  assert.equal(milestoneCount([]), 0);
});

test("familyCell writes families the way the workbook's cell does, in order", () => {
  assert.equal(familyCell(["wbe", "neuromorphic", "bci"]), "WBE; Neuromorphic AI; BCI");
});

test("registerIdText and idText", () => {
  assert.equal(registerIdText(["s16", "s99", "s22"], { s16: "S16", s22: "S22" }), "S16, S22");
  assert.equal(idText(["E043", "E065"]), "E043, E065");
  assert.equal(idText(undefined), "");
});

test("riskDomainAnchor gives each domain its own id, apart from the risk ids", () => {
  assert.equal(riskDomainAnchor("human_welfare"), "risks-human-welfare");
  assert.equal(riskDomainAnchor("artificial_mind_welfare"), "risks-artificial-mind-welfare");
  assert.equal(riskDomainAnchor("governance"), "risks-governance");
});

test("timelineRefByCategory links a category only when one milestone has it", () => {
  const refs = timelineRefByCategory([
    { id: "a", code: "WBE-01", category: "technical_capability" },
    { id: "b", code: "WBE-02", category: "legal_regulatory" },
    { id: "c", code: "WBE-03", category: "legal_regulatory" },
  ]);
  assert.equal(refs.technical_capability?.code, "WBE-01");
  assert.equal(refs.legal_regulatory, undefined);
});

test("idRange finds the lowest and highest by number", () => {
  assert.deepEqual(idRange(["E010", "E002", "E121"]), ["E002", "E121"]);
  assert.deepEqual(idRange(["S30", "S01", "S17"]), ["S01", "S30"]);
  assert.equal(idRange([]), null);
});

test("firstOnly keeps an element id on its first use only", () => {
  assert.deepEqual(firstOnly(["a", "b", "a"]), ["a", "b", undefined]);
});

describe("the real workbook", () => {
  const scorecard = JSON.parse(
    readFileSync(new URL("../../../../content/scorecard.json", import.meta.url), "utf8"),
  ) as ScorecardData;

  test("each family's milestone rows cover nine milestones", () => {
    for (const family of ["wbe", "bci", "neuromorphic"] as const) {
      assert.equal(milestoneCount(milestoneRowsForFamily(scorecard, family)), 9);
    }
  });

  test("the register runs from E001 to E121", () => {
    assert.deepEqual(
      idRange((scorecard.entries ?? []).map((entry) => entry.id)),
      ["E001", "E121"],
    );
  });
});

test("familyStages lists only the family's own stage rows, in sheet order", () => {
  const scorecard = {
    codebook: [
      { type: "Stage", code: "S1", family: "WBE", definition: "Neural component simulation" },
      { type: "Scenario", code: "BCI-D", family: "BCI", definition: "Neural data for alignment" },
      { type: "Stage", code: "S1", family: "BCI", definition: "Read-only / passive decoding" },
      { type: "Stage", code: "S2", family: "BCI", definition: "Closed-loop read-write interface" },
    ],
  } as unknown as ScorecardData;
  assert.deepEqual(
    familyStages(scorecard, "bci").map((row) => `${row.code} ${row.definition}`),
    ["S1 Read-only / passive decoding", "S2 Closed-loop read-write interface"],
  );
  assert.deepEqual(familyStages({} as ScorecardData, "wbe"), []);
});

test("familyStages finds every family's stages in the real workbook", () => {
  const scorecard = JSON.parse(readFileSync(new URL("../../../../content/scorecard.json", import.meta.url), "utf8")) as ScorecardData;
  assert.equal(familyStages(scorecard, "wbe").length, 6);
  assert.equal(familyStages(scorecard, "bci").length, 4);
  assert.equal(familyStages(scorecard, "neuromorphic").length, 4);
});
