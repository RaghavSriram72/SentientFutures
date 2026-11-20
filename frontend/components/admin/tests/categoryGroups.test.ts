// The milestone editor's Category select, grouped by milestone type.
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/admin/tests/*.test.ts"
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { enumLabel, enumValues, milestoneTypes } from "@/lib/enums";

import { categoryGroups, optionsInNoGroup } from "../milestoneModel";

describe("categoryGroups", () => {
  test("lists every category once, in the category enum's order", () => {
    const listed: string[] = [];
    for (const group of categoryGroups()) {
      for (const option of group.options) {
        listed.push(option.value);
      }
    }
    const categories: string[] = [];
    for (const category of enumValues("MilestoneCategory")) {
      categories.push(category.value);
    }
    assert.deepEqual(listed, categories);
    assert.equal(new Set(listed).size, listed.length);
  });

  test("labels each optgroup with its type's label", () => {
    const groupLabels: string[] = [];
    for (const group of categoryGroups()) {
      groupLabels.push(group.label);
    }
    const typeLabels: string[] = [];
    for (const info of milestoneTypes()) {
      typeLabels.push(info.label);
    }
    assert.deepEqual(groupLabels, typeLabels);
    assert.deepEqual(groupLabels, ["Technical", "Deployment", "Welfare and governance"]);
  });

  test("labels each option with its category's label", () => {
    const technical = categoryGroups()[0];
    assert.deepEqual(technical.options[1], { value: "high_level_fidelity", label: "High-level fidelity" });
    for (const group of categoryGroups()) {
      for (const option of group.options) {
        assert.equal(option.label, enumLabel("MilestoneCategory", option.value));
      }
    }
  });
});

describe("optionsInNoGroup", () => {
  test("is empty when the groups list every category", () => {
    assert.deepEqual(optionsInNoGroup(enumValues("MilestoneCategory"), categoryGroups()), []);
  });

  test("keeps the options no group lists, in their own order", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
    ];
    const groups = [{ label: "Some", options: [{ value: "b", label: "B" }] }];
    assert.deepEqual(optionsInNoGroup(options, groups), [
      { value: "a", label: "A" },
      { value: "c", label: "C" },
    ]);
  });

  test("keeps every option when there are no groups, as with a stale enums.json", () => {
    const options = enumValues("MilestoneCategory");
    assert.deepEqual(optionsInNoGroup(options, []), options);
  });
});
