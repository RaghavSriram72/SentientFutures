// Small builders for the records the review tests need. Each one fills in
// every required field, so a test only spells out what it's about.
import type { AiAssessment, Review, ReviewFinal, TriageResult } from "@/lib/adminTypes";

import { emptyRubric, type DecisionDraft } from "../reviewModel";

export function triageResult(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    relevant: "yes",
    kind: "argument",
    technology: ["bci"],
    problem: "alignment",
    claim_directions: ["ai_alignment"],
    milestone_ids: [],
    evidence: [],
    ...overrides,
  };
}

export function assessment(id: string, parsed: TriageResult | null = triageResult()): AiAssessment {
  return {
    id,
    source_id: "arxiv-2401.00001",
    run_id: "run-1",
    model: "claude-haiku-5-5",
    effort: "low",
    prompt_version: "triage_v1-aaaa1111",
    rubric_version: "v0.1",
    created_at: "2026-10-27T10:00:00+00:00",
    stop_reason: "end_turn",
    raw_output: "{}",
    parsed,
    quote_checks: {},
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    cost_usd: 0,
  };
}

export function reviewFinal(overrides: Partial<ReviewFinal> = {}): ReviewFinal {
  return {
    kind: null,
    technology: [],
    problem: null,
    claim_directions: [],
    summary: null,
    source_type: null,
    evidence_type: null,
    directness: null,
    independence: null,
    relevance: null,
    credibility: null,
    ...overrides,
  };
}

export function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "review-1",
    source_id: "arxiv-2401.00001",
    assessment_id: "assessment-1",
    reviewer: "raghav@example.com",
    reviewer_name: "Raghav",
    decision: "approve",
    reject_reason: null,
    final: reviewFinal(),
    compared_fields: [],
    changed_fields: [],
    ai_values_used: [],
    notes: "",
    prompt_version: "triage_v1-aaaa1111",
    rubric_version: "v0.1",
    created_at: "2026-10-27T11:00:00+00:00",
    ...overrides,
  };
}

export function draft(overrides: Partial<DecisionDraft> = {}): DecisionDraft {
  return {
    summary: "",
    sourceType: "",
    rubric: emptyRubric(),
    credibilityReason: "",
    generalBackground: false,
    notes: "",
    rejectReason: "",
    ...overrides,
  };
}
