// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "lib/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  COMPARE_MINDS_KEY,
  COMPARE_PARAM,
  MINDS_ROW_ID,
  compareCategoryKey,
  compareHref,
  scorecardHref,
  scorecardRowId,
} from "@/lib/dimensions";

describe("compare keys", () => {
  test("a category's key uses hyphens", () => {
    assert.equal(compareCategoryKey("economic_viability"), "economic-viability");
    assert.equal(compareCategoryKey("high_level_fidelity"), "high-level-fidelity");
  });

  test("the artificial minds key matches the one the Python validator reserves", () => {
    const modelsUrl = new URL("../../../shared/sf_shared/models.py", import.meta.url);
    const match = readFileSync(modelsUrl, "utf8").match(/^COMPARE_MINDS_ID = "([^"]+)"$/m);
    assert.ok(match, "no COMPARE_MINDS_ID in shared/sf_shared/models.py");
    assert.equal(COMPARE_MINDS_KEY, match[1]);
  });
});

describe("links", () => {
  test("a rating card's id and address", () => {
    assert.equal(scorecardRowId("alignment-case"), "scorecard-alignment-case");
    assert.equal(scorecardHref("bci", MINDS_ROW_ID), "/bci/#scorecard-artificial-mind-welfare-and-rights-risk");
  });

  test("the compare page's address", () => {
    assert.equal(COMPARE_PARAM, "dimension");
    assert.equal(compareHref(null), "/compare/");
    assert.equal(compareHref("economic-viability"), "/compare/?dimension=economic-viability");
    assert.equal(compareHref(COMPARE_MINDS_KEY), "/compare/?dimension=artificial-minds");
  });
});
