"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { Effort, SearchCollector, SearchConfig, SearchConfigInput } from "@/lib/adminTypes";
import { fieldErrorsFrom, getSearchConfig, saveSearchConfig, toApiError, type ApiError } from "@/lib/api";

import { AdminPageHead } from "./AdminPageHead";
import { formatDateTime } from "./adminFormat";
import detail from "./Detail.module.css";
import forms from "./forms.module.css";
import { COLLECTOR_LABELS } from "./labels";
import { ApiErrorNotice, Notice } from "./Notice";
import styles from "./Settings.module.css";
import { useUnsavedWork } from "./unsavedWork";
import { useApiData } from "./useApiData";

// The limits from SearchConfig in shared/sf_shared/pipeline_models.py. The API
// checks them too; checking here means people see the problem next to the field.
const LIMITS = {
  lookbackDays: { min: 1, max: 365 },
  maxItems: { min: 1, max: 5000 },
  maxCost: { max: 50 },
};

const SEARCH_COLLECTORS: SearchCollector[] = ["arxiv", "semantic_scholar"];
const EFFORTS: Effort[] = ["low", "medium", "high"];

// Numbers stay as text while editing, so a field can be empty mid-edit.
interface QueryDraft {
  key: string; // React list key only, never saved
  label: string;
  text: string;
  collectors: SearchCollector[];
  enabled: boolean;
}

interface ConfigDraft {
  queries: QueryDraft[];
  lookbackDays: string;
  maxItems: string;
  maxCost: string;
  spotCheckPercent: string;
  model: string;
  effort: Effort;
}

// Field path (as the API names it) -> message.
type Errors = Record<string, string>;

let nextQueryKey = 0;
function newQueryKey(): string {
  nextQueryKey += 1;
  return `query-${nextQueryKey}`;
}

// 0.03 -> "3". Rounded so float noise like 3.0000000000000004 never shows.
function rateToPercent(rate: number): string {
  return String(Math.round(rate * 10000) / 100);
}

function toDraft(config: SearchConfig): ConfigDraft {
  const queries: QueryDraft[] = [];
  for (const query of config.queries) {
    queries.push({
      key: newQueryKey(),
      label: query.label,
      text: query.text,
      collectors: [...query.collectors],
      enabled: query.enabled,
    });
  }
  return {
    queries,
    lookbackDays: String(config.lookback_days),
    maxItems: String(config.max_items_per_run),
    maxCost: String(config.max_cost_usd_per_run),
    spotCheckPercent: rateToPercent(config.spot_check_rate),
    model: config.model,
    effort: config.effort,
  };
}

function isWholeNumberIn(text: string, min: number, max: number): boolean {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max;
}

// Checks the draft and, when it's valid, builds what gets sent to the API.
function validate(draft: ConfigDraft): { errors: Errors; config: SearchConfigInput | null } {
  const errors: Errors = {};
  const seenLabels: string[] = [];

  for (let index = 0; index < draft.queries.length; index += 1) {
    const query = draft.queries[index];
    const label = query.label.trim();
    if (label === "") {
      errors[`queries.${index}.label`] = "Give the search a label.";
    } else if (seenLabels.includes(label.toLowerCase())) {
      errors[`queries.${index}.label`] = "Another search already has this label. Labels are stored on each paper, so keep them unique.";
    }
    seenLabels.push(label.toLowerCase());
    if (query.text.trim() === "") {
      errors[`queries.${index}.text`] = "Add the search terms.";
    }
    if (query.collectors.length === 0) {
      errors[`queries.${index}.collectors`] = "Pick at least one place to search.";
    }
  }

  if (!isWholeNumberIn(draft.lookbackDays, LIMITS.lookbackDays.min, LIMITS.lookbackDays.max)) {
    errors.lookback_days = "Use a whole number of days from 1 to 365.";
  }
  if (!isWholeNumberIn(draft.maxItems, LIMITS.maxItems.min, LIMITS.maxItems.max)) {
    errors.max_items_per_run = "Use a whole number from 1 to 5,000.";
  }
  const maxCost = Number(draft.maxCost.trim());
  if (draft.maxCost.trim() === "" || Number.isNaN(maxCost) || maxCost <= 0 || maxCost > LIMITS.maxCost.max) {
    errors.max_cost_usd_per_run = "Use an amount above $0 and up to $50.";
  }
  const percent = Number(draft.spotCheckPercent.trim());
  if (draft.spotCheckPercent.trim() === "" || Number.isNaN(percent) || percent < 0 || percent > 100) {
    errors.spot_check_rate = "Use a percentage from 0 to 100.";
  }
  if (draft.model.trim() === "") {
    errors.model = "Name the model to use.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors, config: null };
  }

  const config: SearchConfigInput = {
    id: "default",
    queries: draft.queries.map((query) => ({
      label: query.label.trim(),
      text: query.text.trim(),
      collectors: query.collectors,
      enabled: query.enabled,
    })),
    lookback_days: Number(draft.lookbackDays),
    max_items_per_run: Number(draft.maxItems),
    max_cost_usd_per_run: maxCost,
    // Rounded so 3 becomes 0.03, not 0.030000000000000002.
    spot_check_rate: Math.round(percent * 100) / 10000,
    model: draft.model.trim(),
    effort: draft.effort,
  };
  return { errors, config };
}

// The top-level fields with errors, in page order. Their input ids match the keys.
const TOP_LEVEL_FIELDS = ["lookback_days", "max_items_per_run", "max_cost_usd_per_run", "spot_check_rate", "model"];

// Puts focus on the first field with an error, in page order, so a keyboard
// or screen reader user lands on what needs fixing.
function focusFirstError(errors: Errors, queryCount: number): void {
  const ids: string[] = [];
  for (let index = 0; index < queryCount; index += 1) {
    if (errors[`queries.${index}.label`]) {
      ids.push(`query-${index}-label`);
    }
    if (errors[`queries.${index}.text`]) {
      ids.push(`query-${index}-text`);
    }
    if (errors[`queries.${index}.collectors`]) {
      ids.push(`query-${index}-${SEARCH_COLLECTORS[0]}`);
    }
  }
  for (const key of TOP_LEVEL_FIELDS) {
    if (errors[key]) {
      ids.push(key);
    }
  }
  if (ids.length > 0) {
    document.getElementById(ids[0])?.focus();
  }
}

// The draft without React keys, for spotting unsaved changes.
function comparable(draft: ConfigDraft): string {
  const queries: unknown[][] = [];
  for (const query of draft.queries) {
    queries.push([query.label, query.text, query.collectors.join(","), query.enabled]);
  }
  return JSON.stringify([queries, draft.lookbackDays, draft.maxItems, draft.maxCost, draft.spotCheckPercent, draft.model, draft.effort]);
}

export function SettingsView() {
  const loaded = useApiData("search-config", getSearchConfig);
  // After a save, what the API stored is what the form shows. Counting saves
  // gives the form a fresh key, so it starts again from those values.
  const [saved, setSaved] = useState<{ config: SearchConfig; count: number } | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const shown = saved ? saved.config : loaded.data;

  function onSaved(config: SearchConfig) {
    setSaved((previous) => ({ config, count: previous ? previous.count + 1 : 1 }));
    setSavedMessage("Saved. The next run uses these settings.");
  }

  return (
    <>
      <AdminPageHead
        eyebrow="Team admin"
        title={
          <>
            Search <em>settings</em>
          </>
        }
        lede="What the pipeline searches for and how much a single run may do. Changes apply from the next run."
      />
      <div className={`container ${detail.page}`}>
        {loaded.error && !shown && (
          <ApiErrorNotice error={loaded.error} title="Couldn't load the settings" onRetry={loaded.reload} />
        )}
        {!loaded.error && !shown && <p className={detail.muted}>Loading&hellip;</p>}
        {shown && (
          <>
            <p className={detail.muted}>
              {saved && !shown.updated_at ? "You changed these just now." : lastChangedText(shown)}
            </p>
            <SettingsForm
              key={saved ? `saved-${saved.count}` : "loaded"}
              initial={shown}
              savedMessage={savedMessage}
              onSaved={onSaved}
              onEdited={() => setSavedMessage(null)}
            />
          </>
        )}
      </div>
    </>
  );
}

function lastChangedText(config: SearchConfig): string {
  // "seed" is the API filling in the default searches on a fresh database.
  if (config.updated_by === "seed" && config.updated_at) {
    return `These are the starting settings, set up on ${formatDateTime(config.updated_at)}. Nobody has changed them yet.`;
  }
  if (config.updated_by && config.updated_at) {
    return `Last changed by ${config.updated_by} on ${formatDateTime(config.updated_at)}.`;
  }
  if (config.updated_at) {
    return `Last changed on ${formatDateTime(config.updated_at)}.`;
  }
  return "Nobody has changed these since they were first set up.";
}

interface SettingsFormProps {
  initial: SearchConfig;
  savedMessage: string | null;
  onSaved: (saved: SearchConfig) => void;
  onEdited: () => void;
}

function SettingsForm({ initial, savedMessage, onSaved, onEdited }: SettingsFormProps) {
  const [draft, setDraft] = useState<ConfigDraft>(() => toDraft(initial));
  const [baseline] = useState<string>(() => comparable(toDraft(initial)));
  const [errors, setErrors] = useState<Errors>({});
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  // The last search removed, and where it was, until it's put back or another goes.
  const [removed, setRemoved] = useState<{ query: QueryDraft; index: number } | null>(null);

  const dirty = comparable(draft) !== baseline;
  useUnsavedWork(dirty);
  let enabledCount = 0;
  for (const query of draft.queries) {
    if (query.enabled) {
      enabledCount += 1;
    }
  }

  function update(patch: Partial<ConfigDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    onEdited();
  }

  function updateQuery(index: number, patch: Partial<QueryDraft>) {
    setDraft((previous) => {
      const queries = [...previous.queries];
      queries[index] = { ...queries[index], ...patch };
      return { ...previous, queries };
    });
    onEdited();
  }

  function toggleCollector(index: number, collector: SearchCollector, on: boolean) {
    const current = draft.queries[index].collectors;
    const next: SearchCollector[] = [];
    for (const item of SEARCH_COLLECTORS) {
      const wanted = item === collector ? on : current.includes(item);
      if (wanted) {
        next.push(item);
      }
    }
    updateQuery(index, { collectors: next });
  }

  function addQuery() {
    setDraft((previous) => ({
      ...previous,
      queries: [
        ...previous.queries,
        { key: newQueryKey(), label: "", text: "", collectors: [...SEARCH_COLLECTORS], enabled: true },
      ],
    }));
    onEdited();
  }

  function removeQuery(index: number) {
    setRemoved({ query: draft.queries[index], index });
    setDraft((previous) => {
      const queries: QueryDraft[] = [];
      for (let position = 0; position < previous.queries.length; position += 1) {
        if (position !== index) {
          queries.push(previous.queries[position]);
        }
      }
      return { ...previous, queries };
    });
    // Errors are keyed by position, so they'd point at the wrong rows now.
    setErrors({});
    onEdited();
  }

  function undoRemove() {
    if (!removed) {
      return;
    }
    const { query, index } = removed;
    setDraft((previous) => {
      const queries = [...previous.queries];
      queries.splice(Math.min(index, queries.length), 0, query);
      return { ...previous, queries };
    });
    setRemoved(null);
    setErrors({});
    onEdited();
    // The Undo button goes away, so focus moves to the search that came back.
    window.setTimeout(() => document.getElementById(`query-${index}-label`)?.focus(), 0);
  }

  function discard() {
    setRemoved(null);
    setDraft(toDraft(initial));
    setErrors({});
    setServerProblems([]);
    setSaveError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(draft);
    setErrors(result.errors);
    setServerProblems([]);
    setSaveError(null);
    if (!result.config) {
      focusFirstError(result.errors, draft.queries.length);
      return;
    }
    setSaving(true);
    try {
      const stored = await saveSearchConfig(result.config);
      // If the API doesn't echo the config back, what we sent is what it stored.
      onSaved(stored ?? { ...result.config, updated_by: null, updated_at: null });
    } catch (error) {
      const apiError = toApiError(error);
      // Validation errors from the API go next to their fields when we know the field.
      const fieldErrors = fieldErrorsFrom(apiError);
      if (fieldErrors.length > 0) {
        const mapped: Errors = {};
        const unplaced: string[] = [];
        for (const item of fieldErrors) {
          if (item.path !== "" && isKnownPath(item.path, draft.queries.length)) {
            mapped[item.path] = item.message;
          } else {
            unplaced.push(item.path ? `${item.path}: ${item.message}` : item.message);
          }
        }
        setErrors(mapped);
        setServerProblems(unplaced);
        focusFirstError(mapped, draft.queries.length);
      }
      setSaveError(apiError);
    } finally {
      setSaving(false);
    }
  }

  const errorCount = Object.keys(errors).length + serverProblems.length;

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <section className={detail.section} aria-labelledby="queries-heading">
        <div className={styles.sectionHead}>
          <h2 id="queries-heading" className={detail.sectionTitle}>
            The <em>searches</em>
          </h2>
          <p className={detail.muted}>
            {enabledCount === 1 ? "1 search is on." : `${enabledCount} searches are on.`}
            {enabledCount === 0 && " With none on, runs won't collect anything."}
          </p>
        </div>

        <ol className={styles.queries}>
          {draft.queries.map((query, index) => (
            <QueryItem
              key={query.key}
              off={!query.enabled}
              removedHere={removed !== null && removed.index === index ? removed.query : null}
              onUndo={undoRemove}
            >
              <QueryEditor
                index={index}
                query={query}
                errors={errors}
                disabled={saving}
                onChange={(patch) => updateQuery(index, patch)}
                onToggleCollector={(collector, on) => toggleCollector(index, collector, on)}
                onRemove={() => removeQuery(index)}
              />
            </QueryItem>
          ))}
          {removed !== null && removed.index >= draft.queries.length && (
            <RemovedSearch query={removed.query} onUndo={undoRemove} />
          )}
        </ol>
        <div>
          <button type="button" className={`btn btn-secondary ${forms.button} ${forms.smallButton}`} onClick={addQuery} disabled={saving}>
            Add a search
          </button>
        </div>
      </section>

      <section className={`paper ${detail.card}`} aria-labelledby="limits-heading">
        <h2 id="limits-heading" className={detail.cardTitle}>
          Limits for each <em>run</em>
        </h2>
        <div className={styles.limitsGrid}>
          <NumberField
            id="lookback_days"
            label="Look back (days)"
            value={draft.lookbackDays}
            error={errors.lookback_days}
            hint="How far back each search goes. Papers older than this are skipped."
            disabled={saving}
            onChange={(value) => update({ lookbackDays: value })}
          />
          <NumberField
            id="max_items_per_run"
            label="Papers the AI reads per run, at most"
            value={draft.maxItems}
            error={errors.max_items_per_run}
            hint="New papers past this stay New until the next run. Collecting has its own cap of 500 per search on each site."
            disabled={saving}
            onChange={(value) => update({ maxItems: value })}
          />
          <NumberField
            id="max_cost_usd_per_run"
            label="AI spend per run, at most ($)"
            step="0.5"
            value={draft.maxCost}
            error={errors.max_cost_usd_per_run}
            hint="Triage stops when a run reaches this. One paper costs about $0.0006 at current Haiku prices."
            disabled={saving}
            onChange={(value) => update({ maxCost: value })}
          />
          <NumberField
            id="spot_check_rate"
            label="Spot checks (%)"
            step="0.5"
            value={draft.spotCheckPercent}
            error={errors.spot_check_rate}
            hint="The share of papers the AI rules out that still go to a person, to see how often it's wrong."
            disabled={saving}
            onChange={(value) => update({ spotCheckPercent: value })}
          />
        </div>
      </section>

      <section className={`paper ${detail.card}`} aria-labelledby="model-heading">
        <h2 id="model-heading" className={detail.cardTitle}>
          The triage <em>model</em>
        </h2>
        <div className={styles.limitsGrid}>
          <div className={forms.field}>
            <label htmlFor="model" className={forms.label}>
              Model
            </label>
            <input
              id="model"
              className={`${forms.input} ${errors.model ? forms.invalid : ""}`}
              value={draft.model}
              onChange={(event) => update({ model: event.target.value })}
              disabled={saving}
              spellCheck={false}
              aria-invalid={errors.model ? true : undefined}
              aria-describedby={errors.model ? "model-hint model-error" : "model-hint"}
            />
            <p id="model-hint" className={forms.hint}>
              Which Claude model reads the papers. The default is claude-haiku-5-5.
            </p>
            {errors.model && (
              <p id="model-error" className={forms.error}>
                {errors.model}
              </p>
            )}
          </div>
          <div className={forms.field}>
            <label htmlFor="effort" className={forms.label}>
              Effort
            </label>
            <select
              id="effort"
              className={forms.select}
              value={draft.effort}
              onChange={(event) => update({ effort: event.target.value as Effort })}
              disabled={saving}
              aria-describedby="effort-hint"
            >
              {EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {effort[0].toUpperCase() + effort.slice(1)}
                </option>
              ))}
            </select>
            <p id="effort-hint" className={forms.hint}>
              How much the model thinks about each paper. Higher costs more per paper. We run it at Low.
            </p>
          </div>
        </div>
      </section>

      <div className={styles.saveBar}>
        {errorCount > 0 && (
          <Notice tone="error" title={errorCount === 1 ? "One thing to fix before saving." : `${errorCount} things to fix before saving.`}>
            {serverProblems.length > 0 && (
              <ul className={styles.problemList}>
                {serverProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
            {Object.keys(errors).length > 0 && <p>Each one is marked next to its field.</p>}
          </Notice>
        )}
        {saveError && errorCount === 0 && <ApiErrorNotice error={saveError} title="The settings weren't saved" />}
        {savedMessage && !dirty && <Notice tone="success" title={savedMessage} />}
        <div className={forms.actions}>
          <button type="submit" className={`btn btn-primary ${forms.button}`} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save the settings"}
          </button>
          {dirty && (
            <button type="button" className={forms.linkButton} onClick={discard} disabled={saving}>
              Discard changes
            </button>
          )}
          {!dirty && !savedMessage && <span className={detail.muted}>No unsaved changes.</span>}
        </div>
      </div>
    </form>
  );
}

interface QueryItemProps {
  // A search that's switched off looks quieter.
  off: boolean;
  // The search removed from just above this one, if any, so its Undo sits where it was.
  removedHere: QueryDraft | null;
  onUndo: () => void;
  children: ReactNode;
}

function QueryItem({ off, removedHere, onUndo, children }: QueryItemProps) {
  return (
    <>
      {removedHere && <RemovedSearch query={removedHere} onUndo={onUndo} />}
      <li className={`paper ${styles.query} ${off ? styles.queryOff : ""}`}>{children}</li>
    </>
  );
}

// Where a removed search was. It stays removed only once the settings are saved.
function RemovedSearch({ query, onUndo }: { query: QueryDraft; onUndo: () => void }) {
  const name = query.label.trim() || "The search";
  // The Remove button that had focus is gone, so focus lands on Undo.
  const undoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    undoRef.current?.focus();
  }, []);
  return (
    <li className={styles.removed} role="status">
      <span>
        Removed <strong>{name}</strong>. It&rsquo;s gone for good once you save.
      </span>
      <button ref={undoRef} type="button" className={forms.linkButton} onClick={onUndo}>
        Undo
      </button>
    </li>
  );
}

// Whether an API error path points at a field this form shows.
function isKnownPath(path: string, queryCount: number): boolean {
  const topLevel = ["lookback_days", "max_items_per_run", "max_cost_usd_per_run", "spot_check_rate", "model"];
  if (topLevel.includes(path)) {
    return true;
  }
  const parts = path.split(".");
  if (parts.length === 3 && parts[0] === "queries") {
    const index = Number(parts[1]);
    return Number.isInteger(index) && index >= 0 && index < queryCount && ["label", "text", "collectors"].includes(parts[2]);
  }
  return false;
}

interface QueryEditorProps {
  index: number;
  query: QueryDraft;
  errors: Errors;
  disabled: boolean;
  onChange: (patch: Partial<QueryDraft>) => void;
  onToggleCollector: (collector: SearchCollector, on: boolean) => void;
  onRemove: () => void;
}

function QueryEditor({ index, query, errors, disabled, onChange, onToggleCollector, onRemove }: QueryEditorProps) {
  const prefix = `query-${index}`;
  const labelError = errors[`queries.${index}.label`];
  const textError = errors[`queries.${index}.text`];
  const collectorsError = errors[`queries.${index}.collectors`];
  const name = query.label.trim() || `Search ${index + 1}`;

  return (
    <div className={styles.queryBody}>
      <div className={styles.queryHead}>
        <div className={styles.queryToggle}>
          <label className={forms.checkRow}>
            <input
              type="checkbox"
              className={forms.checkbox}
              checked={query.enabled}
              onChange={(event) => onChange({ enabled: event.target.checked })}
              disabled={disabled}
            />
            {/* The hidden name tells screen reader users which search this is */}
            <span>
              Use this search<span className="visually-hidden">: {name}</span>
            </span>
          </label>
          {!query.enabled && <span className={styles.offNote}>Off. Runs skip this search.</span>}
        </div>
        <button
          type="button"
          className={forms.linkButton}
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${name}`}
        >
          Remove
        </button>
      </div>

      <div className={forms.field}>
        <label htmlFor={`${prefix}-label`} className={forms.label}>
          Label
        </label>
        <input
          id={`${prefix}-label`}
          className={`${forms.input} ${labelError ? forms.invalid : ""}`}
          value={query.label}
          onChange={(event) => onChange({ label: event.target.value })}
          disabled={disabled}
          aria-invalid={labelError ? true : undefined}
          aria-describedby={labelError ? `${prefix}-label-error` : undefined}
        />
        {labelError && (
          <p id={`${prefix}-label-error`} className={forms.error}>
            {labelError}
          </p>
        )}
      </div>

      <div className={forms.field}>
        <label htmlFor={`${prefix}-text`} className={forms.label}>
          Search terms
        </label>
        <textarea
          id={`${prefix}-text`}
          className={`${forms.textarea} ${styles.queryText} ${textError ? forms.invalid : ""}`}
          value={query.text}
          onChange={(event) => onChange({ text: event.target.value })}
          disabled={disabled}
          spellCheck={false}
          aria-invalid={textError ? true : undefined}
          aria-describedby={textError ? `${prefix}-text-hint ${prefix}-text-error` : `${prefix}-text-hint`}
        />
        <p id={`${prefix}-text-hint`} className={forms.hint}>
          Quotes for exact phrases, AND and OR to combine them.
        </p>
        {textError && (
          <p id={`${prefix}-text-error`} className={forms.error}>
            {textError}
          </p>
        )}
      </div>

      <fieldset className={forms.fieldset} disabled={disabled}>
        <legend className={forms.legend}>Search in</legend>
        <div className={styles.collectorRow}>
          {SEARCH_COLLECTORS.map((collector) => (
            <label key={collector} className={forms.checkRow}>
              <input
                id={`${prefix}-${collector}`}
                type="checkbox"
                className={forms.checkbox}
                checked={query.collectors.includes(collector)}
                onChange={(event) => onToggleCollector(collector, event.target.checked)}
              />
              <span>{COLLECTOR_LABELS[collector]}</span>
            </label>
          ))}
        </div>
        {collectorsError && <p className={forms.error}>{collectorsError}</p>}
      </fieldset>
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  hint: string;
  error: string | undefined;
  disabled: boolean;
  step?: string;
  onChange: (value: string) => void;
}

function NumberField({ id, label, value, hint, error, disabled, step, onChange }: NumberFieldProps) {
  return (
    <div className={forms.field}>
      <label htmlFor={id} className={forms.label}>
        {label}
      </label>
      <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step ?? "1"}
          className={`${forms.input} ${styles.numberInput} ${error ? forms.invalid : ""}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
        />
      <p id={`${id}-hint`} className={forms.hint}>
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} className={forms.error}>
          {error}
        </p>
      )}
    </div>
  );
}
