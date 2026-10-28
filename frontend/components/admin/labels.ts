// Labels for the pipeline's own categories. These aren't public, so they live
// here instead of in shared/sf_shared/enums.py. Public categories (kind,
// technology, the rubric) come from lib/enums.ts.
import type { EnumName } from "@/lib/enums";
import type {
  CandidateFlag,
  Collector,
  EvidenceField,
  RejectReason,
  Relevant,
  ReviewField,
  ReviewStatus,
  RunStage,
  RunStatus,
  RunTrigger,
  Runner,
  StageCounts,
} from "@/lib/adminTypes";

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  new: "New",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  triaged_out: "Triaged out",
};

// What each status means, in a few words, for the dashboard tiles.
export const REVIEW_STATUS_HINTS: Record<ReviewStatus, string> = {
  new: "Collected, waiting for the AI",
  pending_review: "Waiting for a person",
  approved: "Approved by the team",
  rejected: "Rejected by the team",
  triaged_out: "The AI said not relevant",
};

// The order of the queue tabs.
export const QUEUE_STATUSES: ReviewStatus[] = ["pending_review", "new", "approved", "rejected", "triaged_out"];

// The order of the dashboard tiles, following a paper through the pipeline.
export const DASHBOARD_STATUSES: ReviewStatus[] = ["new", "pending_review", "approved", "rejected", "triaged_out"];

export const FLAG_LABELS: Record<CandidateFlag, string> = {
  ai_failed: "AI call failed",
  spot_check: "Spot check",
  quote_mismatch: "Quote mismatch",
  no_abstract: "No abstract",
  possible_duplicate: "Possible duplicate",
};

export const FLAG_DESCRIPTIONS: Record<CandidateFlag, string> = {
  ai_failed: "The model refused, timed out or sent back something unusable, so a person has to sort this one from scratch.",
  spot_check: "The AI said this isn't relevant. It was picked at random for a person to check, so we can see how often the AI is wrong.",
  quote_mismatch: "The AI said this isn't relevant, but the quote it gave as the reason isn't in the title or abstract. A person checks it in case the AI misread the paper.",
  no_abstract: "There was no abstract, so the AI only had the title to go on.",
  possible_duplicate: "The title closely matches another source. Check it isn't the same paper.",
};

export const FLAGS: CandidateFlag[] = ["ai_failed", "spot_check", "quote_mismatch", "no_abstract", "possible_duplicate"];

export const COLLECTOR_LABELS: Record<Collector, string> = {
  arxiv: "arXiv",
  semantic_scholar: "Semantic Scholar",
  manual: "Added by hand",
};

export const RELEVANT_LABELS: Record<Relevant, string> = {
  yes: "Relevant",
  no: "Not relevant",
  unsure: "Unsure",
};

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  not_relevant: "Not relevant",
  duplicate: "Duplicate of a source we have",
  out_of_scope: "Out of scope",
  low_quality: "Low quality",
  other: "Something else (say what in the notes)",
};

export const REJECT_REASONS: RejectReason[] = ["not_relevant", "duplicate", "out_of_scope", "low_quality", "other"];

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  partial: "Finished with errors",
};

export const RUN_TRIGGER_LABELS: Record<RunTrigger, string> = {
  schedule: "Weekly schedule",
  admin: "Admin dashboard",
  cli: "Command line",
};

export const RUNNER_LABELS: Record<Runner, string> = {
  local: "Local",
  github: "GitHub Actions",
};

export const STAGE_LABELS: Record<RunStage, string> = {
  collect: "Collect",
  triage: "Triage",
};

export const STAGE_COUNT_LABELS: { key: keyof StageCounts; label: string; hint: string }[] = [
  { key: "fetched", label: "Fetched", hint: "Results the searches returned" },
  { key: "new", label: "New", hint: "Not seen before, saved as new" },
  { key: "duplicates", label: "Duplicates", hint: "Already in the database" },
  { key: "triaged", label: "Triaged", hint: "Read by the AI" },
  { key: "relevant", label: "Relevant", hint: "The AI said yes" },
  { key: "unsure", label: "Unsure", hint: "The AI wasn't sure, sent to a person" },
  { key: "triaged_out", label: "Triaged out", hint: "The AI said not relevant" },
  { key: "spot_checks", label: "Spot checks", hint: "Triaged out, but sampled for a person" },
  { key: "quote_mismatches", label: "Quote mismatches", hint: "The AI said no, but its quote isn't in the paper, so a person checks it" },
  { key: "failed", label: "Failed", hint: "The AI call didn't work, sent to a person" },
  { key: "skipped", label: "Skipped", hint: "Left for the next run (no API key or a limit was hit)" },
];

// A dry run saves no papers and calls no model, so these counts mean "would"
// there. The rest stay as they are (and are zero).
export const DRY_RUN_COUNT_LABELS: Partial<Record<keyof StageCounts, { label: string; hint: string }>> = {
  new: { label: "New", hint: "Not seen before. A dry run doesn't save them" },
  triaged: { label: "Would triage", hint: "Not sent to the AI (dry run)" },
};

export const FIELD_LABELS: Record<EvidenceField, string> = {
  relevant: "Relevant",
  kind: "Kind",
  technology: "Technology",
  problem: "Problem",
  claim_directions: "Claim direction",
};

export const REVIEW_FIELDS: ReviewField[] = ["kind", "technology", "problem", "claim_directions"];

// Which shared enum holds each review field's values.
export const FIELD_ENUMS: Record<ReviewField, EnumName> = {
  kind: "SourceKind",
  technology: "Technology",
  problem: "Problem",
  claim_directions: "ClaimDirection",
};
