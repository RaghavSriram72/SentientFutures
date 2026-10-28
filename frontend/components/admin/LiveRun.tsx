"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef } from "react";

import { getRun } from "@/lib/api";

import { formatDateTime, formatDuration, isRunActive, runHref, timeZoneLabel } from "./adminFormat";
import { RunStatusChip } from "./Chips";
import styles from "./Dashboard.module.css";
import { ApiErrorNotice } from "./Notice";
import { POLL_INTERVAL_MS, RunCounts, RunLog, stagesText, startedByText } from "./RunParts";
import { useApiData } from "./useApiData";

// How many of the newest log lines the dashboard shows.
const LIVE_LOG_LINES = 8;

interface LiveRunProps {
  runId: string;
  // What the dashboard's last status check said. If it says a run is going but
  // this run has finished, the dashboard is out of date and should refresh.
  statusSaysRunning: boolean;
  // Called when this view sees the run finish.
  onFinished: () => void;
}

// The current (or most recent) run, refreshed every few seconds while it's going.
export function LiveRun({ runId, statusSaysRunning, onFinished }: LiveRunProps) {
  const { data: run, error, reload } = useApiData(`run:${runId}`, () => getRun(runId));
  const active = run !== null && isRunActive(run);
  const announceFinished = useEffectEvent(onFinished);
  const sawActive = useRef(false);

  // Each answer schedules the next request, so a slow API never gets a pile of
  // overlapping ones. `run` and `error` are listed so every answer re-arms it.
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setTimeout(reload, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [active, run, error, reload]);

  // Tell the dashboard when the run finishes, so the counts and the Start
  // button catch up. A quick run can finish before the first answer arrives,
  // which is why the dashboard's own status counts as having seen it running.
  useEffect(() => {
    if (!run) {
      return;
    }
    if (isRunActive(run)) {
      sawActive.current = true;
    } else if (sawActive.current || statusSaysRunning) {
      sawActive.current = false;
      announceFinished();
    }
  }, [run, statusSaysRunning]);

  return (
    <section className={`paper ${styles.panel}`} aria-labelledby="live-heading">
      <div className={styles.liveHead}>
        <h2 id="live-heading" className={styles.panelTitle}>
          {active ? (
            <>
              Running <em>now</em>
            </>
          ) : (
            <>
              The last <em>run</em>
            </>
          )}
        </h2>
        <div aria-live="polite">{run && <RunStatusChip status={run.status} />}</div>
      </div>

      {error && !run && <ApiErrorNotice error={error} title="Couldn't load the run" onRetry={reload} />}
      {!error && !run && <p className={styles.panelNote}>Loading the run&hellip;</p>}

      {run && (
        <>
          <p className={styles.liveMeta}>
            Started {formatDateTime(run.started_at)} · {stagesText(run)} · {startedByText(run)}
            {run.options.dry_run === true && " · Dry run"}
            {!active && formatDuration(run.started_at, run.finished_at) && (
              <> · Took {formatDuration(run.started_at, run.finished_at)}</>
            )}
          </p>
          {error && <p className={styles.pollError}>Lost touch with the API. Trying again&hellip;</p>}
          <RunCounts run={run} />
          {run.errors.length > 0 && (
            <p className={styles.errorCount}>
              {run.errors.length === 1 ? "1 error" : `${run.errors.length} errors`} so far. The run page lists them.
            </p>
          )}
          <div className={styles.liveLog}>
            <p className="eyebrow">Latest log lines ({timeZoneLabel()})</p>
            <RunLog run={run} last={LIVE_LOG_LINES} />
          </div>
          <Link href={runHref(run.id)} className={styles.detailLink}>
            Full log and details
          </Link>
        </>
      )}
    </section>
  );
}
