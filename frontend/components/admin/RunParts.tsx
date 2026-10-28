"use client";

import Link from "next/link";

import type { PipelineRun, StageCounts } from "@/lib/adminTypes";

import { formatCost, formatCount, formatDateTime, isRunActive, logLinesInLocalTime, runHref } from "./adminFormat";
import { RunStatusChip } from "./Chips";
import { DRY_RUN_COUNT_LABELS, RUN_TRIGGER_LABELS, STAGE_COUNT_LABELS, STAGE_LABELS } from "./labels";
import styles from "./runs.module.css";

function isDryRun(run: PipelineRun): boolean {
  return run.options.dry_run === true;
}

// A count's label and hint, worded for a dry run when it was one.
function countWording(run: PipelineRun, item: (typeof STAGE_COUNT_LABELS)[number]): { label: string; hint: string } {
  if (isDryRun(run)) {
    const dryRunWording = DRY_RUN_COUNT_LABELS[item.key];
    if (dryRunWording) {
      return dryRunWording;
    }
  }
  return item;
}

// How often the live views ask for an update while a run is going.
export const POLL_INTERVAL_MS = 2500;

export function stagesText(run: PipelineRun): string {
  const names: string[] = [];
  for (const stage of run.stages) {
    names.push(STAGE_LABELS[stage]);
  }
  return names.length > 0 ? names.join(" and ") : "No stages";
}

export function startedByText(run: PipelineRun): string {
  if (run.requested_by) {
    return `${RUN_TRIGGER_LABELS[run.trigger]}, by ${run.requested_by}`;
  }
  return RUN_TRIGGER_LABELS[run.trigger];
}

// The counts that only mean something once the AI has read papers.
const TRIAGE_COUNTS: (keyof StageCounts)[] = [
  "triaged",
  "relevant",
  "unsure",
  "triaged_out",
  "spot_checks",
  "quote_mismatches",
  "failed",
];

// Whether the AI read anything in this run (or still might, while it runs).
// A collect-only run, or one whose triage was skipped, would otherwise show a
// row of zeros for counts that never had a chance to move.
export function triageRan(run: PipelineRun): boolean {
  if (!run.stages.includes("triage")) {
    return false;
  }
  if (isRunActive(run)) {
    return true;
  }
  return run.counts.triaged > 0 || run.counts.failed > 0 || run.cost_usd > 0;
}

// The counts worth showing for this run, in the usual order.
function shownCounts(run: PipelineRun): (typeof STAGE_COUNT_LABELS)[number][] {
  const showTriage = triageRan(run);
  const shown: (typeof STAGE_COUNT_LABELS)[number][] = [];
  for (const item of STAGE_COUNT_LABELS) {
    if (TRIAGE_COUNTS.includes(item.key) && !showTriage) {
      continue;
    }
    // Skipped only matters when something was left for the next run.
    if (item.key === "skipped" && (run.counts.skipped ?? 0) === 0) {
      continue;
    }
    shown.push(item);
  }
  return shown;
}

// The stage counts that apply to this run, with a short note on what each one means.
export function RunCounts({ run, showHints = false }: { run: PipelineRun; showHints?: boolean }) {
  const showCost = triageRan(run);
  return (
    <dl className={styles.counts}>
      {shownCounts(run).map((item) => {
        const wording = countWording(run, item);
        return (
          <div key={item.key} className={styles.count} title={showHints ? undefined : wording.hint}>
            <dt className={styles.countLabel}>{wording.label}</dt>
            <dd className={styles.countValue}>{formatCount(run.counts[item.key] ?? 0)}</dd>
            {showHints && <dd className={styles.countHint}>{wording.hint}</dd>}
          </div>
        );
      })}
      {showCost && (
        <div className={styles.count}>
          <dt className={styles.countLabel}>Cost</dt>
          <dd className={styles.countValue}>{formatCost(run.cost_usd)}</dd>
          {showHints && <dd className={styles.countHint}>What the AI calls cost</dd>}
        </div>
      )}
    </dl>
  );
}

// Log lines in a monospace list, with their times in the reader's zone.
// `last` keeps only the newest few.
export function RunLog({ run, last }: { run: PipelineRun; last?: number }) {
  const lines = logLinesInLocalTime(run.log, run.started_at);
  if (lines.length === 0) {
    return <p className={styles.empty}>Nothing logged yet.</p>;
  }
  const start = last === undefined ? 0 : Math.max(0, lines.length - last);
  const shown = lines.slice(start);
  return (
    <ol className={styles.log} start={start + 1}>
      {shown.map((line, index) => (
        <li key={start + index} className={styles.logLine}>
          {line}
        </li>
      ))}
    </ol>
  );
}

export function RecentRunsTable({ runs }: { runs: PipelineRun[] }) {
  return (
    <table className={styles.table}>
      <caption className="visually-hidden">Recent pipeline runs, newest first</caption>
      <thead>
        <tr>
          <th scope="col">Started</th>
          <th scope="col">Status</th>
          <th scope="col">Stages</th>
          <th scope="col">Started by</th>
          <th scope="col" className={styles.numeric}>
            New papers
          </th>
          <th scope="col" className={styles.numeric}>
            Triaged
          </th>
          <th scope="col" className={styles.numeric}>
            Cost
          </th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <th scope="row" className={styles.rowHead}>
              <Link href={runHref(run.id)}>{formatDateTime(run.started_at)}</Link>
            </th>
            <td data-label="Status">
              {/* One wrapper, so the narrow-screen grid keeps both on the value side */}
              <span>
                <RunStatusChip status={run.status} />
                {isDryRun(run) && <span className={styles.dryRun}>Dry run</span>}
              </span>
            </td>
            <td data-label="Stages">{stagesText(run)}</td>
            <td data-label="Started by" className={styles.startedBy}>
              {startedByText(run)}
            </td>
            <td data-label="New papers" className={styles.numeric}>
              {formatCount(run.counts.new)}
            </td>
            <td data-label={isDryRun(run) ? "Would triage" : "Triaged"} className={styles.numeric}>
              <span>
                {formatCount(run.counts.triaged)}
                {isDryRun(run) && <span className={styles.dryRun}>Not sent to the AI</span>}
              </span>
            </td>
            <td data-label="Cost" className={styles.numeric}>
              {formatCost(run.cost_usd)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
