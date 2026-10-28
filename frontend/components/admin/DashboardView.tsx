"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { PipelineStatus } from "@/lib/adminTypes";
import { getPipelineStatus, listRuns } from "@/lib/api";

import { AdminPageHead } from "./AdminPageHead";
import { formatCount, isRunActive, queueStatusHref } from "./adminFormat";
import styles from "./Dashboard.module.css";
import forms from "./forms.module.css";
import { DASHBOARD_STATUSES, REVIEW_STATUS_HINTS, REVIEW_STATUS_LABELS } from "./labels";
import { LiveRun } from "./LiveRun";
import { ApiErrorNotice, Notice, SHOW_SETUP_HINTS } from "./Notice";
import { PublishPanel } from "./PublishPanel";
import { POLL_INTERVAL_MS, RecentRunsTable } from "./RunParts";
import { RunPanel } from "./RunPanel";
import { useApiData } from "./useApiData";

const RECENT_RUN_COUNT = 10;

export function DashboardView() {
  const status = useApiData("pipeline-status", getPipelineStatus);
  const runs = useApiData("recent-runs", () => listRuns(RECENT_RUN_COUNT));
  // The run started from this page, until the status catches up with it.
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);

  const latestRun = status.data ? status.data.latest_run : null;
  const activeRunId = status.data ? status.data.active_run_id : null;
  const liveRunId = startedRunId ?? activeRunId ?? (latestRun ? latestRun.id : null);
  let runIsGoing = false;
  if (status.data) {
    runIsGoing = status.data.running || (latestRun !== null && isRunActive(latestRun));
  }

  // While a run goes, keep the tiles current: collect adds papers as it goes.
  // Each answer schedules the next request, like the live run panel.
  const statusData = status.data;
  const statusError = status.error;
  const reloadStatus = status.reload;
  useEffect(() => {
    if (!runIsGoing) {
      return;
    }
    const timer = window.setTimeout(reloadStatus, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [runIsGoing, statusData, statusError, reloadStatus]);

  function refreshAll() {
    status.reload();
    runs.reload();
    setRefreshes((count) => count + 1);
  }

  function onRunStarted(runId: string) {
    if (runId !== "") {
      setStartedRunId(runId);
    }
    refreshAll();
  }

  return (
    <>
      <AdminPageHead
        eyebrow="Team admin"
        title={
          <>
            Source <em>pipeline</em>
          </>
        }
        lede="The pipeline collects new papers and the AI sorts them. Approved papers appear on the public site after the next publish."
        actions={
          <button type="button" className={`btn btn-secondary ${forms.smallButton}`} onClick={refreshAll}>
            Refresh
          </button>
        }
      />

      <div className={`container ${styles.page}`}>
        {status.error && (
          <ApiErrorNotice error={status.error} title="Couldn't load the pipeline status" onRetry={status.reload} />
        )}
        {/* null means the API can't tell (GitHub runner), so no warning then */}
        {status.data && status.data.triage_configured === false && <TriageOffNotice />}

        <PublishPanel refreshes={refreshes} />

        <StatusCounts status={status.data} />

        <div className={styles.runGrid}>
          <RunPanel
            ready={status.data !== null}
            runIsGoing={runIsGoing}
            runner={status.data ? status.data.runner : null}
            triageConfigured={status.data ? status.data.triage_configured : null}
            onStarted={onRunStarted}
          />
          {liveRunId && (
            <LiveRun key={liveRunId} runId={liveRunId} statusSaysRunning={runIsGoing} onFinished={refreshAll} />
          )}
          {/* "No runs yet" only once the status has said so. The error notice above covers a failed load. */}
          {!liveRunId && status.data && (
            <section className={`paper ${styles.panel}`} aria-labelledby="live-heading">
              <h2 id="live-heading" className={styles.panelTitle}>
                No runs <em>yet</em>
              </h2>
              <p className={styles.panelNote}>Start one and its progress shows up here.</p>
            </section>
          )}
          {!liveRunId && !status.data && !status.error && (
            <section className={`paper ${styles.panel}`} aria-labelledby="live-heading">
              <h2 id="live-heading" className={styles.panelTitle}>
                The last <em>run</em>
              </h2>
              <p className={styles.panelNote}>Loading&hellip;</p>
            </section>
          )}
        </div>

        <section className={styles.section} aria-labelledby="runs-heading">
          <h2 id="runs-heading" className={styles.sectionTitle}>
            Recent runs
          </h2>
          {runs.error && <ApiErrorNotice error={runs.error} title="Couldn't load the recent runs" onRetry={runs.reload} />}
          {!runs.error && !runs.data && <p className={styles.panelNote}>Loading&hellip;</p>}
          {runs.data && runs.data.length === 0 && <p className={styles.panelNote}>No runs yet.</p>}
          {runs.data && runs.data.length > 0 && <RecentRunsTable runs={runs.data} />}
        </section>
      </div>
    </>
  );
}

function TriageOffNotice() {
  return (
    <Notice tone="warning" title="The AI isn't sorting papers yet.">
      <p>
        Runs still collect new papers, and they wait in <strong>New</strong>. You can review them yourself from the{" "}
        <Link href={queueStatusHref("new")}>New tab of the queue</Link>, without the AI&rsquo;s suggestions.
      </p>
      {SHOW_SETUP_HINTS && (
        <p>
          To turn triage on, start the API with <code>ANTHROPIC_API_KEY</code> set.
        </p>
      )}
    </Notice>
  );
}

// One tile per review status, each a link to that tab of the queue.
function StatusCounts({ status }: { status: PipelineStatus | null }) {
  return (
    <section aria-labelledby="counts-heading">
      <h2 id="counts-heading" className={styles.sectionTitle}>
        Papers by status
      </h2>
      <ul className={styles.tiles}>
        {DASHBOARD_STATUSES.map((reviewStatus) => {
          const count = status ? (status.counts[reviewStatus] ?? 0) : null;
          const isQueue = reviewStatus === "pending_review";
          return (
            <li key={reviewStatus}>
              <Link
                href={queueStatusHref(reviewStatus)}
                className={`${styles.tile} ${isQueue ? styles.tileQueue : ""}`}
              >
                <span className={styles.tileLabel}>{REVIEW_STATUS_LABELS[reviewStatus]}</span>
                <span className={styles.tileValue}>{count === null ? "…" : formatCount(count)}</span>
                <span className={styles.tileHint}>{REVIEW_STATUS_HINTS[reviewStatus]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
