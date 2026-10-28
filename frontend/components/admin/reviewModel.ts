// The review form's data, kept apart from the screen so the rules are easy to read.
//
// Each of the four compared fields is held as a list of enum values, even the
// single-choice ones (kind, problem hold zero or one). That keeps "use the AI's
// value" and "did the reviewer change it" the same code for every field.
import type {
  AiAssessment,
  Candidate,
  Decision,
  FieldEvidence,
  QueueItemDetail,
  RejectReason,
  Review,
  ReviewField,
  ReviewFinal,
  ReviewRequest,
  TriageResult,
} from "@/lib/adminTypes";
import { enumValues, type EnumName } from "@/lib/enums";
import type {
  ClaimDirection,
  Credibility,
  Directness,
  EvidenceType,
  Independence,
  Problem,
  Relevance,
  SourceKind,
  SourceType,
  Technology,
  UnclearReason,
} from "@/lib/types";

import { FIELD_ENUMS, REVIEW_FIELDS } from "./labels";

export type FieldValues = Record<ReviewField, string[]>;

export function isSingleValue(field: ReviewField): boolean {
  return field === "kind" || field === "problem";
}

export function emptyFieldValues(): FieldValues {
  return { kind: [], technology: [], problem: [], claim_directions: [] };
}

// The four compared fields of a saved decision, in the form's shape.
export function finalFieldValues(final: ReviewFinal): FieldValues {
  return {
    kind: final.kind ? [final.kind] : [],
    technology: [...final.technology],
    problem: final.problem ? [final.problem] : [],
    claim_directions: [...final.claim_directions],
  };
}

export function aiFieldValues(parsed: TriageResult): FieldValues {
  return {
    kind: parsed.kind ? [parsed.kind] : [],
    technology: [...parsed.technology],
    problem: parsed.problem ? [parsed.problem] : [],
    claim_directions: [...parsed.claim_directions],
  };
}

// Puts values in the order the enum lists them, so a saved review doesn't
// depend on the order someone clicked the checkboxes.
export function inEnumOrder(field: ReviewField, values: string[]): string[] {
  const ordered: string[] = [];
  for (const info of enumValues(FIELD_ENUMS[field])) {
    if (values.includes(info.value)) {
      ordered.push(info.value);
    }
  }
  return ordered;
}

export function sameValues(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (const value of a) {
    if (!b.includes(value)) {
      return false;
    }
  }
  return true;
}

export function evidenceFor(parsed: TriageResult, field: FieldEvidence["field"]): FieldEvidence | null {
  for (const evidence of parsed.evidence) {
    if (evidence.field === field) {
      return evidence;
    }
  }
  return null;
}

function newestFirst<T extends { created_at: string }>(items: T[]): T[] {
  const copy = [...items];
  copy.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return copy;
}

export function assessmentsNewestFirst(detail: QueueItemDetail): AiAssessment[] {
  return newestFirst(detail.assessments);
}

export function reviewsNewestFirst(detail: QueueItemDetail): Review[] {
  return newestFirst(detail.reviews);
}

// The assessment a review compares against: the one the source points at.
// When it points at none, there's nothing to compare against, even if older
// assessments exist (a run can stop between saving an assessment and
// attaching it). The API makes the same choice, so the AI column, "Use AI
// value" and the API's check all refer to the same record. Every assessment
// still shows in the record at the bottom of the page.
export function currentAssessment(detail: QueueItemDetail): AiAssessment | null {
  return detail.current_assessment;
}

// Paper metadata comes from outside, so only plain web links get rendered.
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const trimmed = url.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }
  return null;
}

export function paperLinks(source: Candidate): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  const main = safeExternalUrl(source.url);
  if (main) {
    links.push({ href: main, label: "Open the paper" });
  }
  if (source.doi) {
    links.push({ href: `https://doi.org/${encodeURI(source.doi)}`, label: `DOI ${source.doi}` });
  }
  if (source.arxiv_id) {
    links.push({ href: `https://arxiv.org/abs/${encodeURIComponent(source.arxiv_id)}`, label: `arXiv ${source.arxiv_id}` });
  }
  if (source.s2_id) {
    links.push({
      href: `https://www.semanticscholar.org/paper/${encodeURIComponent(source.s2_id)}`,
      label: "Semantic Scholar",
    });
  }
  // The paper's own link is often its arXiv page. Keep the first of any repeats.
  const unique: { href: string; label: string }[] = [];
  for (const link of links) {
    let seen = false;
    for (const kept of unique) {
      if (kept.href === link.href) {
        seen = true;
      }
    }
    if (!seen) {
      unique.push(link);
    }
  }
  return unique;
}

// ---------- The rubric ----------

export type RubricKey = "evidence_type" | "directness" | "independence" | "relevance" | "credibility";

export const RUBRIC_FIELDS: { key: RubricKey; enumName: EnumName; label: string }[] = [
  { key: "evidence_type", enumName: "EvidenceType", label: "Evidence type" },
  { key: "directness", enumName: "Directness", label: "Directness" },
  { key: "independence", enumName: "Independence", label: "Independence" },
  { key: "relevance", enumName: "Relevance", label: "Relevance" },
  { key: "credibility", enumName: "Credibility", label: "Credibility" },
];

// "" means "Not rated yet".
export type RubricValues = Record<RubricKey, string>;

export function emptyRubric(): RubricValues {
  return { evidence_type: "", directness: "", independence: "", relevance: "", credibility: "" };
}

export function rubricFrom(final: ReviewFinal): RubricValues {
  return {
    evidence_type: final.evidence_type ?? "",
    directness: final.directness ?? "",
    independence: final.independence ?? "",
    relevance: final.relevance ?? "",
    credibility: final.credibility ?? "",
  };
}

// Why credibility is unclear, for the picker that appears with an "unclear"
// rating (the public source needs one). "other" isn't offered: it needs a written note,
// and public sources have no field for one.
export function credibilityReasons(): { value: UnclearReason; label: string }[] {
  const reasons: { value: UnclearReason; label: string }[] = [];
  for (const info of enumValues("UnclearReason")) {
    if (info.value !== "other") {
      reasons.push({ value: info.value as UnclearReason, label: info.label });
    }
  }
  return reasons;
}

// ---------- Where the form starts ----------

// Whether a field still holds the AI's value from "Use AI value". It stops
// counting once the reviewer edits the field, and when a newer assessment
// (after "Load the latest") says something else.
export function isUsingAi(
  field: ReviewField,
  aiUsed: ReviewField[],
  values: FieldValues,
  aiValues: FieldValues | null,
): boolean {
  if (!aiUsed.includes(field) || aiValues === null || aiValues[field].length === 0) {
    return false;
  }
  return sameValues(values[field], aiValues[field]);
}

export interface StartingFields {
  values: FieldValues;
  // Fields that start with "Use AI value" pressed.
  aiUsed: ReviewField[];
  // Fields that start out set by a person, so the table compares them right away.
  touched: ReviewField[];
}

// Where the four compared fields start.
//
// A new review starts empty, so reviewers form their own view before they
// see what agreeing with the AI would look like.
//
// Changing an approval starts from it, with "Use AI value" still pressed on
// the fields where it was pressed and the AI still says the same.
//
// Changing a rejection starts empty too. A rejection keeps no record of AI
// values, so its field values may have come from the AI without saying so,
// and an approval built on them would publish them as the team's own choice.
export function startingFields(replacing: Review | null, aiValues: FieldValues | null): StartingFields {
  if (replacing === null || replacing.decision !== "approve") {
    return { values: emptyFieldValues(), aiUsed: [], touched: [] };
  }
  const values = finalFieldValues(replacing.final);
  const aiUsed: ReviewField[] = [];
  for (const field of REVIEW_FIELDS) {
    if (replacing.ai_values_used.includes(field) && isUsingAi(field, [field], values, aiValues)) {
      aiUsed.push(field);
    }
  }
  return { values, aiUsed, touched: [...REVIEW_FIELDS] };
}

// ---------- Building the request ----------

export interface DecisionDraft {
  summary: string;
  sourceType: SourceType | "";
  rubric: RubricValues;
  // Only used when credibility is "unclear".
  credibilityReason: UnclearReason | "";
  // The paper is background for the whole project, not about one technology.
  generalBackground: boolean;
  notes: string;
  rejectReason: RejectReason | "";
}

function orNull<T extends string>(value: string): T | null {
  return value === "" ? null : (value as T);
}

export function buildFinal(values: FieldValues, draft: DecisionDraft): ReviewFinal {
  const summary = draft.summary.trim();
  const final: ReviewFinal = {
    kind: orNull<SourceKind>(values.kind[0] ?? ""),
    technology: values.technology as Technology[],
    problem: orNull<Problem>(values.problem[0] ?? ""),
    claim_directions: values.claim_directions as ClaimDirection[],
    summary: summary === "" ? null : summary,
    source_type: orNull<SourceType>(draft.sourceType),
    evidence_type: orNull<EvidenceType>(draft.rubric.evidence_type),
    directness: orNull<Directness>(draft.rubric.directness),
    independence: orNull<Independence>(draft.rubric.independence),
    relevance: orNull<Relevance>(draft.rubric.relevance),
    credibility: orNull<Credibility>(draft.rubric.credibility),
  };
  // Sent only with an "unclear" rating, the one time it means anything.
  if (draft.rubric.credibility === "unclear") {
    final.credibility_unclear_reason = orNull<UnclearReason>(draft.credibilityReason);
  }
  // Only meaningful with no technology picked; the form keeps the two apart.
  if (draft.generalBackground && values.technology.length === 0) {
    final.general_background = true;
  }
  return final;
}

export interface ReviewInput {
  decision: Decision;
  values: FieldValues;
  draft: DecisionDraft;
  // Fields where the reviewer pressed "Use AI value".
  aiUsed: ReviewField[];
  aiValues: FieldValues | null;
  // The assessment on screen, or null when there's none to compare against.
  assessmentId: string | null;
  // When changing a decision: the review being replaced.
  replacesReviewId: string | null;
}

// The body for POST /queue/<id>/review.
export function buildReviewRequest(input: ReviewInput): ReviewRequest {
  // Only approvals keep AI values. A rejection isn't a judgment of the AI's
  // categories, so the API refuses one that lists any, and the override
  // stats leave rejections out. Pressing "Use AI value" and then rejecting
  // is normal, so those presses are dropped here instead.
  const aiValuesUsed: ReviewField[] = [];
  if (input.decision === "approve") {
    for (const field of REVIEW_FIELDS) {
      if (isUsingAi(field, input.aiUsed, input.values, input.aiValues)) {
        aiValuesUsed.push(field);
      }
    }
  }

  const body: ReviewRequest = {
    decision: input.decision,
    final: buildFinal(input.values, input.draft),
    ai_values_used: aiValuesUsed,
    notes: input.draft.notes.trim(),
    assessment_id: input.assessmentId,
  };
  if (input.decision === "reject" && input.draft.rejectReason !== "") {
    body.reject_reason = input.draft.rejectReason;
  }
  if (input.replacesReviewId !== null) {
    body.replaces_review_id = input.replacesReviewId;
  }
  return body;
}
