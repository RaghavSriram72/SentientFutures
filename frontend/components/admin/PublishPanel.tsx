"use client";

import { useEffect, useState } from "react";

import type { PublishResult, PublishStatus, PublishWaiting } from "@/lib/adminTypes";
import { getPublishStatus, publishSite, toApiError, type ApiError } from "@/lib/api";

import { formatDateTime } from "./adminFormat";
import styles from "./Dashboard.module.css";
import forms from "./forms.module.css";
import noticeStyles from "./Notice.module.css";
import { ApiErrorNotice, Notice } from "./Notice";
import { useApiData } from "./useApiData";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

// "3 approved papers, 1 milestone change and 2 post changes", or "" for none.
export function waitingText(waiting: PublishWaiting): string {
  const parts: string[] = [];
  if (waiting.sources > 0) {
    parts.push(plural(waiting.sources, "approved paper", "approved papers"));
  }
  if (waiting.milestones > 0) {
    parts.push(plural(waiting.milestones, "milestone change", "milestone changes"));
  }
  if (waiting.posts > 0) {
    parts.push(plural(waiting.posts, "blog post change", "blog post changes"));
  }
  if (parts.length === 0) {
    return "";
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function lastPublishedText(status: PublishStatus): string {
  const last = status.last;
  if (last === null || last.requested_at === null) {
    return "Nothing has been published from here yet.";
  }
  const by = last.requested_by ? `, by ${last.requested_by}` : "";
  return `Last publish: ${formatDateTime(last.requested_at)}${by}.`;
}

// The public site is a static copy, rebuilt on each publish. This panel says
// what has changed since the last one and starts the next.
// refreshes: counts the dashboard's Refresh presses, so this panel refreshes too.
export function PublishPanel({ refreshes }: { refreshes: number }) {
  const status = useApiData("publish-status", getPublishStatus);
  const reloadStatus = status.reload;
  useEffect(() => {
    if (refreshes > 0) {
      reloadStatus();
    }
  }, [refreshes, reloadStatus]);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function publish() {
    setPublishing(true);
    setError(null);
    setResult(null);
    try {
      setResult(await publishSite());
      status.reload();
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setPublishing(false);
    }
  }

  // A server without the publish route yet answers 404.
  const notSetUp = status.error !== null && status.error.status === 404;
  let waiting = "";
  let failedAttempt = null;
  if (status.data) {
    waiting = waitingText(status.data.waiting);
    const attempt = status.data.latest_attempt;
    if (attempt && attempt.github_status === "failed") {
      failedAttempt = attempt;
    }
  }

  return (
    <section className={`paper ${styles.publish}`} aria-labelledby="publish-heading">
      <div className={styles.publishText}>
        <h2 id="publish-heading" className={styles.panelTitle}>
          The public <em>site</em>
        </h2>
        {status.data && (
          <>
            <p className={styles.panelNote}>{lastPublishedText(status.data)}</p>
            <p className={styles.publishWaiting}>
              {waiting === "" ? "Nothing new is waiting to go up." : `Waiting for the next publish: ${waiting}.`}
            </p>
            {failedAttempt && (
              <p className={styles.pollError}>
                The publish on {formatDateTime(failedAttempt.requested_at)} didn&rsquo;t go out. Try again, and tell
                whoever looks after the server if it keeps failing.
              </p>
            )}
          </>
        )}
        {!status.data && !status.error && <p className={styles.panelNote}>Checking what&rsquo;s waiting&hellip;</p>}
        {notSetUp && <p className={styles.panelNote}>Publishing isn&rsquo;t set up on this server yet.</p>}
      </div>
      <div className={styles.publishAction}>
        <button
          type="button"
          className={`btn btn-primary ${forms.button}`}
          onClick={() => void publish()}
          disabled={publishing || notSetUp || (!status.data && !status.error)}
        >
          {publishing ? "Publishing…" : "Publish to the site"}
        </button>
      </div>

      <div className={styles.publishResult}>
        {status.error && !notSetUp && (
          <ApiErrorNotice error={status.error} title="Couldn't check the public site" onRetry={status.reload} />
        )}
        {error && <ApiErrorNotice error={error} title="The site wasn't published" />}
        {result && result.mode === "github" && (
          <Notice tone="success" title="Publishing now.">
            <p>The site is rebuilding on GitHub. The changes are usually live in a few minutes.</p>
          </Notice>
        )}
        {result && result.mode === "local" && (
          <Notice tone="info" title="This server can't rebuild the public site on its own.">
            <p>To see the changes on this computer, run this from the frontend folder:</p>
            {result.command && (
              <pre className={noticeStyles.command}>
                <code>{result.command}</code>
              </pre>
            )}
          </Notice>
        )}
      </div>
    </section>
  );
}
