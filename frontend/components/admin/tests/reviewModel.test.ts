import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ReAdd } from "@/lib/adminTypes";
import { queueItemDetailFrom } from "@/lib/api";

import {
  aiFieldValues,
  buildReviewRequest,
  currentAssessment,
  decisionRecordNewestFirst,
  emptyFieldValues,
  isUsingAi,
  paperLinks,
  reAddChangesText,
  startingFields,
  type FieldValues,
} from "../reviewModel";
import { assessment, candidate, draft, review, reviewFinal, triageResult } from "./fixtures";

const AI_VALUES: FieldValues = aiFieldValues(triageResult());

describe("rejecting after Use AI value", () => {
  // The API refuses a rejection that lists AI values (400 ai_values_mismatch).
  test("a rejection sends no AI values, even after Use AI value was pressed", () => {
    const values = { ...emptyFieldValues(), kind: ["argument"] };
    const body = buildReviewRequest({
      decision: "reject",
      values,
      draft: draft({ rejectReason: "not_relevant" }),
      aiUsed: ["kind"],
      aiValues: AI_VALUES,
      assessmentId: "assessment-1",
      replacesReviewId: null,
    });
    assert.deepEqual(body.ai_values_used, []);
    assert.equal(body.reject_reason, "not_relevant");
  });

  test("changing an AI-assisted approval to a rejection sends no AI values", () => {
    const approval = review({
      decision: "approve",
      final: reviewFinal({ kind: "argument", summary: "Ours.", source_type: "preprint" }),
      ai_values_used: ["kind"],
    });
    const start = startingFields(approval, AI_VALUES);
    // The form starts with Use AI value still pressed on kind.
    assert.deepEqual(start.aiUsed, ["kind"]);

    const body = buildReviewRequest({
      decision: "reject",
      values: start.values,
      draft: draft({ rejectReason: "out_of_scope" }),
      aiUsed: start.aiUsed,
      aiValues: AI_VALUES,
      assessmentId: "assessment-1",
      replacesReviewId: approval.id,
    });
    assert.deepEqual(body.ai_values_used, []);
    assert.equal(body.replaces_review_id, "review-1");
  });

  test("an approval still sends the AI values it kept", () => {
    const values = { ...emptyFieldValues(), kind: ["argument"], technology: ["bci"] };
    const body = buildReviewRequest({
      decision: "approve",
      values,
      draft: draft({ summary: "Ours.", sourceType: "preprint" }),
      aiUsed: ["technology", "kind"],
      aiValues: AI_VALUES,
      assessmentId: "assessment-1",
      replacesReviewId: null,
    });
    // In field order, whatever order the buttons were pressed in.
    assert.deepEqual(body.ai_values_used, ["kind", "technology"]);
    assert.equal(body.reject_reason, undefined);
    assert.equal(body.replaces_review_id, undefined);
  });
});

describe("isUsingAi", () => {
  test("stops counting when the value no longer matches the AI's", () => {
    const values = { ...emptyFieldValues(), kind: ["argument"] };
    assert.equal(isUsingAi("kind", ["kind"], values, AI_VALUES), true);
    // A newer assessment, loaded after a 409, says something else.
    const newer = aiFieldValues(triageResult({ kind: "milestone_evidence" }));
    assert.equal(isUsingAi("kind", ["kind"], values, newer), false);
  });

  test("needs an AI value to use", () => {
    assert.equal(isUsingAi("kind", ["kind"], emptyFieldValues(), null), false);
    const noKind = aiFieldValues(triageResult({ kind: null }));
    assert.equal(isUsingAi("kind", ["kind"], emptyFieldValues(), noKind), false);
  });
});

describe("startingFields", () => {
  test("a new review starts empty", () => {
    const start = startingFields(null, AI_VALUES);
    assert.deepEqual(start.values, emptyFieldValues());
    assert.deepEqual(start.aiUsed, []);
    assert.deepEqual(start.touched, []);
  });

  test("changing an approval starts from its values", () => {
    const approval = review({
      final: reviewFinal({ kind: "argument", technology: ["wbe"], problem: "both" }),
      ai_values_used: ["kind"],
    });
    const start = startingFields(approval, AI_VALUES);
    assert.deepEqual(start.values.kind, ["argument"]);
    assert.deepEqual(start.values.technology, ["wbe"]);
    assert.deepEqual(start.aiUsed, ["kind"]);
    assert.equal(start.touched.length, 4);
  });

  test("Use AI value doesn't carry over when the AI now says something else", () => {
    const approval = review({ final: reviewFinal({ kind: "argument" }), ai_values_used: ["kind"] });
    const newer = aiFieldValues(triageResult({ kind: "milestone_evidence" }));
    assert.deepEqual(startingFields(approval, newer).aiUsed, []);
  });

  // A rejection keeps no AI values, so its field values may have come from the
  // AI unmarked. Starting from them would publish them as the team's choice.
  test("changing a rejection starts the categories empty", () => {
    const rejection = review({
      decision: "reject",
      reject_reason: "not_relevant",
      final: reviewFinal({ kind: "argument", technology: ["bci"] }),
    });
    const start = startingFields(rejection, AI_VALUES);
    assert.deepEqual(start.values, emptyFieldValues());
    assert.deepEqual(start.aiUsed, []);
    assert.deepEqual(start.touched, []);
  });
});

describe("currentAssessment", () => {
  // The API compares against current_assessment_id only. Falling back to the
  // newest assessment made every submit fail with 409 assessment_changed.
  test("is null when the source points at no assessment, even if older ones exist", () => {
    const detail = queueItemDetailFrom({
      candidate: { id: "arxiv-2401.00001", current_assessment_id: null },
      current_assessment: null,
      assessments: [assessment("assessment-1")],
      reviews: [],
    });
    assert.equal(currentAssessment(detail), null);
    assert.equal(detail.assessments.length, 1);

    const body = buildReviewRequest({
      decision: "reject",
      values: emptyFieldValues(),
      draft: draft({ rejectReason: "not_relevant" }),
      aiUsed: [],
      aiValues: null,
      assessmentId: currentAssessment(detail)?.id ?? null,
      replacesReviewId: null,
    });
    assert.equal(body.assessment_id, null);
  });

  test("is the one the API names as current", () => {
    const detail = queueItemDetailFrom({
      candidate: { id: "arxiv-2401.00001", current_assessment_id: "assessment-1" },
      current_assessment: assessment("assessment-1"),
      assessments: [assessment("assessment-2"), assessment("assessment-1")],
      reviews: [],
    });
    assert.equal(currentAssessment(detail)?.id, "assessment-1");
  });
});

describe("paperLinks", () => {
  // The labels are the only place the review page shows the paper's ids.
  test("keeps the DOI and arXiv links when the paper's own link is the same page", () => {
    const arxivPaper = candidate({ url: "https://arxiv.org/abs/2501.99999", arxiv_id: "2501.99999" });
    assert.deepEqual(paperLinks(arxivPaper).map((link) => link.label), ["Open the paper", "arXiv 2501.99999"]);

    const doiPaper = candidate({ url: "https://doi.org/10.5555/abc", doi: "10.5555/abc", arxiv_id: null });
    assert.deepEqual(paperLinks(doiPaper).map((link) => link.label), ["Open the paper", "DOI 10.5555/abc"]);
  });

  test("drops a Semantic Scholar link that repeats the paper's own link", () => {
    const s2Paper = candidate({
      url: "https://www.semanticscholar.org/paper/abc123",
      arxiv_id: null,
      s2_id: "abc123",
    });
    assert.deepEqual(paperLinks(s2Paper).map((link) => link.label), ["Open the paper"]);
  });
});

describe("a paper added again", () => {
  function reAdd(overrides: Partial<ReAdd> = {}): ReAdd {
    return {
      id: "re-add-1",
      added_by: "raghav@example.com",
      added_by_name: "Raghav",
      added_at: "2026-10-28T15:52:00Z",
      changed: ["url"],
      ...overrides,
    };
  }

  test("comes back from the API with the paper's record", () => {
    const detail = queueItemDetailFrom({
      candidate: { id: "manual-paper" },
      reviews: [],
      re_adds: [{ id: "re-add-1", added_by: "raghav@example.com", added_by_name: "Raghav", added_at: "x", changed: ["title", "url"] }],
    });
    assert.equal(detail.re_adds.length, 1);
    // Always in the order link, title, year.
    assert.deepEqual(detail.re_adds[0].changed, ["url", "title"]);
    assert.deepEqual(queueItemDetailFrom({ candidate: { id: "manual-paper" } }).re_adds, []);
  });

  // "Added again by Raghav · 28 Oct 2026, 15:52 · link changed" sits above the rejection it undid.
  test("is listed with the decisions, newest first", () => {
    const rejection = review({ id: "review-1", decision: "reject", created_at: "2026-10-28T15:40:00Z" });
    const record = decisionRecordNewestFirst([rejection], [reAdd()]);
    assert.deepEqual(
      record.map((item) => item.kind),
      ["re_add", "review"],
    );
  });

  test("counts as newer than a rejection saved at the same moment", () => {
    const rejection = review({ id: "review-1", decision: "reject", created_at: "2026-10-28T15:52:00Z" });
    const record = decisionRecordNewestFirst([rejection], [reAdd({ added_at: "2026-10-28T15:52:00Z" })]);
    assert.deepEqual(
      record.map((item) => item.kind),
      ["re_add", "review"],
    );
  });

  test("names what changed", () => {
    assert.equal(reAddChangesText(["url"]), "link changed");
    assert.equal(reAddChangesText(["url", "title"]), "link and title changed");
    assert.equal(reAddChangesText(["url", "title", "year"]), "link, title and year changed");
    assert.equal(reAddChangesText([]), "");
  });
});
