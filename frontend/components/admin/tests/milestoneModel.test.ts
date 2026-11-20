import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildTimeline } from "@/components/timeline/timelineModel";
import type { MilestoneRecord } from "@/lib/adminTypes";
import { toMilestone as milestoneFromApi } from "@/lib/api";
import type { Milestone, Technology } from "@/lib/types";

import { LONG_DASH } from "../editorModel";
import {
  blankForecast,
  blankMilestone,
  inFormOrder,
  milestoneProblems,
  previewMilestones,
  problemsStillOpen,
  teamRangePatch,
  toDraft,
  toMilestone,
  type MilestoneDraft,
} from "../milestoneModel";

const NOW_YEAR = 2026;

function record(id: string, technology: Technology, published: boolean, sample = false): MilestoneRecord {
  const draft = blankMilestone();
  draft.id = id;
  draft.name = id;
  draft.technology = technology;
  if (sample) {
    draft.sample = true;
  }
  return {
    milestone: toMilestone(draft, { estimateChanged: false, editor: "", today: "2026-10-28" }),
    published,
    version: 1,
    updated_by: null,
    updated_at: null,
  };
}

// The code buildTimeline gives a milestone, e.g. "WBE-05".
function codeOf(id: string, milestones: Milestone[]): string | undefined {
  for (const group of buildTimeline(milestones, NOW_YEAR)) {
    for (const item of group.items) {
      if (item.milestone.id === id) {
        return item.code;
      }
    }
  }
  return undefined;
}

describe("previewMilestones", () => {
  // In list order, like the API sends them: samples first in a technology,
  // and an unpublished draft between published milestones.
  const records = [
    record("bci-sample-one", "bci", true, true),
    record("bci-real", "bci", true),
    record("wbe-first", "wbe", true),
    record("wbe-draft", "wbe", false),
    record("wbe-second", "wbe", true),
    record("wbe-third", "wbe", true),
  ];
  const publicTimeline: Milestone[] = [];
  for (const item of records) {
    if (item.published && !item.milestone.sample) {
      publicTimeline.push(item.milestone);
    }
  }

  test("numbers the milestone being edited as the public timeline does", () => {
    const shown = previewMilestones(records, "wbe-second", false);
    assert.equal(codeOf("wbe-second", shown), codeOf("wbe-second", publicTimeline));
    assert.equal(codeOf("wbe-second", shown), "WBE-02");
    assert.equal(codeOf("wbe-third", shown), "WBE-03");
  });

  test("leaves samples out of the numbering", () => {
    const shown = previewMilestones(records, "bci-real", false);
    assert.equal(codeOf("bci-real", shown), "BCI-01");
    assert.equal(codeOf("bci-sample-one", shown), undefined);
  });

  test("keeps an unpublished milestone in its own place while it's edited", () => {
    const ids = previewMilestones(records, "wbe-draft", false).map((milestone) => milestone.id);
    assert.deepEqual(ids, ["bci-real", "wbe-first", "wbe-draft", "wbe-second", "wbe-third"]);
  });

  test("a new milestone isn't in the list yet", () => {
    const ids = previewMilestones(records, "", false).map((milestone) => milestone.id);
    assert.deepEqual(ids, ["bci-real", "wbe-first", "wbe-second", "wbe-third"]);
  });

  test("a sample is numbered among the samples, as on the style guide's track", () => {
    const withSamples = [record("bci-sample-two", "bci", true, true), ...records];
    const shown = previewMilestones(withSamples, "bci-sample-one", true);
    assert.equal(codeOf("bci-sample-two", shown), "BCI-01");
    assert.equal(codeOf("bci-sample-one", shown), "BCI-02");
    assert.equal(codeOf("bci-real", shown), "BCI-03");
    assert.equal(codeOf("wbe-draft", shown), undefined);
  });
});

function withRange(earliest: number | null, latest: number | null): MilestoneDraft {
  const draft = blankMilestone();
  draft.estimate = { earliest, latest, basis: { text: "Why.", provenance: "team", source_ids: [] }, set_by: "", set_on: "" };
  draft.confidence = "low";
  return draft;
}

describe("problemsStillOpen", () => {
  test("drops a problem once its field is fixed", () => {
    const before = withRange(2060, 2040);
    const found = milestoneProblems(before);
    assert.ok(found["estimate.latest"]);
    const after = withRange(2060, 2080);
    const open = problemsStillOpen(found, after);
    assert.equal(open["estimate.latest"], undefined);
    // The problems nobody has fixed yet stay.
    assert.equal(open.name, found.name);
  });

  test("words a problem for the draft as it is now", () => {
    const found = milestoneProblems(withRange(2060, 2040));
    const open = problemsStillOpen(found, withRange(2050, 2040));
    assert.match(open["estimate.latest"], /\(2050\)/);
  });

  test("drops the problems of a forecast that was removed", () => {
    const before = blankMilestone();
    before.forecasts = [blankForecast("forecast-1")];
    const found = milestoneProblems(before);
    assert.ok(found["forecasts.0.source_id"]);
    const after = { ...before, forecasts: [] };
    for (const path of Object.keys(problemsStillOpen(found, after))) {
      assert.equal(path.startsWith("forecasts."), false, path);
    }
  });

  test("doesn't add a problem the last save didn't find", () => {
    const draft = blankMilestone();
    draft.id = "Not A Slug";
    assert.ok(milestoneProblems(draft).id);
    assert.deepEqual(problemsStillOpen({ name: "Give the milestone a name." }, draft), {
      name: "Give the milestone a name.",
    });
    assert.deepEqual(problemsStillOpen({}, draft), {});
  });

  test("drops a problem only the API knows about, for the next save to check again", () => {
    const open = problemsStillOpen({ depends_on: "This would make a cycle." }, blankMilestone());
    assert.deepEqual(open, {});
  });
});

describe("the order of problems", () => {
  test("an empty milestone's problems start with its name, the first field in the form", () => {
    const paths = Object.keys(milestoneProblems(blankMilestone()));
    assert.equal(paths[0], "name");
    assert.equal(paths[1], "id");
    assert.equal(paths[2], "status_basis.text");
  });

  test("follow the form from top to bottom", () => {
    const draft = withRange(null, null);
    draft.confidence = null;
    draft.achieved_in = 1900;
    draft.forecasts = [blankForecast("forecast-1")];
    draft.would_move_earlier = [];
    const paths = Object.keys(milestoneProblems(draft));
    const order = [
      "name",
      "id",
      "status_basis.text",
      "achieved_in",
      "achieved_in_basis.text",
      "summary.text",
      "would_move_earlier",
      "would_move_later.0.text",
      "estimate.earliest",
      "confidence",
      "forecasts.0.forecaster",
      "forecasts.0.source_id",
      "forecasts.0.claim",
      "forecasts.0.quote",
      "forecasts.0.made_in",
      "forecasts.0.earliest",
    ];
    const positions = order.map((path) => paths.indexOf(path));
    for (const [index, position] of positions.entries()) {
      assert.notEqual(position, -1, `${order[index]} is missing`);
    }
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  });

  test("puts a long dash in the name before the problems below it", () => {
    const draft = blankMilestone();
    draft.name = `A name ${LONG_DASH} with a long dash`;
    assert.equal(Object.keys(milestoneProblems(draft))[0], "name");
  });

  test("puts the API's problems in form order, numbers counted as numbers", () => {
    const ordered = inFormOrder({
      "forecasts.10.quote": "c",
      "forecasts.2.quote": "b",
      depends_on: "a",
      "summary.quote": "x",
      "summary.text": "y",
      disagreement_note: "z",
    });
    assert.deepEqual(Object.keys(ordered), [
      "summary.text",
      "summary.quote",
      "depends_on",
      "forecasts.2.quote",
      "forecasts.10.quote",
      // Not in the form, so last.
      "disagreement_note",
    ]);
    assert.equal(ordered["forecasts.2.quote"], "b");
  });
});

describe("teamRangePatch", () => {
  test("a new team range starts without the confidence the milestone had stored", () => {
    // Like the WBE milestones in content/milestones.json: a confidence with no range.
    const draft = blankMilestone();
    draft.confidence = "low";
    const next = { ...draft, ...teamRangePatch(true) };
    assert.equal(next.confidence, null);
    assert.notEqual(next.estimate, null);
    assert.ok(milestoneProblems(next).confidence);
  });

  test("removing the range removes its confidence", () => {
    const next = { ...withRange(2040, 2060), ...teamRangePatch(false) };
    assert.equal(next.estimate, null);
    assert.equal(next.confidence, null);
  });
});

describe("the workbook's milestone fields", () => {
  const SAVE = { estimateChanged: false, editor: "Vilija", today: "2026-11-18" };

  // Like a WBE milestone after the workbook import: tab 1a's fields, no range, no bottleneck.
  function imported(): Milestone {
    const draft = blankMilestone();
    draft.id = "wbe-legal";
    draft.name = "Legal status";
    draft.status = "unclear";
    draft.status_basis = { text: "None", provenance: "team", source_ids: [] };
    const milestone = toMilestone(draft, SAVE);
    return {
      ...milestone,
      main_bottleneck: null,
      assessment_confidence: "low",
      applies_to: "All WBE uses",
      criterion_met: "Unclear (search incomplete)",
      evidence_entries: ["E005"],
      timing: "Not sourced",
      note: "Absence in the database is not evidence that no method exists.",
    };
  }

  test("the API's record keeps every field", () => {
    const stored = { ...imported(), _id: "wbe-legal", published: true, version: 3 };
    const loaded = milestoneFromApi(stored);
    assert.equal(loaded.assessment_confidence, "low");
    assert.equal(loaded.applies_to, "All WBE uses");
    assert.equal(loaded.criterion_met, "Unclear (search incomplete)");
    assert.deepEqual(loaded.evidence_entries, ["E005"]);
    assert.equal(loaded.timing, "Not sourced");
    assert.equal(loaded.note, "Absence in the database is not evidence that no method exists.");
    assert.equal(loaded.main_bottleneck, null);
  });

  test("an older record without them loads with empty values", () => {
    const { assessment_confidence, applies_to, criterion_met, evidence_entries, timing, note, ...older } = imported();
    void [assessment_confidence, applies_to, criterion_met, evidence_entries, timing, note];
    const loaded = milestoneFromApi(older);
    assert.equal(loaded.assessment_confidence, null);
    assert.equal(loaded.applies_to, null);
    assert.deepEqual(loaded.evidence_entries, []);
  });

  test("saving in admin keeps them, so an edit never drops the import's values", () => {
    const saved = toMilestone(toDraft(imported(), true), SAVE);
    assert.equal(saved.assessment_confidence, "low");
    assert.equal(saved.applies_to, "All WBE uses");
    assert.equal(saved.criterion_met, "Unclear (search incomplete)");
    assert.deepEqual(saved.evidence_entries, ["E005"]);
    assert.equal(saved.timing, "Not sourced");
    assert.equal(saved.note, "Absence in the database is not evidence that no method exists.");
  });

  test("an empty bottleneck loads as a blank claim, saves as none and blocks nothing", () => {
    const draft = toDraft(imported(), true);
    assert.equal(draft.main_bottleneck.text, "");
    assert.equal(milestoneProblems(draft)["main_bottleneck.text"], undefined);
    assert.equal(toMilestone(draft, SAVE).main_bottleneck, null);

    draft.main_bottleneck = { text: "  Regulatory and moral bottlenecks (S02)  ", provenance: "team", source_ids: [] };
    assert.deepEqual(toMilestone(draft, SAVE).main_bottleneck, {
      text: "Regulatory and moral bottlenecks (S02)",
      provenance: "team",
      source_ids: [],
    });
  });

  test("a half-filled bottleneck is still checked", () => {
    const draft = toDraft(imported(), true);
    draft.main_bottleneck = { text: "", provenance: "source", source_ids: ["s02"] };
    const problems = milestoneProblems(draft);
    assert.equal(problems["main_bottleneck.text"], "Write the text.");
    assert.equal(problems["main_bottleneck.quote"], "Paste the exact words from the source.");
  });

  test("blank text fields save as null", () => {
    const draft = toDraft(imported(), true);
    draft.applies_to = "   ";
    draft.note = "";
    const saved = toMilestone(draft, SAVE);
    assert.equal(saved.applies_to, null);
    assert.equal(saved.note, null);
  });

  test("the workbook's confidence is not the team range's", () => {
    // Ticking or unticking the team range clears `confidence` only.
    const draft = toDraft(imported(), true);
    const withRangeOn = { ...draft, ...teamRangePatch(true) };
    assert.equal(withRangeOn.confidence, null);
    assert.equal(withRangeOn.assessment_confidence, "low");
    const withRangeOff = { ...withRangeOn, ...teamRangePatch(false) };
    assert.equal(toMilestone(withRangeOff, SAVE).assessment_confidence, "low");
  });

  test("the new fields sit in the form's order, next to the status", () => {
    const ordered = Object.keys(
      inFormOrder({ note: "e", "status_basis.text": "c", applies_to: "b", assessment_confidence: "a", timing: "d" }),
    );
    assert.deepEqual(ordered, ["assessment_confidence", "applies_to", "status_basis.text", "timing", "note"]);
  });
});
