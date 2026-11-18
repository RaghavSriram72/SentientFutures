import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readTriageConfigured } from "@/lib/api";

import { kindFilterApplies, kindFilterReadsDecision, kindFilterShown, readQueueFilters } from "../adminFormat";
import { describePublishProblem } from "../publishProblemText";

function params(query: string) {
  return new URLSearchParams(query);
}

describe("readQueueFilters", () => {
  test("keeps the kind filter where papers have an AI kind", () => {
    assert.equal(readQueueFilters(params("status=approved&kind=argument")).kind, "argument");
    assert.equal(kindFilterApplies("pending_review"), true);
  });

  // Nothing in New has been triaged, so a kind filter there always matched nothing.
  test("drops the kind filter in the New tab", () => {
    assert.equal(readQueueFilters(params("status=new&kind=argument")).kind, "");
    assert.equal(kindFilterApplies("new"), false);
  });
});

describe("kindFilterShown", () => {
  // Approved and Rejected filter on the decision's kind, so hand-added papers match there.
  test("reads the decision in Approved and Rejected, and is offered there with the AI off", () => {
    assert.equal(kindFilterReadsDecision("approved"), true);
    assert.equal(kindFilterReadsDecision("rejected"), true);
    assert.equal(kindFilterReadsDecision("pending_review"), false);
    assert.equal(kindFilterShown("approved", true), true);
    assert.equal(kindFilterShown("rejected", true), true);
  });

  test("hides the AI's kind in Pending review and Triaged out while the AI is off", () => {
    assert.equal(kindFilterShown("pending_review", false), true);
    assert.equal(kindFilterShown("triaged_out", false), true);
    assert.equal(kindFilterShown("pending_review", true), false);
    assert.equal(kindFilterShown("triaged_out", true), false);
  });

  // null: the pipeline status hasn't said yet whether the AI is on.
  test("waits for the pipeline status in Pending review and Triaged out", () => {
    assert.equal(kindFilterShown("pending_review", null), false);
    assert.equal(kindFilterShown("triaged_out", null), false);
    assert.equal(kindFilterShown("approved", null), true);
    assert.equal(kindFilterShown("rejected", null), true);
  });

  test("never shows it in New", () => {
    assert.equal(kindFilterShown("new", false), false);
    assert.equal(kindFilterShown("new", true), false);
  });
});

describe("readTriageConfigured", () => {
  test("passes a yes or no through", () => {
    assert.equal(readTriageConfigured(true), true);
    assert.equal(readTriageConfigured(false), false);
  });

  // The GitHub runner keeps its key as a GitHub secret, so the API sends null.
  test("treats anything else as unknown", () => {
    assert.equal(readTriageConfigured(null), null);
    assert.equal(readTriageConfigured(undefined), null);
  });
});

describe("describePublishProblem", () => {
  test("turns the common validator lines into sentences", () => {
    assert.equal(describePublishProblem("year: Input should be a valid integer (got null)"), "The paper has no publication year.");
    assert.equal(
      describePublishProblem("year: Input should be greater than or equal to 1800 (got 1200)"),
      "The publication year doesn't look right.",
    );
    assert.equal(describePublishProblem('url: must not be empty (got "")'), "The paper has no web link that starts with https:// or http://.");
    assert.equal(describePublishProblem('title: must not be empty (got "")'), "The paper has no title.");
  });

  test("leaves anything else as the export wrote it", () => {
    const line = "No approving review was found for this source.";
    assert.equal(describePublishProblem(line), line);
  });
});
