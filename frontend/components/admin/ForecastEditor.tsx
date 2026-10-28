"use client";

import claimStyles from "./ClaimEditor.module.css";
import styles from "./Editor.module.css";
import forms from "./forms.module.css";
import {
  blankForecast,
  fieldId,
  MAX_QUOTE_LENGTH,
  messagesAt,
  nextForecastId,
  type ForecastDraft,
  type MilestoneErrors,
} from "./milestoneModel";
import { SinglePicker, type PickerOption } from "./Pickers";

interface YearInputProps {
  path: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  errors: MilestoneErrors;
  disabled?: boolean;
  hint?: string;
}

// A year, or empty. Kept as text so a half-typed year doesn't jump around.
export function YearInput({ path, label, value, onChange, errors, disabled = false, hint }: YearInputProps) {
  const id = fieldId(path);
  const messages = messagesAt(errors, path);
  const describedBy: string[] = [];
  if (hint) {
    describedBy.push(`${id}-hint`);
  }
  if (messages.length > 0) {
    describedBy.push(`${id}-error`);
  }
  return (
    <div className={forms.field}>
      <label htmlFor={id} className={forms.label}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        className={`${forms.input} ${messages.length > 0 ? forms.invalid : ""}`}
        value={value === null ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        disabled={disabled}
        aria-invalid={messages.length > 0 ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className={forms.hint}>
          {hint}
        </p>
      )}
      {messages.length > 0 && (
        <p id={`${id}-error`} className={forms.error}>
          {messages.join(" ")}
        </p>
      )}
    </div>
  );
}

interface ForecastEditorProps {
  forecasts: ForecastDraft[];
  onChange: (forecasts: ForecastDraft[]) => void;
  errors: MilestoneErrors;
  sources: PickerOption[];
  disabled: boolean;
}

// Every published forecast for the milestone, one row each, as stated by the
// forecaster. The site shows each one on its own and never averages them.
export function ForecastEditor({ forecasts, onChange, errors, sources, disabled }: ForecastEditorProps) {
  function replace(index: number, patch: Partial<ForecastDraft>) {
    const next = [...forecasts];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function remove(index: number) {
    const next: ForecastDraft[] = [];
    for (let position = 0; position < forecasts.length; position += 1) {
      if (position !== index) {
        next.push(forecasts[position]);
      }
    }
    onChange(next);
  }

  function add() {
    const newIndex = forecasts.length;
    onChange([...forecasts, blankForecast(nextForecastId(forecasts))]);
    window.setTimeout(() => document.getElementById(fieldId(`forecasts.${newIndex}.forecaster`))?.focus(), 0);
  }

  return (
    <div className={styles.rows}>
      {forecasts.length === 0 && <p className={styles.muted}>No forecasts yet.</p>}
      {forecasts.map((forecast, index) => {
        const path = `forecasts.${index}`;
        const quoteId = fieldId(`${path}.quote`);
        const quoteMessages = messagesAt(errors, `${path}.quote`);
        const claimMessages = messagesAt(errors, `${path}.claim`);
        const forecasterMessages = messagesAt(errors, `${path}.forecaster`);
        return (
          <fieldset key={forecast.id} className={claimStyles.claim} disabled={disabled}>
            <legend className={claimStyles.legend}>Forecast {index + 1}</legend>
            <div className={claimStyles.action}>
              <button
                type="button"
                className={forms.linkButton}
                onClick={() => remove(index)}
                aria-label={`Remove forecast ${index + 1}`}
              >
                Remove
              </button>
            </div>

            <div className={styles.grid2}>
              <div className={forms.field}>
                <label htmlFor={fieldId(`${path}.forecaster`)} className={forms.label}>
                  Who made it
                </label>
                <input
                  id={fieldId(`${path}.forecaster`)}
                  className={`${forms.input} ${forecasterMessages.length > 0 ? forms.invalid : ""}`}
                  value={forecast.forecaster}
                  onChange={(event) => replace(index, { forecaster: event.target.value })}
                  aria-invalid={forecasterMessages.length > 0 ? true : undefined}
                />
                {forecasterMessages.length > 0 && <p className={forms.error}>{forecasterMessages.join(" ")}</p>}
              </div>
              <SinglePicker
                id={fieldId(`${path}.source_id`)}
                label="Source"
                options={sources}
                value={forecast.source_id}
                onChange={(next) => replace(index, { source_id: next })}
                disabled={disabled}
                errors={messagesAt(errors, `${path}.source_id`)}
              />
            </div>

            <div className={forms.field}>
              <label htmlFor={fieldId(`${path}.claim`)} className={forms.label}>
                What they forecast
              </label>
              <textarea
                id={fieldId(`${path}.claim`)}
                className={`${forms.textarea} ${styles.shortText} ${claimMessages.length > 0 ? forms.invalid : ""}`}
                value={forecast.claim}
                onChange={(event) => replace(index, { claim: event.target.value })}
                aria-invalid={claimMessages.length > 0 ? true : undefined}
              />
              {claimMessages.length > 0 && <p className={forms.error}>{claimMessages.join(" ")}</p>}
            </div>

            <div className={forms.field}>
              <label htmlFor={quoteId} className={forms.label}>
                Exact quote
              </label>
              <textarea
                id={quoteId}
                className={`${forms.textarea} ${claimStyles.quote} ${quoteMessages.length > 0 ? forms.invalid : ""}`}
                value={forecast.quote}
                onChange={(event) => replace(index, { quote: event.target.value })}
                aria-invalid={quoteMessages.length > 0 ? true : undefined}
                aria-describedby={`${quoteId}-count`}
              />
              <p
                id={`${quoteId}-count`}
                className={`${forms.hint} ${forecast.quote.trim().length > MAX_QUOTE_LENGTH ? claimStyles.over : ""}`}
              >
                {forecast.quote.trim().length} of {MAX_QUOTE_LENGTH} characters.
              </p>
              {quoteMessages.length > 0 && <p className={forms.error}>{quoteMessages.join(" ")}</p>}
            </div>

            <div className={forms.field}>
              <label htmlFor={fieldId(`${path}.quote_location`)} className={forms.label}>
                Where in the source <span className={forms.optional}>(optional)</span>
              </label>
              <input
                id={fieldId(`${path}.quote_location`)}
                className={forms.input}
                value={forecast.quote_location ?? ""}
                onChange={(event) => replace(index, { quote_location: event.target.value })}
                placeholder="Page, section or timestamp"
              />
            </div>

            <div className={styles.grid3}>
              <YearInput
                path={`${path}.made_in`}
                label="Year made"
                value={forecast.made_in}
                onChange={(value) => replace(index, { made_in: value })}
                errors={errors}
              />
              <YearInput
                path={`${path}.earliest`}
                label="Earliest year"
                value={forecast.never ? null : forecast.earliest}
                onChange={(value) => replace(index, { earliest: value })}
                errors={errors}
                disabled={forecast.never}
                hint='Empty when they only say "by" a year.'
              />
              <YearInput
                path={`${path}.latest`}
                label="Latest year"
                value={forecast.never ? null : forecast.latest}
                onChange={(value) => replace(index, { latest: value })}
                errors={errors}
                disabled={forecast.never}
                hint='Empty when they only say "not before" a year.'
              />
            </div>
            <label className={forms.checkRow}>
              <input
                id={fieldId(`${path}.never`)}
                type="checkbox"
                className={forms.checkbox}
                checked={forecast.never}
                onChange={(event) => replace(index, { never: event.target.checked })}
              />
              <span>They say it will never happen.</span>
            </label>
          </fieldset>
        );
      })}
      <div>
        <button
          id={fieldId("forecasts")}
          type="button"
          className={`btn btn-secondary ${forms.smallButton}`}
          onClick={add}
          disabled={disabled}
        >
          Add a forecast
        </button>
      </div>
    </div>
  );
}
