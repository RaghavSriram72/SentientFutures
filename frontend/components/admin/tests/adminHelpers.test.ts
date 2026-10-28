import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readTriageConfigured } from "@/lib/api";

import { kindFilterApplies, readQueueFilters } from "../adminFormat";
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
