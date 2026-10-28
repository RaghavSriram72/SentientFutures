"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { AiAssessment, QueueItemDetail, Review, ReviewFinal } from "@/lib/adminTypes";
import { enumLabel, type EnumName } from "@/lib/enums";

import { formatCost, formatCount, formatDateTime, runHref } from "./adminFormat";
import { QuoteCheck } from "./Chips";
import { FIELD_LABELS, REJECT_REASON_LABELS, RELEVANT_LABELS, REVIEW_FIELDS, FIELD_ENUMS } from "./labels";
import styles from "./Review.module.css";
import { aiFieldValues, assessmentsNewestFirst, evidenceFor, reviewsNewestFirst, RUBRIC_FIELDS } from "./reviewModel";

function labelsFor(enumName: EnumName, values: string[], empty: string): string {
  if (values.length === 0) {
    return empty;
  }
  const labels: string[] = [];
  for (const value of values) {
    labels.push(enumLabel(enumName, value));
  }
  return labels.join(", ");
}

function fieldNames(fields: string[]): string {
  if (fields.length === 0) {
    return "None";
  }
  const names: string[] = [];
  for (const field of fields) {
    names.push(FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field);
  }
  return names.join(", ");
}

function finalValues(final: ReviewFinal, field: (typeof REVIEW_FIELDS)[number]): string[] {
  if (field === "kind") {
    return final.kind ? [final.kind] : [];
  }
  if (field === "problem") {
    return final.problem ? [final.problem] : [];
  }
  if (field === "technology") {
    return final.technology;
  }
  return final.claim_directions;
}

// Everything kept about a paper: each human decision and each AI call, exactly
// as saved. These records are never edited, so this is the audit trail.
export function AuditTrail({ detail, currentAssessmentId }: { detail: QueueItemDetail; currentAssessmentId: string | null }) {
  const reviews = reviewsNewestFirst(detail);
  const assessments = assessmentsNewestFirst(detail);

  return (
    <section className={styles.section} aria-labelledby="record-heading">
      <h2 id="record-heading" className={styles.sectionTitle}>
        The <em>record</em>
      </h2>
      <p className={styles.sectionNote}>
        Every decision and every AI assessment is kept as it was saved, so we can see where people and the AI
        disagree.
      </p>

      <h3 className={styles.recordHeading}>Decisions</h3>
      {reviews.length === 0 ? (
        <p className={styles.muted}>No decisions yet.</p>
      ) : (
        <ol className={styles.recordList}>
          {reviews.map((review) => (
            <li key={review.id}>
              <ReviewRecord review={review} current={review.id === detail.source.current_review_id} />
            </li>
          ))}
        </ol>
      )}

      <h3 className={styles.recordHeading}>AI assessments</h3>
      {assessments.length === 0 ? (
        <p className={styles.muted}>The AI hasn&rsquo;t looked at this paper.</p>
      ) : (
        <ol className={styles.recordList}>
          {assessments.map((assessment) => (
            <li key={assessment.id}>
              <AssessmentRecord assessment={assessment} current={assessment.id === currentAssessmentId} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.recordRow}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// current: this is the decision the paper's status comes from. Older ones were replaced.
function ReviewRecord({ review, current }: { review: Review; current: boolean }) {
  const verb = review.decision === "approve" ? "Approved" : "Rejected";
  const reason = review.reject_reason ? ` · ${REJECT_REASON_LABELS[review.reject_reason]}` : "";

  return (
    <details className={styles.record}>
      <summary className={styles.recordSummary}>
        {verb} by {review.reviewer_name} · {formatDateTime(review.created_at)}
        {reason}
        {current ? " · the current decision" : " · replaced"}
      </summary>
      <dl className={styles.recordBody}>
        {REVIEW_FIELDS.map((field) => (
          <Row key={field} label={FIELD_LABELS[field]}>
            {labelsFor(FIELD_ENUMS[field], finalValues(review.final, field), "Not set")}
          </Row>
        ))}
        <Row label="Summary">{review.final.summary || "None"}</Row>
        <Row label="Source type">
          {review.final.source_type ? enumLabel("SourceType", review.final.source_type) : "Not set"}
        </Row>
        {RUBRIC_FIELDS.map((item) => {
          const value = review.final[item.key];
          return (
            <Row key={item.key} label={item.label}>
              {value ? enumLabel(item.enumName, value) : "Not rated yet"}
            </Row>
          );
        })}
        <Row label="Compared with the AI">{fieldNames(review.compared_fields)}</Row>
        <Row label="Changed from the AI">{fieldNames(review.changed_fields)}</Row>
        <Row label="Kept the AI's value">{fieldNames(review.ai_values_used)}</Row>
        <Row label="Notes">{review.notes || "None"}</Row>
        <Row label="Reviewer">
          {review.reviewer_name} ({review.reviewer})
        </Row>
        <Row label="Versions">
          Prompt {review.prompt_version ?? "none"} · rubric {review.rubric_version}
        </Row>
      </dl>
    </details>
  );
}

function AssessmentRecord({ assessment, current }: { assessment: AiAssessment; current: boolean }) {
  const parsed = assessment.parsed;
  const verdict = parsed ? RELEVANT_LABELS[parsed.relevant] : "No usable answer";

  return (
    <details className={`${styles.record} ${styles.recordAi}`}>
      <summary className={styles.recordSummary}>
        {verdict} · {assessment.model} · {formatDateTime(assessment.created_at)}
        {current && " · the one compared above"}
      </summary>
      <dl className={styles.recordBody}>
        <Row label="Prompt version">{assessment.prompt_version}</Row>
        <Row label="Rubric version">{assessment.rubric_version}</Row>
        <Row label="Effort">{assessment.effort}</Row>
        <Row label="Run">
          {assessment.run_id ? <Link href={runHref(assessment.run_id)}>{assessment.run_id}</Link> : "Not part of a run"}
        </Row>
        <Row label="Stop reason">{assessment.stop_reason ?? "Not recorded"}</Row>
        {assessment.refusal_category && <Row label="Refusal">{assessment.refusal_category}</Row>}
        {assessment.error && <Row label="Error">{assessment.error}</Row>}
        <Row label="Tokens">
          {formatCount(assessment.usage.input_tokens)} in · {formatCount(assessment.usage.output_tokens)} out
        </Row>
        <Row label="Cost">{formatCost(assessment.cost_usd)}</Row>
      </dl>

      {parsed && (
        <dl className={styles.recordBody}>
          <Row label="Relevant">
            <EvidenceText assessment={assessment} field="relevant" value={RELEVANT_LABELS[parsed.relevant]} />
          </Row>
          {REVIEW_FIELDS.map((field) => (
            <Row key={field} label={FIELD_LABELS[field]}>
              <EvidenceText
                assessment={assessment}
                field={field}
                value={labelsFor(FIELD_ENUMS[field], aiFieldValues(parsed)[field], "Nothing chosen")}
              />
            </Row>
          ))}
          <Row label="Milestones">{parsed.milestone_ids.length > 0 ? parsed.milestone_ids.join(", ") : "None"}</Row>
        </dl>
      )}

      <p className="eyebrow">Raw output</p>
      <pre className={styles.rawOutput}>{assessment.raw_output || "(empty)"}</pre>
    </details>
  );
}

function EvidenceText({
  assessment,
  field,
  value,
}: {
  assessment: AiAssessment;
  field: keyof typeof FIELD_LABELS;
  value: string;
}) {
  const evidence = assessment.parsed ? evidenceFor(assessment.parsed, field) : null;
  return (
    <span className={styles.evidence}>
      <strong>{value}</strong>
      {evidence && <span>{evidence.reason}</span>}
      {evidence && evidence.quote && <span className={styles.quote}>&ldquo;{evidence.quote}&rdquo;</span>}
      {evidence && <QuoteCheck found={assessment.quote_checks[field]} />}
    </span>
  );
}
