"use client";

import { useRef, useState, type FormEvent } from "react";

import type { Runner, RunStage } from "@/lib/adminTypes";
import { startRun, toApiError, type ApiError } from "@/lib/api";

import styles from "./Dashboard.module.css";
import forms from "./forms.module.css";
import { ApiErrorNotice, Notice } from "./Notice";

interface RunPanelProps {
  // False until the pipeline status has loaded.
  ready: boolean;
  runIsGoing: boolean;
  runner: Runner | null;
  // null when the API can't tell, as with the GitHub runner.
  triageConfigured: boolean | null;
  onStarted: (runId: string) => void;
}

// Parses the optional limit. Returns undefined for "no limit", null when invalid.
function parseLimit(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

export function RunPanel({ ready, runIsGoing, runner, triageConfigured, onStarted }: RunPanelProps) {
  const [collect, setCollect] = useState(true);
  const [triage, setTriage] = useState(true);
  const [limitText, setLimitText] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const limitRef = useRef<HTMLInputElement>(null);

  const disabled = !ready || runIsGoing || submitting;
  // With no AI set up, triage would only be skipped, so the box is off and
  // can't be ticked. null means the server can't tell (GitHub), so it stays on offer.
  const triageAvailable = triageConfigured !== false;
  const triageChosen = triage && triageAvailable;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stages: RunStage[] = [];
    if (collect) {
      stages.push("collect");
    }
    if (triageChosen) {
      stages.push("triage");
    }
    if (stages.length === 0) {
      setFormError("Pick at least one stage.");
      return;
    }
    // A number box reports "" for text it can't parse, like "1e" or "--5",
    // which would otherwise read as "no limit".
    const unreadable = limitRef.current !== null && limitRef.current.validity.badInput;
    const limit = parseLimit(limitText);
    if (unreadable || limit === null) {
      setFormError("The limit has to be a whole number, 1 or more. Leave it empty for no limit.");
      return;
    }

    setFormError(null);
    setApiError(null);
    setSubmitting(true);
    try {
      const started = await startRun({ stages, limit, dry_run: dryRun });
      onStarted(started.id);
    } catch (error) {
      setApiError(toApiError(error));
    } finally {
      setSubmitting(false);
    }
  }

  let runnerNote = "";
  if (runner === "local") {
    runnerNote = "The run starts right away.";
  } else if (runner === "github") {
    runnerNote = "Runs on GitHub, so it can take a minute or two to start.";
  }

  return (
    <section className={`paper ${styles.panel}`} aria-labelledby="run-heading">
      <h2 id="run-heading" className={styles.panelTitle}>
        Run the <em>pipeline</em>
      </h2>
      {runnerNote && <p className={styles.panelNote}>{runnerNote}</p>}

      <form className={styles.runForm} onSubmit={onSubmit} noValidate>
        <fieldset className={forms.fieldset} disabled={disabled}>
          <legend className={forms.legend}>Stages</legend>
          <label className={forms.checkRow}>
            <input
              type="checkbox"
              className={forms.checkbox}
              checked={collect}
              onChange={(event) => setCollect(event.target.checked)}
            />
            <span>
              <strong>Collect.</strong> Search arXiv and Semantic Scholar for new papers.
            </span>
          </label>
          <label className={forms.checkRow}>
            <input
              type="checkbox"
              className={forms.checkbox}
              checked={triageChosen}
              onChange={(event) => setTriage(event.target.checked)}
              disabled={!triageAvailable}
              aria-describedby={triageAvailable ? undefined : "triage-off-reason"}
            />
            <span>
              <strong>Triage.</strong> The AI reads each new paper&rsquo;s title and abstract and sorts it.
              {triageConfigured === null &&
                runner === "github" &&
                " If the AI isn't set up on GitHub, the run log says so."}
            </span>
          </label>
          {!triageAvailable && (
            <p id="triage-off-reason" className={forms.hint}>
              Not available yet: the AI isn&rsquo;t set up on this server.
            </p>
          )}
        </fieldset>

        <div className={styles.runOptions}>
          <div className={forms.field}>
            <label htmlFor="run-limit" className={forms.label}>
              Limit <span className={forms.optional}>(optional)</span>
            </label>
            <input
              ref={limitRef}
              id="run-limit"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              className={`${forms.input} ${styles.limitInput}`}
              value={limitText}
              onChange={(event) => setLimitText(event.target.value)}
              disabled={disabled}
              aria-describedby="run-limit-hint"
            />
            <p id="run-limit-hint" className={forms.hint}>
              At most this many papers from each search on each site, and at most this many triaged. Leave it
              empty to fetch up to 500 from each search on each site, and to triage up to the limit in Settings.
            </p>
          </div>

          <label className={forms.checkRow}>
            <input
              type="checkbox"
              className={forms.checkbox}
              checked={dryRun}
              onChange={(event) => setDryRun(event.target.checked)}
              disabled={disabled}
            />
            <span>
              <strong>Dry run.</strong> Searches and counts what it would add, but saves no papers and doesn&rsquo;t
              call the AI. The run still shows up below.
            </span>
          </label>
        </div>

        {formError && <p className={forms.error}>{formError}</p>}
        {apiError && apiError.status === 409 && (
          <Notice tone="warning" title="A run is already going.">
            <p>Only one run can happen at a time. Wait for it to finish, then start another.</p>
          </Notice>
        )}
        {apiError && apiError.status !== 409 && <ApiErrorNotice error={apiError} title="The run didn't start" />}

        <div className={forms.actions}>
          <button type="submit" className={`btn btn-primary ${forms.button}`} disabled={disabled}>
            {submitting ? "Starting…" : "Start the run"}
          </button>
          {runIsGoing && <span className={styles.panelNote}>A run is going. You can start another once it finishes.</span>}
        </div>
      </form>
    </section>
  );
}
