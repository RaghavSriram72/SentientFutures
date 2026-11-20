// The "Type: ..." part of a milestone card's aria-label.
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/timeline/tests/*.test.ts"
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { typeTag } from "../timelineModel";

describe("typeTag", () => {
  test("names the type a category belongs to", () => {
    assert.equal(typeTag("legal_regulatory"), "Type: Welfare and governance");
    assert.equal(typeTag("high_level_fidelity"), "Type: Technical");
    assert.equal(typeTag("economic_viability"), "Type: Deployment");
  });
});
