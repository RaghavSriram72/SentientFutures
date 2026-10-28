"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import type { PipelineRun } from "@/lib/adminTypes";
import { getRun } from "@/lib/api";

import { AdminPageHead } from "./AdminPageHead";
import { formatCount, formatDateTime, formatDuration, isRunActive, timeZoneLabel } from "./adminFormat";
import { RunStatusChip } from "./Chips";
import styles from "./Detail.module.css";
import { RUNNER_LABELS, RUN_TRIGGER_LABELS } from "./labels";
import { ApiErrorNotice, Notice } from "./Notice";
import { POLL_INTERVAL_MS, RunCounts, RunLog, stagesText, triageRan } from "./RunParts";
import { useApiData } from "./useApiData";

// /admin/runs/?id=<run id>. Reads the id from the query string because a
// static export can't have a page per run.
export function RunDetailView() {
  const id = useSearchParams().get("id") ?? "";
  if (id === "") {
    return (
      <>
        <AdminPageHead eyebrow="Pipeline run" title={<>No run <em>chosen</em></>} kicker={<BackLink />} />
        <div className={`container ${styles.page}`}>
          <Notice tone="info">
            <p>
              This page needs a run id. Pick a run from the <Link href="/admin/">dashboard</Link>.
            </p>
          </Notice>
        </div>
      </>
    );
  }
  return <RunDetail key={id} id={id} />;
}

function BackLink() {
  return <Link href="/admin/">Back to the dashboard</Link>;
}

function RunDetail({ id }: { id: string }) {
  const { data: run, error, reload } = useApiData(`run:${id}`, () => getRun(id));
  const active = run !== null && isRunActive(run);

  // Same polling as the dashboard: each answer schedules the next request.
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setTimeout(reload, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [active, run, error, reload]);

  // A run id that doesn't exist, e.g. from a database that has since been reset.
  if (error && !run && error.status === 404) {
    return (
      <>
        <AdminPageHead eyebrow="Pipeline run" title={<>Run not <em>found</em></>} kicker={<BackLink />} />
        <div className={`container ${styles.page}`}>
          <Notice tone="info" title="There's no run with this id.">
            <p>
              It may have been in a database that has since been reset. The{" "}
              <Link href="/admin/">dashboard</Link> lists the runs there are.
            </p>
          </Notice>
        </div>
      </>
    );
  }

  let title = (
    <>
      Loading the <em>run</em>
    </>
  );
  if (run) {
    title = (
      <>
        Run from <em>{formatDateTime(run.started_at)}</em>
      </>
    );
  } else if (error) {
    title = (
      <>
        This run didn&rsquo;t <em>load</em>
      </>
    );
  }

  return (
    <>
      <AdminPageHead
        eyebrow="Pipeline run"
        title={title}
        kicker={<BackLink />}
        actions={run ? <RunStatusChip status={run.status} /> : undefined}
      />
      <div className={`container ${styles.page}`}>
        {error && !run && <ApiErrorNotice error={error} title="Couldn't load this run" onRetry={reload} />}
        {!error && !run && <p className={styles.muted}>Loading the run&hellip;</p>}
        {run && <RunBody run={run} active={active} />}
      </div>
    </>
  );
}

function optionText(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Not set";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

// The labels for options the pipeline is known to record; anything else shows by key.
const OPTION_LABELS: Record<string, string> = {
  limit: "Limit",
  dry_run: "Dry run",
  lookback_days: "Lookback (days)",
};

function RunBody({ run, active }: { run: PipelineRun; active: boolean }) {
  const duration = formatDuration(run.started_at, run.finished_at);
  const optionKeys = Object.keys(run.options);

  return (
    <>
      {active && (
        <Notice tone="info">
          <p>This run is still going. The page refreshes every few seconds.</p>
        </Notice>
      )}

      {run.errors.length > 0 && (
        <section className={styles.section} aria-labelledby="errors-heading">
          <h2 id="errors-heading" className={styles.sectionTitle}>
            Errors
          </h2>
          <ol className={styles.errorList}>
            {run.errors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ol>
        </section>
      )}

      <section className={`paper ${styles.card}`} aria-labelledby="facts-heading">
        <h2 id="facts-heading" className={styles.cardTitle}>
          About this run
        </h2>
        <dl className={styles.facts}>
          <Fact label="Stages">{stagesText(run)}</Fact>
          <Fact label="Started by">{RUN_TRIGGER_LABELS[run.trigger]}</Fact>
          <Fact label="Requested by">{run.requested_by || "Not recorded"}</Fact>
          <Fact label="Started">{formatDateTime(run.started_at)}</Fact>
          <Fact label="Finished">{run.finished_at ? formatDateTime(run.finished_at) : "Not yet"}</Fact>
          <Fact label="Took">{duration ?? "Still going"}</Fact>
          {optionKeys.map((key) => (
            <Fact key={key} label={OPTION_LABELS[key] ?? key}>
              {optionText(run.options[key])}
            </Fact>
          ))}
        </dl>
        {/* For whoever debugs the pipeline. Reviewers rarely need any of it. */}
        <details className={styles.technical}>
          <summary>Technical details</summary>
          <dl className={styles.facts}>
            <Fact label="Run id" mono>
              {run.id}
            </Fact>
            <Fact label="Runner">{RUNNER_LABELS[run.runner] ?? run.runner}</Fact>
            <Fact label="Last heartbeat">{formatDateTime(run.heartbeat_at)}</Fact>
            {triageRan(run) && (
              <>
                <Fact label="Input tokens">{formatCount(run.usage.input_tokens)}</Fact>
                <Fact label="Output tokens">{formatCount(run.usage.output_tokens)}</Fact>
                <Fact label="Cache reads">{formatCount(run.usage.cache_read_input_tokens)}</Fact>
                <Fact label="Cache writes">{formatCount(run.usage.cache_creation_input_tokens)}</Fact>
              </>
            )}
          </dl>
        </details>
      </section>

      <section className={styles.section} aria-labelledby="counts-heading">
        <h2 id="counts-heading" className={styles.sectionTitle}>
          What it did
        </h2>
        <RunCounts run={run} showHints />
      </section>

      <section className={styles.section} aria-labelledby="log-heading">
        <h2 id="log-heading" className={styles.sectionTitle}>
          Full log
        </h2>
        <p className={styles.muted}>Times are in your time zone ({timeZoneLabel()}).</p>
        <RunLog run={run} />
      </section>
    </>
  );
}

function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={`${styles.factValue} ${mono ? styles.mono : ""}`}>{children}</dd>
    </div>
  );
}
