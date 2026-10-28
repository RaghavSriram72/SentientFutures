import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { logLinesInLocalTime } from "../adminFormat";
import { isIsoDate, isSlug, LONG_DASH, slugify, todayIso, withoutPrefix } from "../editorModel";
import { blankClaim, blankMilestone, milestoneProblems, pathLabel, toMilestone, tidyClaim } from "../milestoneModel";

describe("slugs and dates", () => {
  test("slugify makes an address from a title", () => {
    assert.equal(slugify("Why we show every forecast!"), "why-we-show-every-forecast");
    assert.equal(slugify("  Émulation & ethics  "), "emulation-ethics");
    assert.equal(isSlug(slugify("A title, with: punctuation")), true);
  });

  test("isIsoDate wants a real YYYY-MM-DD day", () => {
    assert.equal(isIsoDate("2026-10-27"), true);
    assert.equal(isIsoDate("2026-02-30"), false);
    assert.equal(isIsoDate("27/10/2026"), false);
    assert.equal(todayIso(new Date(2026, 0, 5)), "2026-01-05");
  });

  test("withoutPrefix drops the request body's own name", () => {
    assert.equal(withoutPrefix("milestone.forecasts.0.quote", "milestone"), "forecasts.0.quote");
    assert.equal(withoutPrefix("published", "milestone"), "published");
  });
});

describe("milestoneProblems", () => {
  test("a blank milestone asks for its id, name and the text of each claim", () => {
    const errors = milestoneProblems(blankMilestone());
    assert.ok(errors.id);
    assert.ok(errors.name);
    assert.ok(errors["summary.text"]);
    assert.ok(errors["would_move_earlier.0.text"]);
  });

  test("a source claim needs a source and a quote of 300 characters at most", () => {
    const draft = blankMilestone();
    draft.summary = { text: "A sentence.", provenance: "source", source_ids: [], quote: "x".repeat(301) };
    const errors = milestoneProblems(draft);
    assert.ok(errors["summary.source_ids"]);
    assert.match(errors["summary.quote"], /301 characters/);
  });

  test("unclear needs a reason, and other needs a note", () => {
    const draft = blankMilestone();
    draft.summary = { text: "Unknown.", provenance: "unclear", unclear_reason: "other", unclear_note: "" };
    assert.ok(milestoneProblems(draft)["summary.unclear_note"]);
  });

  test("a team range needs a start year and a confidence", () => {
    const draft = blankMilestone();
    draft.estimate = { earliest: null, latest: 2040, basis: blankClaim(), set_by: "", set_on: "" };
    const errors = milestoneProblems(draft);
    assert.ok(errors["estimate.earliest"]);
    assert.ok(errors.confidence);
  });

  test("a forecast needs a year unless it says never", () => {
    const draft = blankMilestone();
    draft.forecasts = [
      { id: "forecast-1", source_id: "s", forecaster: "A", claim: "c", quote: "q", made_in: 2020, earliest: null, latest: null, never: false },
      { id: "forecast-2", source_id: "s", forecaster: "B", claim: "c", quote: "q", made_in: 2020, earliest: null, latest: null, never: true },
    ];
    const errors = milestoneProblems(draft);
    assert.ok(errors["forecasts.0.earliest"]);
    assert.equal(errors["forecasts.1.earliest"], undefined);
  });

  test("long dashes are caught where they are", () => {
    const draft = blankMilestone();
    draft.name = `Before ${LONG_DASH} after`;
    assert.match(milestoneProblems(draft).name, /long dash/);
  });
});

describe("toMilestone", () => {
  test("keeps only the fields each provenance uses", () => {
    const claim = tidyClaim({ text: " Our read. ", provenance: "team", source_ids: ["s1"], quote: "left over", unclear_note: "x" });
    assert.deepEqual(claim, { text: "Our read.", provenance: "team", source_ids: ["s1"] });
  });

  test("signs a changed team range, and drops confidence without one", () => {
    const draft = blankMilestone();
    draft.confidence = "low";
    assert.equal(toMilestone(draft, { estimateChanged: false, editor: "Raghav", today: "2026-10-27" }).confidence, null);

    draft.estimate = { earliest: 2030, latest: null, basis: blankClaim(), set_by: "Someone", set_on: "2026-01-01" };
    const kept = toMilestone(draft, { estimateChanged: false, editor: "Raghav", today: "2026-10-27" });
    assert.equal(kept.estimate?.set_by, "Someone");
    const changed = toMilestone(draft, { estimateChanged: true, editor: "Raghav", today: "2026-10-27" });
    assert.equal(changed.estimate?.set_by, "Raghav");
    assert.equal(changed.estimate?.set_on, "2026-10-27");
    assert.equal(changed.confidence, "low");
  });
});

describe("pathLabel", () => {
  test("names a field path in words", () => {
    assert.equal(pathLabel("forecasts.0.quote"), "Forecast 1, quote");
    assert.equal(pathLabel("would_move_later.1.unclear_reason"), "What would push it later 2, reason");
  });
});

describe("logLinesInLocalTime", () => {
  test("converts each UTC time and rolls over midnight", () => {
    const format = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const lines = logLinesInLocalTime(["23:59:50 Started.", "00:00:10 Still going.", "no time here"], "2026-10-27T23:59:49Z");
    assert.equal(lines[0], `${format.format(new Date("2026-10-27T23:59:50Z"))} Started.`);
    assert.equal(lines[1], `${format.format(new Date("2026-10-28T00:00:10Z"))} Still going.`);
    assert.equal(lines[2], "no time here");
  });
});
