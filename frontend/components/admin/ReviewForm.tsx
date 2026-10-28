"use client";

import { useRef, useState, type ReactNode } from "react";

import { DirectionGlyph, directionTone } from "@/components/sources/ClaimDirectionChip";
import type { AiAssessment, Candidate, Decision, FieldEvidence, RejectReason, Review, ReviewField } from "@/lib/adminTypes";
import { submitReview, toApiError, type ApiError } from "@/lib/api";
import { enumDescription, enumLabel, enumValues, isDraftEnum } from "@/lib/enums";
import type { ClaimDirection, SourceType, UnclearReason } from "@/lib/types";

import { AiChip, ChipRow, QuoteCheck } from "./Chips";
import forms from "./forms.module.css";
import { FIELD_ENUMS, FIELD_LABELS, REJECT_REASONS, REJECT_REASON_LABELS, REVIEW_FIELDS } from "./labels";
import { ApiErrorNotice, ErrorCode, Notice } from "./Notice";
import styles from "./Review.module.css";
import {
  aiFieldValues,
  buildReviewRequest,
  credibilityReasons,
  emptyRubric,
  evidenceFor,
  inEnumOrder,
  isSingleValue,
  isUsingAi,
  RUBRIC_FIELDS,
  rubricFrom,
  sameValues,
  startingFields,
  type DecisionDraft,
  type FieldValues,
} from "./reviewModel";
import { useUnsavedWork } from "./unsavedWork";

interface FormErrors {
  kind?: string;
  technology?: string;
  summary?: string;
  sourceType?: string;
  credibilityReason?: string;
  rejectReason?: string;
  notes?: string;
}

// The ids of the inputs each error belongs to, in page order, for moving focus.
const ERROR_TARGETS: { key: keyof FormErrors; id: string }[] = [
  { key: "kind", id: "field-kind-input" },
  { key: "technology", id: "field-technology-input" },
  { key: "summary", id: "review-summary" },
  { key: "sourceType", id: "review-source-type" },
  { key: "credibilityReason", id: "rubric-credibility-reason" },
  { key: "notes", id: "review-notes" },
  { key: "rejectReason", id: "reject-reason" },
];

// draft.generalBackground: the reviewer said the paper isn't about one
// technology, so an empty technology list is a choice, not something left out.
function checkDecision(decision: Decision, values: FieldValues, draft: DecisionDraft): FormErrors {
  const errors: FormErrors = {};
  // Without a kind or a technology an approved paper shows up under no filter
  // on the public site, so readers would never find it.
  if (decision === "approve" && values.kind.length === 0) {
    errors.kind = "Pick a kind before approving.";
  }
  if (decision === "approve" && values.technology.length === 0 && !draft.generalBackground) {
    errors.technology = "Pick at least one technology, or tick General background.";
  }
  if (decision === "approve" && draft.summary.trim() === "") {
    errors.summary = "Write the summary before approving. It's what readers see on the public site.";
  }
  if (decision === "approve" && draft.sourceType === "") {
    errors.sourceType = "Pick a source type before approving. Every public source needs one.";
  }
  if (decision === "approve" && draft.rubric.credibility === "unclear" && draft.credibilityReason === "") {
    errors.credibilityReason = "Say why credibility is unclear.";
  }
  if (decision === "reject" && draft.rejectReason === "") {
    errors.rejectReason = "Pick a reason for rejecting.";
  }
  if (decision === "reject" && draft.rejectReason === "other" && draft.notes.trim() === "") {
    errors.notes = "Say in the notes why you're rejecting it.";
  }
  return errors;
}

function without(fields: ReviewField[], field: ReviewField): ReviewField[] {
  const kept: ReviewField[] = [];
  for (const item of fields) {
    if (item !== field) {
      kept.push(item);
    }
  }
  return kept;
}

// 409s that mean the paper changed while the reviewer had it open. Each is
// fixed by loading the latest version and deciding again, so the form offers
// that instead of the API's "Reload" advice, which would lose what was typed.
// It can be the same reviewer in another tab, so none of these says "someone else".
const CHANGED_WHILE_OPEN: Record<string, string> = {
  assessment_changed: "A new AI assessment arrived while you were reviewing.",
  review_changed: "This decision was changed in another tab or by another reviewer while you had it open.",
  not_reviewable: "This paper was decided in another tab or by another reviewer while you had it open.",
  conflict: "This paper changed in another tab or by another reviewer while you had it open.",
};

// The API's own copies of the form's checks, mapped back to their fields in
// case the two ever disagree.
const API_FIELD_ERRORS: Record<string, keyof FormErrors> = {
  kind_required: "kind",
  technology_required: "technology",
  technology_conflict: "technology",
  summary_required: "summary",
  source_type_required: "sourceType",
  credibility_reason_required: "credibilityReason",
  credibility_reason_other: "credibilityReason",
  reject_reason_required: "rejectReason",
};

function changedWhileOpen(error: ApiError | null): string | null {
  if (error === null || error.status !== 409) {
    return null;
  }
  return CHANGED_WHILE_OPEN[error.code] ?? null;
}

// How the page's reload of the paper is going, after "Load the latest".
export interface RefreshState {
  loading: boolean;
  error: ApiError | null;
}

interface ReviewFormProps {
  source: Candidate;
  // The assessment to compare against. null when there's no current one.
  assessment: AiAssessment | null;
  // When changing an earlier decision: that decision. The new review replaces it.
  replacing: Review | null;
  refresh: RefreshState;
  // Reloads the paper without unmounting the form, so what was typed stays.
  onLoadLatest: () => void;
  onSubmitted: (decision: Decision, publishProblems: string[]) => void;
}

export function ReviewForm({ source, assessment, replacing, refresh, onLoadLatest, onSubmitted }: ReviewFormProps) {
  const parsed = assessment ? assessment.parsed : null;
  const aiValues = parsed ? aiFieldValues(parsed) : null;

  // How the form started. Kept apart from the props, which change after "Load the latest".
  const [start] = useState(() => ({
    fields: startingFields(replacing, aiValues),
    fromApproval: replacing !== null && replacing.decision === "approve",
    summary: replacing?.final.summary ?? "",
  }));
  const [values, setValues] = useState<FieldValues>(start.fields.values);
  // Fields where the reviewer pressed "Use AI value". isUsingAi checks each
  // one still holds before it counts.
  const [aiUsed, setAiUsed] = useState<ReviewField[]>(start.fields.aiUsed);
  const [touched, setTouched] = useState<ReviewField[]>(start.fields.touched);
  const [draft, setDraft] = useState<DecisionDraft>(() => ({
    summary: start.summary,
    sourceType: replacing?.final.source_type ?? source.source_type ?? "",
    rubric: replacing ? rubricFrom(replacing.final) : emptyRubric(),
    credibilityReason: replacing?.final.credibility_unclear_reason ?? "",
    // Starts ticked only when changing an approval that said so.
    generalBackground: start.fromApproval && replacing?.final.general_background === true,
    notes: "",
    rejectReason: replacing?.reject_reason ?? "",
  }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState<Decision | null>(null);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  // Set after "Load the latest", until the next attempt to decide.
  const [loadedLatest, setLoadedLatest] = useState(false);

  // Typed text is the work worth asking about before leaving.
  useUnsavedWork(draft.summary.trim() !== start.summary.trim() || draft.notes.trim() !== "");

  function markTouched(field: ReviewField) {
    setTouched((previous) => (previous.includes(field) ? previous : [...previous, field]));
  }

  function clearFieldError(field: ReviewField) {
    if (field === "kind" || field === "technology") {
      setErrors((previous) => ({ ...previous, [field]: undefined }));
    }
  }

  function changeField(field: ReviewField, next: string[]) {
    setValues((previous) => ({ ...previous, [field]: inEnumOrder(field, next) }));
    // Editing after "Use AI value" makes it the reviewer's own choice.
    setAiUsed((previous) => without(previous, field));
    markTouched(field);
    clearFieldError(field);
    // A technology and "general background" can't both be true.
    if (field === "technology" && next.length > 0) {
      setDraft((previous) => ({ ...previous, generalBackground: false }));
    }
  }

  function takeAiValue(field: ReviewField) {
    if (!aiValues) {
      return;
    }
    setValues((previous) => ({ ...previous, [field]: aiValues[field] }));
    setAiUsed((previous) => (previous.includes(field) ? previous : [...previous, field]));
    markTouched(field);
    clearFieldError(field);
    if (field === "technology" && aiValues.technology.length > 0) {
      setDraft((previous) => ({ ...previous, generalBackground: false }));
    }
  }

  function changeGeneralBackground(on: boolean) {
    setDraft((previous) => ({ ...previous, generalBackground: on }));
    if (on) {
      changeField("technology", []);
    }
    clearFieldError("technology");
  }

  function updateDraft(patch: Partial<DecisionDraft>, clears: keyof FormErrors | null = null) {
    setDraft((previous) => ({ ...previous, ...patch }));
    if (clears && errors[clears]) {
      setErrors((previous) => ({ ...previous, [clears]: undefined }));
    }
  }

  async function decide(decision: Decision) {
    const problems = checkDecision(decision, values, draft);
    setErrors(problems);
    for (const target of ERROR_TARGETS) {
      if (problems[target.key]) {
        document.getElementById(target.id)?.focus();
        return;
      }
    }

    const body = buildReviewRequest({
      decision,
      values,
      draft,
      aiUsed,
      aiValues,
      assessmentId: assessment ? assessment.id : null,
      replacesReviewId: replacing ? replacing.id : null,
    });

    setSubmitting(decision);
    setSubmitError(null);
    setLoadedLatest(false);
    try {
      const result = await submitReview(source.id, body);
      // Stay disabled: the screen moves on.
      onSubmitted(decision, result.publish_problems);
    } catch (error) {
      const apiError = toApiError(error);
      const field = API_FIELD_ERRORS[apiError.code];
      if (field) {
        setErrors({ [field]: apiError.message });
        const target = ERROR_TARGETS.find((entry) => entry.key === field);
        if (target) {
          // After the form is enabled again, or focus can't land.
          window.setTimeout(() => document.getElementById(target.id)?.focus(), 0);
        }
      } else {
        setSubmitError(apiError);
      }
      setSubmitting(null);
    }
  }

  function loadLatest() {
    setSubmitError(null);
    setLoadedLatest(true);
    onLoadLatest();
  }

  const busy = submitting !== null;
  const changedTitle = changedWhileOpen(submitError);

  let sectionNote: string;
  if (start.fromApproval) {
    sectionNote = aiValues
      ? "This starts from the current decision. Change anything you disagree with. The AI's answer and yours are stored side by side."
      : "This starts from the current decision. There's no AI answer to compare against.";
  } else {
    sectionNote = aiValues
      ? "Your column starts empty. Decide each field yourself, or press Use AI value when you agree. The AI's answer and yours are stored side by side."
      : "There's no AI answer to compare against, so fill in each field yourself.";
  }

  return (
    <>
      <section className={styles.section} aria-labelledby="fields-heading">
        <h2 id="fields-heading" className={styles.sectionTitle}>
          The <em>categories</em>
        </h2>
        <p className={styles.sectionNote}>{sectionNote}</p>
        <table className={`${styles.table} ${aiValues ? "" : styles.tableNoAi}`}>
          <caption className="visually-hidden">
            {aiValues
              ? "Each field, what the AI said, and your final value"
              : "Each field and your final value"}
          </caption>
          <thead>
            <tr>
              <th scope="col">Field</th>
              {aiValues && <th scope="col">What the AI said</th>}
              <th scope="col">Final value</th>
            </tr>
          </thead>
          <tbody>
            {REVIEW_FIELDS.map((field) => (
              <FieldRow
                key={field}
                field={field}
                value={values[field]}
                aiValue={aiValues ? aiValues[field] : null}
                evidence={parsed ? evidenceFor(parsed, field) : null}
                quoteFound={assessment ? assessment.quote_checks[field] : undefined}
                usingAi={isUsingAi(field, aiUsed, values, aiValues)}
                touched={touched.includes(field)}
                disabled={busy}
                error={field === "kind" || field === "technology" ? errors[field] : undefined}
                onChange={(next) => changeField(field, next)}
                onUseAi={() => takeAiValue(field)}
                extra={
                  field === "technology" ? (
                    <label className={`${forms.checkRow} ${styles.generalBackground}`}>
                      <input
                        type="checkbox"
                        className={forms.checkbox}
                        checked={draft.generalBackground}
                        onChange={(event) => changeGeneralBackground(event.target.checked)}
                        disabled={busy}
                      />
                      <span>General background (not about one technology)</span>
                    </label>
                  ) : null
                }
              />
            ))}
          </tbody>
        </table>
      </section>

      <section className={`paper ${styles.decision}`} aria-labelledby="decision-heading">
        <h2 id="decision-heading" className={styles.sectionTitle}>
          Your <em>decision</em>
        </h2>

        <div className={forms.field}>
          <label htmlFor="review-summary" className={forms.label}>
            Team summary <span className={forms.optional}>(public, needed to approve)</span>
          </label>
          <p id="review-summary-hint" className={forms.hint}>
            Readers will see this once the site is next published, so write it yourself in a sentence or two.
            Don&rsquo;t paste the abstract or the AI&rsquo;s reasons.
          </p>
          <textarea
            id="review-summary"
            className={`${forms.textarea} ${errors.summary ? forms.invalid : ""}`}
            value={draft.summary}
            onChange={(event) => updateDraft({ summary: event.target.value }, "summary")}
            aria-describedby={errors.summary ? "review-summary-hint review-summary-error" : "review-summary-hint"}
            aria-invalid={errors.summary ? true : undefined}
            disabled={busy}
          />
          {errors.summary && (
            <p id="review-summary-error" className={forms.error}>
              {errors.summary}
            </p>
          )}
        </div>

        <div className={styles.detailsGrid}>
          <div className={forms.field}>
            <label htmlFor="review-source-type" className={forms.label}>
              Source type
            </label>
            <select
              id="review-source-type"
              className={`${forms.select} ${errors.sourceType ? forms.invalid : ""}`}
              value={draft.sourceType}
              onChange={(event) => updateDraft({ sourceType: event.target.value as SourceType | "" }, "sourceType")}
              disabled={busy}
              aria-describedby={
                errors.sourceType ? "review-source-type-hint review-source-type-error" : "review-source-type-hint"
              }
              aria-invalid={errors.sourceType ? true : undefined}
            >
              <option value="">Not set</option>
              {enumValues("SourceType").map((info) => (
                <option key={info.value} value={info.value}>
                  {info.label}
                </option>
              ))}
            </select>
            <p id="review-source-type-hint" className={forms.hint}>
              {source.source_type
                ? "Filled in from the collector's metadata."
                : "The collector didn't say. Needed to approve."}
            </p>
            {errors.sourceType && (
              <p id="review-source-type-error" className={forms.error}>
                {errors.sourceType}
              </p>
            )}
          </div>

          {RUBRIC_FIELDS.map((item) => (
            <RubricSelect
              key={item.key}
              item={item}
              value={draft.rubric[item.key]}
              disabled={busy}
              onChange={(next) => updateDraft({ rubric: { ...draft.rubric, [item.key]: next } }, "credibilityReason")}
            />
          ))}
          {draft.rubric.credibility === "unclear" && (
            <div className={forms.field}>
              <label htmlFor="rubric-credibility-reason" className={forms.label}>
                Why credibility is unclear
              </label>
              <select
                id="rubric-credibility-reason"
                className={`${forms.select} ${errors.credibilityReason ? forms.invalid : ""}`}
                value={draft.credibilityReason}
                onChange={(event) =>
                  updateDraft({ credibilityReason: event.target.value as UnclearReason | "" }, "credibilityReason")
                }
                disabled={busy}
                aria-invalid={errors.credibilityReason ? true : undefined}
                aria-describedby={errors.credibilityReason ? "rubric-credibility-reason-error" : undefined}
              >
                <option value="">Pick a reason</option>
                {credibilityReasons().map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
              {errors.credibilityReason && (
                <p id="rubric-credibility-reason-error" className={forms.error}>
                  {errors.credibilityReason}
                </p>
              )}
            </div>
          )}
        </div>
        <p className={forms.hint}>The rubric ratings are optional for now. Leave any of them as Not rated yet.</p>

        <div className={forms.field}>
          <label htmlFor="review-notes" className={forms.label}>
            Notes <span className={forms.optional}>(for the team, never published)</span>
          </label>
          <textarea
            id="review-notes"
            className={`${forms.textarea} ${styles.notes} ${errors.notes ? forms.invalid : ""}`}
            value={draft.notes}
            onChange={(event) => updateDraft({ notes: event.target.value }, "notes")}
            aria-describedby={errors.notes ? "review-notes-error" : undefined}
            aria-invalid={errors.notes ? true : undefined}
            disabled={busy}
          />
          {errors.notes && (
            <p id="review-notes-error" className={forms.error}>
              {errors.notes}
            </p>
          )}
        </div>

        {submitError && changedTitle && (
          <Notice
            tone="warning"
            title={`Your decision wasn't saved. ${changedTitle}`}
            action={
              <button type="button" className={`btn btn-primary ${forms.smallButton}`} onClick={loadLatest}>
                Load the latest
              </button>
            }
          >
            <p>
              Load the latest version to see what changed, then decide again. What you&rsquo;ve typed here stays.
              Reloading the browser page would clear it.
            </p>
            <ErrorCode error={submitError} />
          </Notice>
        )}
        {submitError && !changedTitle && <ApiErrorNotice error={submitError} title="Your decision wasn't saved" />}
        {loadedLatest && refresh.loading && <Notice tone="info" title="Loading the latest version…" />}
        {loadedLatest && !refresh.loading && refresh.error && (
          <ApiErrorNotice error={refresh.error} title="Couldn't load the latest version" onRetry={onLoadLatest} />
        )}
        {loadedLatest && !refresh.loading && !refresh.error && (
          <Notice tone="info" title="This is the latest version.">
            <p>What you typed is still here. Check the AI&rsquo;s column and the record below, then decide again.</p>
          </Notice>
        )}

        <div className={styles.decisionActions}>
          <button
            type="button"
            className={`btn btn-primary ${forms.button}`}
            onClick={() => void decide("approve")}
            disabled={busy}
          >
            {submitting === "approve" ? "Approving…" : "Approve"}
          </button>

          <div className={styles.rejectGroup}>
            <div className={forms.field}>
              <label htmlFor="reject-reason" className={forms.label}>
                Reason for rejecting
              </label>
              <select
                id="reject-reason"
                className={`${forms.select} ${errors.rejectReason ? forms.invalid : ""}`}
                value={draft.rejectReason}
                onChange={(event) =>
                  updateDraft({ rejectReason: event.target.value as RejectReason | "" }, "rejectReason")
                }
                aria-describedby={errors.rejectReason ? "reject-reason-error" : undefined}
                aria-invalid={errors.rejectReason ? true : undefined}
                disabled={busy}
              >
                <option value="">Pick a reason</option>
                {REJECT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {REJECT_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
              {errors.rejectReason && (
                <p id="reject-reason-error" className={forms.error}>
                  {errors.rejectReason}
                </p>
              )}
            </div>
            <button
              type="button"
              className={`btn btn-secondary ${forms.button} ${forms.dangerButton}`}
              onClick={() => void decide("reject")}
              disabled={busy}
            >
              {submitting === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

interface FieldRowProps {
  field: ReviewField;
  value: string[];
  // null when there's no AI answer for this paper.
  aiValue: string[] | null;
  evidence: FieldEvidence | null;
  quoteFound: boolean | undefined;
  usingAi: boolean;
  touched: boolean;
  disabled: boolean;
  // Why approving can't go ahead with this field as it is.
  error?: string;
  onChange: (next: string[]) => void;
  onUseAi: () => void;
  // Shown under the choices, e.g. the "general background" box for technology.
  extra?: ReactNode;
}

function FieldRow({
  field,
  value,
  aiValue,
  evidence,
  quoteFound,
  usingAi,
  touched,
  disabled,
  error,
  onChange,
  onUseAi,
  extra,
}: FieldRowProps) {
  const enumName = FIELD_ENUMS[field];
  const label = FIELD_LABELS[field];
  const headerId = `field-${field}`;
  const meaningId = `field-${field}-meaning`;
  const errorId = `field-${field}-error`;
  // The input that takes focus when this field needs fixing (see ERROR_TARGETS).
  const inputId = `field-${field}-input`;
  const selectRef = useRef<HTMLSelectElement>(null);
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  // The API only compares fields where the AI chose something, so there's
  // nothing to keep or change when it left the field empty.
  const aiChoseSomething = aiValue !== null && aiValue.length > 0;
  const changed = aiChoseSomething && touched && !usingAi && !sameValues(value, aiValue);
  // What the chosen single value means, shown under the select.
  const meaning = isSingleValue(field) && value.length > 0 ? enumDescription(enumName, value[0]) : "";

  function onUseAiClick() {
    onUseAi();
    // The button turns off once pressed, so focus moves to the field it
    // filled in instead of being dropped.
    if (selectRef.current) {
      selectRef.current.focus();
      return;
    }
    if (fieldsetRef.current && aiValue && aiValue.length > 0) {
      const box = fieldsetRef.current.querySelector<HTMLInputElement>(`input[value="${CSS.escape(aiValue[0])}"]`);
      box?.focus();
    }
  }

  // Only say how the final value compares once the reviewer has set it.
  let comparison: ReactNode = null;
  if (usingAi) {
    comparison = <AiChip>Using the AI&rsquo;s value</AiChip>;
  } else if (aiChoseSomething && touched) {
    comparison = changed ? (
      <span className={styles.changedTag}>Changed from the AI</span>
    ) : (
      <span className={styles.sameTag}>Same as the AI</span>
    );
  }

  return (
    <tr className={changed ? styles.changedRow : undefined}>
      <th scope="row" id={headerId} className={styles.fieldCell}>
        {label}
        <span className={styles.fieldHint}>{isSingleValue(field) ? "Pick one" : "Pick any"}</span>
      </th>

      {aiValue && (
        <td className={styles.aiCell} data-label="What the AI said">
          <ChipRow>
            {aiValue.length === 0 ? (
              <span className={styles.none}>Nothing chosen</span>
            ) : (
              aiValue.map((item) => (
                <AiChip key={item} title={enumDescription(enumName, item)}>
                  {enumLabel(enumName, item)}
                </AiChip>
              ))
            )}
          </ChipRow>
          {evidence ? (
            <>
              <span className={styles.reason}>{evidence.reason}</span>
              {evidence.quote && <span className={styles.quote}>&ldquo;{evidence.quote}&rdquo;</span>}
              <QuoteCheck found={quoteFound} />
            </>
          ) : (
            <span className={styles.none}>The AI gave no reason for this field.</span>
          )}
        </td>
      )}

      <td className={styles.finalCell} data-label="Final value">
        {isSingleValue(field) ? (
          <>
            <select
              ref={selectRef}
              id={inputId}
              className={`${forms.select} ${error ? forms.invalid : ""}`}
              aria-labelledby={headerId}
              aria-describedby={[meaning ? meaningId : "", error ? errorId : ""].join(" ").trim() || undefined}
              aria-invalid={error ? true : undefined}
              value={value[0] ?? ""}
              onChange={(event) => onChange(event.target.value === "" ? [] : [event.target.value])}
              disabled={disabled}
            >
              <option value="">Not set</option>
              {enumValues(enumName).map((info) => (
                <option key={info.value} value={info.value}>
                  {info.label}
                </option>
              ))}
            </select>
            {meaning && (
              <p id={meaningId} className={forms.hint}>
                {meaning}
              </p>
            )}
          </>
        ) : (
          <fieldset
            ref={fieldsetRef}
            className={forms.fieldset}
            aria-labelledby={headerId}
            aria-describedby={error ? errorId : undefined}
            disabled={disabled}
          >
            <ul className={forms.checkList}>
              {enumValues(enumName).map((info, index) => (
                <li key={info.value}>
                  <label className={forms.checkRow} title={info.description}>
                    <input
                      id={index === 0 ? inputId : undefined}
                      type="checkbox"
                      className={forms.checkbox}
                      value={info.value}
                      checked={value.includes(info.value)}
                      onChange={(event) => {
                        const next: string[] = [];
                        for (const item of value) {
                          if (item !== info.value) {
                            next.push(item);
                          }
                        }
                        if (event.target.checked) {
                          next.push(info.value);
                        }
                        onChange(next);
                      }}
                    />
                    <span>
                      {field === "claim_directions" && (
                        <>
                          <DirectionGlyph tone={directionTone(info.value as ClaimDirection)} />{" "}
                        </>
                      )}
                      {info.label}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <details className={styles.definitions}>
              <summary>What these mean</summary>
              <dl>
                {enumValues(enumName).map((info) => (
                  <div key={info.value}>
                    <dt>{info.label}</dt>
                    <dd>{info.description}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </fieldset>
        )}
        {extra}
        {error && (
          <p id={errorId} className={forms.error}>
            {error}
          </p>
        )}

        <div className={styles.finalActions}>
          {aiChoseSomething && (
            <button
              type="button"
              className={`btn btn-secondary ${forms.button} ${forms.smallButton}`}
              onClick={onUseAiClick}
              disabled={disabled || usingAi}
              aria-label={`Use the AI's value for ${label}`}
            >
              Use AI value
            </button>
          )}
          {/* Always rendered, so screen readers hear "Using the AI's value" when it appears */}
          <span aria-live="polite">{comparison}</span>
        </div>
      </td>
    </tr>
  );
}

interface RubricSelectProps {
  item: (typeof RUBRIC_FIELDS)[number];
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}

function RubricSelect({ item, value, disabled, onChange }: RubricSelectProps) {
  const id = `rubric-${item.key}`;
  const options = enumValues(item.enumName);
  // A no-break space keeps the line's height when there's nothing to say.
  let hint = "\u00a0";
  if (value !== "") {
    hint = enumDescription(item.enumName, value);
  }
  return (
    <div className={forms.field}>
      <label htmlFor={id} className={forms.label}>
        {item.label}
        {isDraftEnum(item.enumName) && <span className={forms.optional}> (draft scale)</span>}
      </label>
      <select
        id={id}
        className={forms.select}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
      >
        <option value="">Not rated yet</option>
        {options.map((info) => (
          <option key={info.value} value={info.value}>
            {info.label}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className={forms.hint}>
        {hint}
      </p>
    </div>
  );
}
