// The compare page's model: its dimensions, its address and what each
// technology shows on a dimension. Most tests read the real content/ JSON, so
// they also check that the content and the page agree.
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/compare/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { buildTimeline, type TimelineGroup } from "@/components/timeline/timelineModel";
import { milestoneHref } from "@/lib/codes";
import { COMPARE_MINDS_KEY, MINDS_ROW_ID, scorecardHref, scorecardRowId } from "@/lib/dimensions";
import { MINDS_FACETS as PAGE_MINDS_FACETS } from "@/components/technology/mindsParts";
import { milestoneTypes } from "@/lib/enums";
import type { ArtificialMindsStage, Milestone, ScorecardData, ScorecardRow, TechnologyPage } from "@/lib/types";

import {
  MINDS_FACETS,
  categoryCells,
  categoryInfo,
  chosenDimension,
  compareAddress,
  compareDimensions,
  dimensionGroups,
  domainRisks,
  milestoneRowCode,
  mindsCells,
  mindsFacets,
  nextDimension,
  riskDomainOfRow,
  scorecardCells,
  splitCategoryQuestion,
  stageName,
} from "../compareModel";

const NOW_YEAR = 2026;

function readContent<T>(fileName: string): T {
  const url = new URL(`../../../../content/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

const technologies = readContent<TechnologyPage[]>("technologies.json");
const allMilestones = readContent<Milestone[]>("milestones.json");
const scorecard = readContent<ScorecardData>("scorecard.json");

// The same filter as getPublicMilestones() in lib/data.ts.
const publicMilestones: Milestone[] = [];
for (const milestone of allMilestones) {
  if (!milestone.sample) {
    publicMilestones.push(milestone);
  }
}

function keysOf(items: { key: string }[]): string[] {
  const keys: string[] = [];
  for (const item of items) {
    keys.push(item.key);
  }
  return keys;
}

// A copy of the page with its scorecard replaced, for the error cases.
function withScorecard(page: TechnologyPage, scorecard: ScorecardRow[]): TechnologyPage {
  return { ...page, scorecard };
}

// The anchor the scorecard table used before rows had ids: the dimension
// name, slugified.
function oldNameSlug(dimension: string): string {
  const slug = dimension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `scorecard-${slug}`;
}

describe("compareDimensions", () => {
  test("lists the 16 dimensions in the select's order", () => {
    const dimensions = compareDimensions(technologies);
    const rowIds: string[] = [];
    for (const row of technologies[0].scorecard) {
      rowIds.push(row.id);
    }
    assert.equal(dimensions.length, 16);
    assert.deepEqual(keysOf(dimensions), [
      ...rowIds,
      "artificial-minds",
      "technical-capability",
      "high-level-fidelity",
      "reliability-robustness",
      "scalable-production",
      "economic-viability",
      "equitable-access",
      "safety-welfare-assurance",
      "legal-regulatory",
      "institutional-legitimacy",
    ]);
    assert.equal(dimensions[0].key, "alignment-case");
    assert.equal(dimensions[0].label, "Alignment case");
  });

  test("groups the options: Scorecard, then Artificial minds alone, then one group per type", () => {
    const groups: (string | null)[] = [];
    const sizes: number[] = [];
    for (const run of dimensionGroups(compareDimensions(technologies))) {
      groups.push(run.group);
      sizes.push(run.dimensions.length);
    }
    assert.deepEqual(groups, [
      "Scorecard",
      null,
      "Technical milestones",
      "Deployment milestones",
      "Welfare and governance milestones",
    ]);
    assert.deepEqual(sizes, [6, 1, 3, 3, 3]);
  });

  test("a category dimension carries its category, label and type", () => {
    const dimensions = compareDimensions(technologies);
    const fidelity = chosenDimension(dimensions, "high-level-fidelity").dimension;
    assert.equal(fidelity.kind, "category");
    assert.equal(fidelity.category, "high_level_fidelity");
    assert.equal(fidelity.label, "High-level fidelity");
    assert.equal(fidelity.type?.label, "Technical");
  });

  test("throws, naming the validator, when a row id is a reserved key", () => {
    const rows = technologies[0].scorecard;
    const taken = [{ ...rows[0], id: "economic-viability" }, ...rows.slice(1)];
    assert.throws(
      () => compareDimensions([withScorecard(technologies[0], taken)]),
      /"economic-viability".*python -m sf_shared\.validate content\//,
    );
    const minds = [{ ...rows[0], id: COMPARE_MINDS_KEY }, ...rows.slice(1)];
    assert.throws(() => compareDimensions([withScorecard(technologies[0], minds)]), /"artificial-minds"/);
  });
});

describe("links to the rating cards", () => {
  test("a rating card's address", () => {
    assert.equal(
      scorecardHref("bci", "artificial-mind-welfare-and-rights-risk"),
      "/bci/#scorecard-artificial-mind-welfare-and-rights-risk",
    );
  });

  test("every row's anchor is the one its dimension name gave before rows had ids", () => {
    for (const technology of technologies) {
      for (const row of technology.scorecard) {
        assert.equal(scorecardRowId(row.id), oldNameSlug(row.dimension), `${technology.id}: ${row.dimension}`);
      }
    }
  });
});

describe("chosenDimension", () => {
  const dimensions = compareDimensions(technologies);

  test("no parameter shows the first dimension and isn't unknown", () => {
    assert.deepEqual(chosenDimension(dimensions, null), { dimension: dimensions[0], unknown: false });
  });

  test("an empty, mistyped or differently cased value shows the first dimension and is unknown", () => {
    for (const raw of ["", "nope", "Alignment-Case", "economic_viability"]) {
      assert.deepEqual(chosenDimension(dimensions, raw), { dimension: dimensions[0], unknown: true }, raw);
    }
  });

  test("an exact key matches", () => {
    const result = chosenDimension(dimensions, "economic-viability");
    assert.equal(result.dimension.key, "economic-viability");
    assert.equal(result.unknown, false);
  });
});

describe("compareAddress", () => {
  test("adds the dimension and keeps other parameters", () => {
    assert.equal(compareAddress("deployment", new URLSearchParams("?utm=x")), "?utm=x&dimension=deployment");
  });

  test("replaces a dimension already there", () => {
    assert.equal(
      compareAddress("economic-viability", new URLSearchParams("?dimension=alignment-case")),
      "?dimension=economic-viability",
    );
  });

  test("a null key removes the dimension", () => {
    assert.equal(compareAddress(null, new URLSearchParams("?utm=x&dimension=bogus")), "?utm=x");
    assert.equal(compareAddress(null, new URLSearchParams("?dimension=bogus")), "");
  });

  test("doesn't change the parameters it was given", () => {
    const current = new URLSearchParams("?dimension=bogus");
    compareAddress("alignment-case", current);
    assert.equal(current.toString(), "dimension=bogus");
  });
});

describe("nextDimension", () => {
  const dimensions = compareDimensions(technologies);

  test("steps to the next dimension", () => {
    assert.equal(nextDimension(dimensions, "alignment-case").key, dimensions[1].key);
  });

  test("wraps from the last back to the first", () => {
    assert.equal(nextDimension(dimensions, dimensions[dimensions.length - 1].key).key, "alignment-case");
  });

  test("visits all 16 before coming back", () => {
    const visited = new Set<string>();
    let key = dimensions[0].key;
    for (let step = 0; step < dimensions.length; step++) {
      visited.add(key);
      key = nextDimension(dimensions, key).key;
    }
    assert.equal(visited.size, 16);
    assert.equal(key, dimensions[0].key);
  });
});

describe("scorecardCells", () => {
  test("returns one cell per technology, in file order", () => {
    const cells = scorecardCells(technologies, "alignment-case");
    const ids: string[] = [];
    for (const cell of cells) {
      ids.push(cell.technology.id);
      assert.equal(cell.row.id, "alignment-case");
    }
    assert.deepEqual(ids, ["wbe", "bci", "neuromorphic"]);
  });

  test("throws, naming the validator, when a page lacks the row", () => {
    const withoutRow = technologies[1].scorecard.slice(1);
    const pages = [technologies[0], withScorecard(technologies[1], withoutRow), technologies[2]];
    assert.throws(
      () => scorecardCells(pages, "alignment-case"),
      /bci has no scorecard row with id "alignment-case".*python -m sf_shared\.validate content\//,
    );
  });
});

describe("risk rows", () => {
  test("each risk row stands for one tab 7 domain; case rows for none", () => {
    assert.equal(riskDomainOfRow("human-welfare-risk"), "human_welfare");
    assert.equal(riskDomainOfRow(MINDS_ROW_ID), "artificial_mind_welfare");
    assert.equal(riskDomainOfRow("governance-risk"), "governance");
    assert.equal(riskDomainOfRow("alignment-case"), null);
    assert.equal(riskDomainOfRow("safeguard-adequacy"), null);
  });

  test("every risk row has severity and likelihood instead of a rating, or says Not applicable", () => {
    for (const technology of technologies) {
      for (const row of technology.scorecard) {
        if (row.scale !== "risk") {
          continue;
        }
        assert.equal(row.rating, null, `${technology.id}: ${row.id}`);
        if (row.applicable === false) {
          assert.equal(row.severity ?? null, null, `${technology.id}: ${row.id}`);
        } else {
          assert.ok(row.severity, `${technology.id}: ${row.id}`);
          assert.ok(row.likelihood, `${technology.id}: ${row.id}`);
        }
      }
    }
  });

  test("a risk row's risks are the page's tab 7 risks in the row's domain, in sheet order", () => {
    const [wbe, bci, neuromorphic] = scorecardCells(technologies, "governance-risk");
    const ids = (cell: { technology: TechnologyPage; row: ScorecardRow }) =>
      domainRisks(scorecard, cell.technology, cell.row).map((risk) => risk.id);
    // R05 names all three families, so it is on every page.
    assert.deepEqual(ids(wbe), ["R04", "R05", "R06", "R20"]);
    assert.deepEqual(ids(bci), ["R05", "R09"]);
    assert.deepEqual(ids(neuromorphic), ["R05", "R15", "R16", "R18", "R19"]);
  });

  test("a case row and a Not applicable row have no risks", () => {
    const [wbe] = scorecardCells(technologies, "alignment-case");
    assert.deepEqual(domainRisks(scorecard, wbe.technology, wbe.row), []);
    const bci = scorecardCells(technologies, MINDS_ROW_ID)[1];
    assert.equal(bci.row.applicable, false);
    assert.deepEqual(domainRisks(scorecard, bci.technology, bci.row), []);
  });
});

describe("stageName and mindsFacets", () => {
  function stage(fields: Partial<ArtificialMindsStage>): ArtificialMindsStage {
    return { stage_label: "", ...fields };
  }

  test("a stage loses its leading number only", () => {
    assert.equal(
      stageName(stage({ stage: "S3", stage_number: 3, stage_label: "3 Whole brain emulation (one instance)" })),
      "Whole brain emulation (one instance)",
    );
    assert.equal(stageName(stage({ stage: null, stage_number: null, stage_label: "All stages" })), "All stages");
    // A label that doesn't start with its number stays as written.
    assert.equal(stageName(stage({ stage: "S2", stage_number: 2, stage_label: "Partial" })), "Partial");
  });

  test("labels name the tab 4.1 columns as the technology page does, in column order", () => {
    const labels: string[] = [];
    for (const facet of MINDS_FACETS) {
      labels.push(facet.label);
    }
    assert.deepEqual(labels, [
      "Consciousness",
      "Grounds for moral status",
      "Identity, copying and modification",
      "Welfare harms or benefits",
      "Proposed protections",
    ]);
    assert.deepEqual(labels, PAGE_MINDS_FACETS.map((facet) => facet.label));
  });

  test("keeps facets with text, each statement under its stage in tab order, and names the rest", () => {
    const { filled, empty } = mindsFacets([
      stage({ stage: "S1", stage_number: 1, stage_label: "1 One" }),
      stage({ stage: "S2", stage_number: 2, stage_label: "2 Two", identity: "B", welfare: "C" }),
      stage({ stage: "S3", stage_number: 3, stage_label: "3 Three", identity: "A", consciousness: "  " }),
    ]);
    const shape: [string, string[]][] = [];
    for (const facet of filled) {
      shape.push([facet.key, facet.statements.map((statement) => `${statement.stage} ${statement.stageName}: ${statement.text}`)]);
    }
    assert.deepEqual(shape, [
      ["identity", ["S2 Two: B", "S3 Three: A"]],
      ["welfare", ["S2 Two: C"]],
    ]);
    assert.deepEqual(empty, ["Consciousness", "Grounds for moral status", "Proposed protections"]);
  });
});

describe("mindsCells", () => {
  test("finds the minds row on every page", () => {
    const cells = mindsCells(technologies);
    assert.equal(cells.length, 3);
    for (const cell of cells) {
      assert.equal(cell.row?.id, MINDS_ROW_ID, cell.technology.id);
    }
  });

  test("WBE shows every facet; neuromorphic AI shows identity only and names the other four", () => {
    const [wbe, , neuromorphic] = mindsCells(technologies);
    assert.equal(wbe.notApplicable, false);
    assert.equal(wbe.facets.length, 5);
    assert.deepEqual(wbe.emptyFacets, []);
    // The text is the tab's cell word for word.
    const firstStage = (technologies[0].artificial_minds_by_stage ?? []).find((row) => row.consciousness);
    assert.equal(wbe.facets[0].statements[0].text, firstStage?.consciousness);
    assert.equal(wbe.facets[0].statements[0].stage, "S3");
    assert.equal(wbe.facets[0].statements[0].stageName, "Whole brain emulation (one instance)");

    assert.deepEqual(
      neuromorphic.facets.map((facet) => facet.label),
      ["Identity, copying and modification"],
    );
    assert.deepEqual(neuromorphic.emptyFacets, [
      "Consciousness",
      "Grounds for moral status",
      "Welfare harms or benefits",
      "Proposed protections",
    ]);
  });

  test("BCI's minds row is Not applicable: no facets and no empty-facet line", () => {
    const bci = mindsCells(technologies)[1];
    assert.equal(bci.notApplicable, true);
    assert.deepEqual(bci.facets, []);
    assert.deepEqual(bci.emptyFacets, []);
  });

  test("leaves out each page's own questions (AI drafts on BCI and neuromorphic AI)", () => {
    for (const cell of mindsCells(technologies)) {
      assert.equal("questions" in cell, false);
    }
  });
});

describe("splitCategoryQuestion and categoryInfo", () => {
  test("cuts the question at the sheet's own two marks, and the parts join back to the text", () => {
    for (const info of scorecard.milestone_categories ?? []) {
      const parts = splitCategoryQuestion(info.question);
      assert.ok(parts.countsAsEvidence?.startsWith("Counts as evidence:"), info.id);
      assert.ok(parts.doesNotCount?.startsWith("Does not count:"), info.id);
      assert.equal([parts.question, parts.countsAsEvidence, parts.doesNotCount].join(" "), info.question, info.id);
    }
  });

  test("M9 keeps its extra sentence in the question", () => {
    const m9 = categoryInfo(scorecard, "equitable_access");
    assert.equal(m9.code, "M9");
    assert.equal(m9.question?.question, "Is access broad and meaningful? Applies only where a source claims broad benefit.");
  });

  test("a question without the marks stays whole", () => {
    assert.deepEqual(splitCategoryQuestion("Is it legal?"), {
      question: "Is it legal?",
      countsAsEvidence: null,
      doesNotCount: null,
    });
    assert.deepEqual(splitCategoryQuestion("Is it legal? Counts as evidence: statutes."), {
      question: "Is it legal?",
      countsAsEvidence: "Counts as evidence: statutes.",
      doesNotCount: null,
    });
  });

  test("every category dimension has a tab 1a header", () => {
    for (const type of milestoneTypes()) {
      for (const category of type.categories) {
        assert.ok(categoryInfo(scorecard, category).code, category);
      }
    }
  });
});

describe("categoryCells", () => {
  const groups = buildTimeline(publicMilestones, NOW_YEAR);

  test("Technical capability: each family's tab 1a rows; BCI and neuromorphic AI have two", () => {
    const cells = categoryCells(technologies, scorecard, groups, "technical_capability");
    assert.equal(cells.length, 3);
    const [wbe, bci, neuromorphic] = cells;
    assert.deepEqual(wbe.rows.map(milestoneRowCode), ["WBE-M1"]);
    assert.deepEqual(wbe.rows.map((row) => row.part), [null]);
    assert.deepEqual(bci.rows.map((row) => row.assessment.applies_to), [
      "Neural feedback for alignment",
      "Oversight and enhancement",
    ]);
    assert.deepEqual(bci.rows.map((row) => row.part), [1, 2]);
    assert.deepEqual(neuromorphic.rows.map(milestoneRowCode), ["NM-M1", "NM-M1"]);
  });

  test("a split row links to its own part on the technology page", () => {
    const bci = categoryCells(technologies, scorecard, groups, "technical_capability")[1];
    const hrefs = bci.rows.map((row) => milestoneHref(row.assessment.family, row.assessment.milestone, row.part));
    assert.deepEqual(hrefs, ["/bci/#milestone-bci-m1-1", "/bci/#milestone-bci-m1-2"]);
  });

  test("every category has a row for every family", () => {
    for (const type of milestoneTypes()) {
      for (const category of type.categories) {
        for (const cell of categoryCells(technologies, scorecard, groups, category)) {
          assert.ok(cell.rows.length > 0, `${cell.technology.id} ${category}`);
        }
      }
    }
  });

  test("Economic viability: WBE links to its timeline milestone with the timeline's code; BCI and NM have none", () => {
    const [wbe, bci, neuromorphic] = categoryCells(technologies, scorecard, groups, "economic_viability");
    assert.deepEqual(
      wbe.timelineItems.map((item) => item.milestone.id),
      ["wbe-economics"],
    );
    let timelineCode = "";
    for (const group of groups) {
      for (const item of group.items) {
        if (item.milestone.id === "wbe-economics") {
          timelineCode = item.code;
        }
      }
    }
    assert.equal(wbe.timelineItems[0].code, timelineCode);
    assert.deepEqual(bci.timelineItems, []);
    assert.deepEqual(neuromorphic.timelineItems, []);
  });

  test("High-level fidelity: WBE has a tab 1a row (M2) but no timeline milestone", () => {
    const [wbe] = categoryCells(technologies, scorecard, groups, "high_level_fidelity");
    assert.deepEqual(wbe.rows.map(milestoneRowCode), ["WBE-M2"]);
    assert.deepEqual(wbe.timelineItems, []);
  });

  test("drops a sample milestone that gets through", () => {
    // Every milestone, samples included, plus a sample WBE one in Economic viability.
    const sampleEconomics: Milestone = { ...publicMilestones[0], id: "wbe-sample-economics", sample: true };
    sampleEconomics.category = "economic_viability";
    const withSamples: TimelineGroup[] = buildTimeline([...allMilestones, sampleEconomics], NOW_YEAR);
    const cells = categoryCells(technologies, scorecard, withSamples, "economic_viability");
    assert.deepEqual(
      cells[0].timelineItems.map((item) => item.milestone.id),
      ["wbe-economics"],
    );
    // BCI's only timeline milestones are samples, so it still links to none.
    assert.deepEqual(cells[1].timelineItems, []);
  });
});
