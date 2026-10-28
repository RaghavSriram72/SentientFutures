"use client";

import type { ReactNode } from "react";

import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { enumLabel, enumValues } from "@/lib/enums";
import type { Claim, Provenance, UnclearReason } from "@/lib/types";

import styles from "./ClaimEditor.module.css";
import forms from "./forms.module.css";
import { blankClaim, fieldId, MAX_QUOTE_LENGTH, messagesAt, type MilestoneErrors } from "./milestoneModel";
import { MultiPicker, type PickerOption } from "./Pickers";

const PROVENANCES: Provenance[] = ["source", "team", "ai", "unclear"];

// What each kind asks for, in a few words, under its name.
const PROVENANCE_HINTS: Record<Provenance, string> = {
  source: "Quoted from a source, with its exact words.",
  team: "The team's own judgment.",
  ai: "Drafted by an AI. Someone on the team checks it before it goes public.",
  unclear: "Nobody knows yet. Say why.",
};

function FieldError({ id, messages }: { id: string; messages: string[] }) {
  if (messages.length === 0) {
    return null;
  }
  return (
    <p id={id} className={forms.error}>
      {messages.join(" ")}
    </p>
  );
}

export interface ClaimEditorProps {
  // Where the claim sits in the milestone, e.g. "summary" or "would_move_later.1".
  // Input ids and error lookups come from it.
  path: string;
  label: string;
  hint?: string;
  claim: Claim;
  onChange: (claim: Claim) => void;
  errors: MilestoneErrors;
  sources: PickerOption[];
  disabled: boolean;
  // Filled in by "I checked it" on AI text.
  reviewerName: string;
  // Only "from a source" is allowed, e.g. for saying when a milestone happened.
  sourceOnly?: boolean;
  // Beside the label, e.g. a Remove button for one claim in a list.
  action?: ReactNode;
}

// One sentence on the site and where it comes from. Each provenance asks for
// what the site needs to show it honestly: a source needs the source and its
// exact words, AI text needs a person who checked it, and "unclear" needs a reason.
export function ClaimEditor({
  path,
  label,
  hint,
  claim,
  onChange,
  errors,
  sources,
  disabled,
  reviewerName,
  sourceOnly = false,
  action,
}: ClaimEditorProps) {
  const textId = fieldId(`${path}.text`);
  const quote = claim.quote ?? "";
  const textErrors = messagesAt(errors, `${path}.text`);
  const provenanceErrors = messagesAt(errors, `${path}.provenance`);
  const quoteErrors = messagesAt(errors, `${path}.quote`);
  const reasonErrors = messagesAt(errors, `${path}.unclear_reason`);
  const noteErrors = messagesAt(errors, `${path}.unclear_note`);
  const reviewedErrors = messagesAt(errors, `${path}.reviewed_by`);
  // Problems on the claim as a whole, from the API.
  const ownErrors = errors[path] ? [errors[path]] : [];

  function update(patch: Partial<Claim>) {
    onChange({ ...claim, ...patch });
  }

  function described(hintId: string | null, errorId: string, hasError: boolean): string | undefined {
    const ids: string[] = [];
    if (hintId) {
      ids.push(hintId);
    }
    if (hasError) {
      ids.push(errorId);
    }
    return ids.length > 0 ? ids.join(" ") : undefined;
  }

  return (
    <fieldset className={styles.claim} disabled={disabled}>
      <legend className={styles.legend}>{label}</legend>
      {action && <div className={styles.action}>{action}</div>}
      {hint && <p className={forms.hint}>{hint}</p>}

      <div className={forms.field}>
        <label htmlFor={textId} className="visually-hidden">
          {label}, the text
        </label>
        <textarea
          id={textId}
          className={`${forms.textarea} ${styles.text} ${textErrors.length > 0 ? forms.invalid : ""}`}
          value={claim.text}
          onChange={(event) => update({ text: event.target.value })}
          aria-invalid={textErrors.length > 0 ? true : undefined}
          aria-describedby={described(null, `${textId}-error`, textErrors.length > 0)}
        />
        <FieldError id={`${textId}-error`} messages={textErrors} />
      </div>

      {sourceOnly ? (
        <p className={styles.sourceOnly}>
          <ProvenanceGlyph kind="source" /> {enumLabel("Provenance", "source")}. Saying it happened needs a quote.
        </p>
      ) : (
        <div className={styles.kinds} role="radiogroup" aria-label={`Where "${label}" comes from`}>
          {PROVENANCES.map((kind, index) => (
            <label key={kind} className={`${styles.kind} ${claim.provenance === kind ? styles.kindChosen : ""}`}>
              <input
                id={index === 0 ? fieldId(`${path}.provenance`) : undefined}
                type="radio"
                className={styles.radio}
                name={`${path}-provenance`}
                value={kind}
                checked={claim.provenance === kind}
                onChange={() => update({ provenance: kind })}
              />
              <span className={`${styles.kindName} ${styles[`kind_${kind}`]}`}>
                <ProvenanceGlyph kind={kind} />
                {enumLabel("Provenance", kind)}
              </span>
              <span className={styles.kindHint}>{PROVENANCE_HINTS[kind]}</span>
            </label>
          ))}
        </div>
      )}
      <FieldError id={`${fieldId(`${path}.provenance`)}-error`} messages={[...provenanceErrors, ...ownErrors]} />

      {claim.provenance === "source" && (
        <div className={styles.details}>
          <MultiPicker
            id={fieldId(`${path}.source_ids`)}
            label="Source"
            options={sources}
            chosen={claim.source_ids ?? []}
            onChange={(next) => update({ source_ids: next })}
            disabled={disabled}
            errors={messagesAt(errors, `${path}.source_ids`)}
            emptyText="No source picked yet."
          />
          <div className={forms.field}>
            <label htmlFor={fieldId(`${path}.quote`)} className={forms.label}>
              Exact quote
            </label>
            <textarea
              id={fieldId(`${path}.quote`)}
              className={`${forms.textarea} ${styles.quote} ${quoteErrors.length > 0 ? forms.invalid : ""}`}
              value={quote}
              onChange={(event) => update({ quote: event.target.value })}
              aria-invalid={quoteErrors.length > 0 ? true : undefined}
              aria-describedby={described(
                `${fieldId(`${path}.quote`)}-count`,
                `${fieldId(`${path}.quote`)}-error`,
                quoteErrors.length > 0,
              )}
            />
            <p
              id={`${fieldId(`${path}.quote`)}-count`}
              className={`${forms.hint} ${quote.trim().length > MAX_QUOTE_LENGTH ? styles.over : ""}`}
            >
              {quote.trim().length} of {MAX_QUOTE_LENGTH} characters. The shortest passage that supports it.
            </p>
            <FieldError id={`${fieldId(`${path}.quote`)}-error`} messages={quoteErrors} />
          </div>
          <div className={forms.field}>
            <label htmlFor={fieldId(`${path}.quote_location`)} className={forms.label}>
              Where in the source <span className={forms.optional}>(optional)</span>
            </label>
            <input
              id={fieldId(`${path}.quote_location`)}
              className={forms.input}
              value={claim.quote_location ?? ""}
              onChange={(event) => update({ quote_location: event.target.value })}
              placeholder="Page, section or timestamp"
            />
          </div>
        </div>
      )}

      {(claim.provenance === "team" || claim.provenance === "ai") && (
        <div className={styles.details}>
          <MultiPicker
            id={fieldId(`${path}.source_ids`)}
            label="Sources it draws on (optional)"
            options={sources}
            chosen={claim.source_ids ?? []}
            onChange={(next) => update({ source_ids: next })}
            disabled={disabled}
            errors={messagesAt(errors, `${path}.source_ids`)}
            emptyText="None."
          />
        </div>
      )}

      {claim.provenance === "ai" && (
        <div className={`${styles.details} ${forms.field}`}>
          <label htmlFor={fieldId(`${path}.reviewed_by`)} className={forms.label}>
            Checked by
          </label>
          <div className={styles.inline}>
            <input
              id={fieldId(`${path}.reviewed_by`)}
              className={`${forms.input} ${reviewedErrors.length > 0 ? forms.invalid : ""}`}
              value={claim.reviewed_by ?? ""}
              onChange={(event) => update({ reviewed_by: event.target.value })}
              aria-invalid={reviewedErrors.length > 0 ? true : undefined}
              aria-describedby={described(
                `${fieldId(`${path}.reviewed_by`)}-hint`,
                `${fieldId(`${path}.reviewed_by`)}-error`,
                reviewedErrors.length > 0,
              )}
            />
            {reviewerName !== "" && (claim.reviewed_by ?? "") === "" && (
              <button
                type="button"
                className={`btn btn-secondary ${forms.smallButton}`}
                onClick={() => update({ reviewed_by: reviewerName })}
              >
                I checked it
              </button>
            )}
          </div>
          <p id={`${fieldId(`${path}.reviewed_by`)}-hint`} className={forms.hint}>
            The site names whoever checked AI text. Leave it empty until someone has.
          </p>
          <FieldError id={`${fieldId(`${path}.reviewed_by`)}-error`} messages={reviewedErrors} />
        </div>
      )}

      {claim.provenance === "unclear" && (
        <div className={`${styles.details} ${styles.unclear}`}>
          <div className={forms.field}>
            <label htmlFor={fieldId(`${path}.unclear_reason`)} className={forms.label}>
              Why it&rsquo;s unclear
            </label>
            <select
              id={fieldId(`${path}.unclear_reason`)}
              className={`${forms.select} ${reasonErrors.length > 0 ? forms.invalid : ""}`}
              value={claim.unclear_reason ?? ""}
              onChange={(event) =>
                update({ unclear_reason: event.target.value === "" ? null : (event.target.value as UnclearReason) })
              }
              aria-invalid={reasonErrors.length > 0 ? true : undefined}
              aria-describedby={described(null, `${fieldId(`${path}.unclear_reason`)}-error`, reasonErrors.length > 0)}
            >
              <option value="">Pick a reason</option>
              {enumValues("UnclearReason").map((info) => (
                <option key={info.value} value={info.value}>
                  {info.label}
                </option>
              ))}
            </select>
            <FieldError id={`${fieldId(`${path}.unclear_reason`)}-error`} messages={reasonErrors} />
          </div>
          {claim.unclear_reason === "other" && (
            <div className={forms.field}>
              <label htmlFor={fieldId(`${path}.unclear_note`)} className={forms.label}>
                The reason, in a few words
              </label>
              <input
                id={fieldId(`${path}.unclear_note`)}
                className={`${forms.input} ${noteErrors.length > 0 ? forms.invalid : ""}`}
                value={claim.unclear_note ?? ""}
                onChange={(event) => update({ unclear_note: event.target.value })}
                aria-invalid={noteErrors.length > 0 ? true : undefined}
                aria-describedby={described(null, `${fieldId(`${path}.unclear_note`)}-error`, noteErrors.length > 0)}
              />
              <FieldError id={`${fieldId(`${path}.unclear_note`)}-error`} messages={noteErrors} />
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

interface ClaimListEditorProps extends Omit<ClaimEditorProps, "claim" | "onChange" | "label" | "action"> {
  label: string;
  // What one entry is called, e.g. "Reason" -> "Reason 1", "Reason 2".
  itemLabel: string;
  claims: Claim[];
  onChange: (claims: Claim[]) => void;
}

// A list of claims (what would move a milestone earlier, say), each with its
// own provenance, plus Add and Remove.
export function ClaimListEditor({ path, label, itemLabel, hint, claims, onChange, errors, ...rest }: ClaimListEditorProps) {
  const listErrors = errors[path] ? [errors[path]] : [];

  function replace(index: number, claim: Claim) {
    const next = [...claims];
    next[index] = claim;
    onChange(next);
  }

  function remove(index: number) {
    const next: Claim[] = [];
    for (let position = 0; position < claims.length; position += 1) {
      if (position !== index) {
        next.push(claims[position]);
      }
    }
    onChange(next);
  }

  function add() {
    onChange([...claims, blankClaim()]);
    // Focus the new entry's text, so typing can start right away.
    const newIndex = claims.length;
    window.setTimeout(() => document.getElementById(fieldId(`${path}.${newIndex}.text`))?.focus(), 0);
  }

  return (
    <div className={styles.list} role="group" aria-labelledby={`${fieldId(path)}-label`}>
      <div className={styles.listHead}>
        <h3 id={`${fieldId(path)}-label`} className={styles.listTitle}>
          {label}
        </h3>
        {hint && <p className={forms.hint}>{hint}</p>}
      </div>
      {claims.length === 0 && <p className={styles.none}>None yet.</p>}
      {claims.map((claim, index) => (
        <ClaimEditor
          // Claims have no id of their own; position is stable between adds and removes here.
          key={index}
          {...rest}
          path={`${path}.${index}`}
          label={`${itemLabel} ${index + 1}`}
          claim={claim}
          errors={errors}
          onChange={(next) => replace(index, next)}
          action={
            <button
              type="button"
              className={forms.linkButton}
              onClick={() => remove(index)}
              aria-label={`Remove ${itemLabel.toLowerCase()} ${index + 1}`}
            >
              Remove
            </button>
          }
        />
      ))}
      {listErrors.length > 0 && (
        <p id={`${fieldId(path)}-error`} className={forms.error}>
          {listErrors.join(" ")}
        </p>
      )}
      <div>
        <button
          id={fieldId(path)}
          type="button"
          className={`btn btn-secondary ${forms.smallButton}`}
          onClick={add}
          disabled={rest.disabled}
        >
          Add {claims.length === 0 ? "one" : "another"}
        </button>
      </div>
    </div>
  );
}
