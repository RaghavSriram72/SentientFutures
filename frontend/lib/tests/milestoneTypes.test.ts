// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "lib/tests/*.test.ts"
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { enumValues, milestoneTypeCategoriesText, milestoneTypeOf, milestoneTypes } from "@/lib/enums";

describe("milestoneTypes", () => {
  test("lists the three types in the owner's order", () => {
    const values: string[] = [];
    const labels: string[] = [];
    for (const info of milestoneTypes()) {
      values.push(info.value);
      labels.push(info.label);
    }
    assert.deepEqual(values, ["technical", "deployment", "welfare_governance"]);
    assert.deepEqual(labels, ["Technical", "Deployment", "Welfare and governance"]);
  });

  test("its categories, read in order, are the category enum's order", () => {
    const flattened: string[] = [];
    for (const info of milestoneTypes()) {
      flattened.push(...info.categories);
    }
    const categories: string[] = [];
    for (const category of enumValues("MilestoneCategory")) {
      categories.push(category.value);
    }
    assert.deepEqual(flattened, categories);
  });
});

describe("milestoneTypeOf", () => {
  test("gives every category a type", () => {
    for (const category of enumValues("MilestoneCategory")) {
      assert.notEqual(milestoneTypeOf(category.value), null, category.value);
    }
  });

  test("puts high-level fidelity in Technical and economic viability in Deployment", () => {
    assert.equal(milestoneTypeOf("high_level_fidelity")?.value, "technical");
    assert.equal(milestoneTypeOf("economic_viability")?.value, "deployment");
    assert.equal(milestoneTypeOf("legal_regulatory")?.label, "Welfare and governance");
  });

  test("gives null for a value that isn't a category", () => {
    assert.equal(milestoneTypeOf("high_fidelity"), null);
    assert.equal(milestoneTypeOf(""), null);
  });
});

describe("milestoneTypeCategoriesText", () => {
  test("joins the category labels with middle dots", () => {
    const deployment = milestoneTypeOf("economic_viability");
    assert.ok(deployment);
    assert.equal(
      milestoneTypeCategoriesText(deployment),
      "Scalable manufacture, compute or data · Economic viability · Equitable or broad access",
    );
  });
});
