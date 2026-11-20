// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "app/methodology/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { CodebookRow, ScorecardData } from "@/lib/types";

import {
  codebookDescriptions,
  codebookRuns,
  runIdForType,
  scopeNotesWithoutKeyQuestion,
  shownCode,
  splitAtLabels,
} from "../codebookModel";

function row(type: string, code: string, family = "All", definition = `${code} meaning`): CodebookRow {
  return { type, code, family, definition };
}

describe("codebookRuns", () => {
  test("groups only rows next to each other and never moves one", () => {
    const rows = [
      row("Scenario", "WBE-O", "WBE"),
      row("Scenario", "BCI-D", "BCI"),
      row("Rating", "Strong"),
      row("Rating", "Weak"),
      row("Comparator", "Alignment"),
      row("Scenario", "BCI-X", "BCI"),
    ];
    const runs = codebookRuns(rows);
    assert.deepEqual(
      runs.map((run) => [run.id, run.type, run.rows.map((item) => item.code), run.family]),
      [
        ["codebook-scenario", "Scenario", ["WBE-O", "BCI-D"], null],
        ["codebook-rating", "Rating", ["Strong", "Weak"], "All"],
        ["codebook-comparator", "Comparator", ["Alignment"], "All"],
        ["codebook-scenario-2", "Scenario", ["BCI-X"], "BCI"],
      ],
    );
    // Joining the runs gives back every row in sheet order.
    assert.deepEqual(
      runs.flatMap((run) => run.rows),
      rows,
    );
  });

  test("keeps the real Codebook's rows whole and in order", () => {
    const scorecard = JSON.parse(readFileSync(new URL("../../../../content/scorecard.json", import.meta.url), "utf8")) as ScorecardData;
    const rows = scorecard.codebook ?? [];
    const runs = codebookRuns(rows);
    assert.deepEqual(
      runs.flatMap((run) => run.rows),
      rows,
    );
    const ids = runs.map((run) => run.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("an empty Codebook has no runs", () => {
    assert.deepEqual(codebookRuns([]), []);
  });

  test("names a later run of a type by the type and its first code", () => {
    const runs = codebookRuns([
      row("Scenario", "WBE-O", "WBE"),
      row("Rating", "Strong"),
      row("Scenario", "BCI-X", "BCI"),
      row("Scenario", "BCI-Y", "BCI"),
      row("Rating", "Weak"),
    ]);
    assert.deepEqual(
      runs.map((run) => run.title),
      ["Scenario", "Rating", "Scenario · BCI-X", "Rating · Weak"],
    );
  });

  test("gives every fold of the real Codebook its own name", () => {
    const scorecard = JSON.parse(readFileSync(new URL("../../../../content/scorecard.json", import.meta.url), "utf8")) as ScorecardData;
    const titles = codebookRuns(scorecard.codebook ?? []).map((run) => run.title);
    assert.equal(new Set(titles).size, titles.length);
    assert.ok(titles.includes("Scenario · BCI-X"));
  });
});

describe("scopeNotesWithoutKeyQuestion", () => {
  test("leaves out the key question and the tab's title, the rest word for word and in order", () => {
    const notes = ["§1 Scope (descriptive, unrated)", "Key question: How strong is the case?", "Time horizon bands are provisional"];
    assert.deepEqual(scopeNotesWithoutKeyQuestion(notes), ["Time horizon bands are provisional"]);
  });

  test("keeps every note when there is no key question", () => {
    assert.deepEqual(scopeNotesWithoutKeyQuestion(["A", "B"]), ["A", "B"]);
  });
});

describe("splitAtLabels", () => {
  test("cuts a row at its own labels and keeps each piece word for word", () => {
    const definition =
      "High: multiple robust sources, contrary evidence considered. Medium: some support, meaningful limits. Low: indirect, early-stage or contested basis.";
    assert.deepEqual(splitAtLabels(definition, ["High", "Medium", "Low"]), {
      High: "multiple robust sources, contrary evidence considered.",
      Medium: "some support, meaningful limits.",
      Low: "indirect, early-stage or contested basis.",
    });
  });

  test("gives nothing when a label is missing or out of order", () => {
    assert.deepEqual(splitAtLabels("High: a. Low: b.", ["High", "Medium", "Low"]), {});
    assert.deepEqual(splitAtLabels("Low: b. High: a.", ["High", "Low"]), {});
  });

  test("never matches a label inside a longer word", () => {
    assert.deepEqual(splitAtLabels("Below: x. Low: y.", ["Low"]), { Low: "y." });
  });
});

describe("codebookDescriptions", () => {
  const values = [
    { value: "strong", label: "Strong" },
    { value: "not_claimed", label: "Not claimed" },
    { value: "high", label: "High" },
    { value: "low", label: "Low" },
  ];

  test("takes a whole definition by label, only from rows of that type", () => {
    const rows = [row("Rating rule", "Strong", "All", "Rule text"), row("Rating", "Strong", "All", "Clear mechanism")];
    assert.deepEqual(codebookDescriptions(rows, "Rating", values), { strong: "Clear mechanism" });
  });

  test("cuts a combined row at its labels", () => {
    const rows = [row("Confidence", "High / Low", "All", "High: robust. Low: indirect.")];
    assert.deepEqual(codebookDescriptions(rows, "Confidence", values), { high: "robust.", low: "indirect." });
  });

  test("a combined row without markers gives nothing", () => {
    const rows = [row("Unclear reason", "Strong / Not claimed", "All", "Literature unresolved")];
    assert.deepEqual(codebookDescriptions(rows, "Unclear reason", values), {});
  });
});

describe("runIdForType", () => {
  test("finds the first fold holding a type", () => {
    const runs = codebookRuns([row("Scenario", "A"), row("Rating", "Strong"), row("Scenario", "B")]);
    assert.equal(runIdForType(runs, "Scenario"), "codebook-scenario");
    assert.equal(runIdForType(runs, "Rating"), "codebook-rating");
    assert.equal(runIdForType(runs, "Stage"), null);
  });
});

describe("shownCode", () => {
  test("hides a lone dash and keeps every other code as it is", () => {
    assert.equal(shownCode("-"), "");
    assert.equal(shownCode(" - "), "");
    assert.equal(shownCode("WBE-O"), "WBE-O");
    assert.equal(shownCode("*-X / *-C / *-U"), "*-X / *-C / *-U");
  });

  test("the real Codebook's rule rows are the ones that show no code", () => {
    const scorecard = JSON.parse(readFileSync(new URL("../../../../content/scorecard.json", import.meta.url), "utf8")) as ScorecardData;
    const hidden = (scorecard.codebook ?? []).filter((item) => shownCode(item.code) === "").map((item) => item.type);
    assert.ok(hidden.includes("Synthesis rule"), hidden.join(", "));
    assert.ok(hidden.includes("Status rule"), hidden.join(", "));
  });
});
