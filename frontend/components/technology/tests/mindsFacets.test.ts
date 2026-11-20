// The artificial minds facets built from the workbook's "4.1 Artificial Minds" rows.
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/technology/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { ArtificialMindsStage, TechnologyPage } from "@/lib/types";

import { emptyFacetLabels, MINDS_FACETS, mindsFacets, stageHeading, stagesWithReferences } from "../mindsParts";

function stage(label: string, overrides: Partial<ArtificialMindsStage> = {}): ArtificialMindsStage {
  return { stage: null, stage_label: label, stage_number: null, source_ids: [], entries: [], ...overrides };
}

describe("stageHeading", () => {
  test("drops the Stage cell's leading number and nothing else", () => {
    assert.equal(stageHeading("3 Whole brain emulation (one instance)"), "Whole brain emulation (one instance)");
    assert.equal(stageHeading("6 Deployed populations"), "Deployed populations");
  });

  test("keeps a cell with no leading number as it is", () => {
    assert.equal(stageHeading("All stages"), "All stages");
    assert.equal(stageHeading("3"), "3");
  });
});

describe("mindsFacets", () => {
  test("labels name the tab's columns, in order", () => {
    assert.deepEqual(
      MINDS_FACETS.map((facet) => facet.label),
      [
        "Consciousness",
        "Grounds for moral status",
        "Identity, copying and modification",
        "Welfare harms or benefits",
        "Proposed protections",
      ],
    );
  });

  test("keeps stage order and the cells word for word, skipping empty ones", () => {
    const facets = mindsFacets([
      stage("1 First", { identity: "  " }),
      stage("2 Second", { identity: "Second's text (S22)" }),
      stage("3 Third", { identity: "Third's text", welfare: "Welfare text" }),
    ]);
    const identity = facets.find((facet) => facet.key === "identity");
    assert.deepEqual(identity?.statements, [
      { stageLabel: "2 Second", heading: "Second", text: "Second's text (S22)" },
      { stageLabel: "3 Third", heading: "Third", text: "Third's text" },
    ]);
    assert.deepEqual(emptyFacetLabels(facets), ["Consciousness", "Grounds for moral status", "Proposed protections"]);
  });

  test("an all-empty row gives five empty facets", () => {
    assert.equal(emptyFacetLabels(mindsFacets([stage("All stages")])).length, 5);
  });

  test("stagesWithReferences keeps only stages naming sources or entries", () => {
    const stages = [stage("1 A"), stage("2 B", { entries: ["E001"] }), stage("3 C", { source_ids: ["s16"] })];
    assert.deepEqual(
      stagesWithReferences(stages).map((item) => item.stage_label),
      ["2 B", "3 C"],
    );
  });
});

describe("the real pages", () => {
  const pages = JSON.parse(
    readFileSync(new URL("../../../../content/technologies.json", import.meta.url), "utf8"),
  ) as TechnologyPage[];
  const stagesOf = (id: string) => pages.find((page) => page.id === id)?.artificial_minds_by_stage ?? [];

  test("WBE fills every facet; neuromorphic AI fills only identity", () => {
    assert.deepEqual(emptyFacetLabels(mindsFacets(stagesOf("wbe"))), []);
    const nm = mindsFacets(stagesOf("neuromorphic"));
    assert.deepEqual(
      nm.filter((facet) => facet.statements.length > 0).map((facet) => facet.key),
      ["identity"],
    );
  });

  test("every statement is a cell from the content, unchanged", () => {
    for (const id of ["wbe", "bci", "neuromorphic"]) {
      const stages = stagesOf(id);
      for (const facet of mindsFacets(stages)) {
        for (const statement of facet.statements) {
          const row = stages.find((item) => item.stage_label === statement.stageLabel);
          assert.equal(row?.[facet.key], statement.text);
        }
      }
    }
  });
});
