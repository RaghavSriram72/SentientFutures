import type { ReactNode, Ref } from "react";

import { API_URL, type ApiError } from "@/lib/api";

import forms from "./forms.module.css";
import styles from "./Notice.module.css";

type Tone = "info" | "warning" | "error" | "success";

interface NoticeProps {
  tone: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  // Lets a page move focus to the title when the notice replaces what had focus.
  titleRef?: Ref<HTMLParagraphElement>;
}

// A boxed message. Errors are announced right away; the rest politely.
export function Notice({ tone, title, children, action, titleRef }: NoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={tone === "error" ? "alert" : "status"}>
      {title && (
        <p ref={titleRef} tabIndex={titleRef ? -1 : undefined} className={styles.title}>
          {title}
        </p>
      )}
      {children && <div className={styles.body}>{children}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

// Setup hints (environment variables, commands) help whoever runs the site on
// their own computer and mean nothing to a reviewer, so the published site
// never shows them. `next dev` is the only place they appear.
export const SHOW_SETUP_HINTS = process.env.NODE_ENV !== "production";

// The command that starts the API locally. Shared by the sign-in card and the
// "can't reach the API" notice so they never disagree.
export function ApiStartHelp() {
  if (!SHOW_SETUP_HINTS) {
    return (
      <p>
        The team&rsquo;s server may be restarting. Try again in a minute. If it keeps happening, tell whoever looks
        after the server.
      </p>
    );
  }
  return (
    <>
      <p>
        If it isn&rsquo;t running, start it from the repo with dev sign-in on and yourself on the team list:
      </p>
      <pre className={styles.command}>
        <code>
          DEV_LOGIN=1 DEV_USERS=&quot;you@example.com:Your name&quot; flask --app sf_api run --port 5050
        </code>
      </pre>
      <p>
        If it is running, check that its <code>CORS_ORIGINS</code> includes this page&rsquo;s address, and that{" "}
        <code>NEXT_PUBLIC_API_URL</code> points at it.
      </p>
    </>
  );
}

// The HTTP status and error code, tucked away: they help whoever debugs the
// API, and mean nothing to a reviewer.
export function ErrorCode({ error }: { error: ApiError }) {
  return (
    <details className={styles.codeDetails}>
      <summary>Details for a developer</summary>
      <p className={styles.code}>
        {error.status} · {error.code}
      </p>
    </details>
  );
}

interface ApiErrorNoticeProps {
  error: ApiError;
  // What was being attempted, e.g. "Couldn't load the queue".
  title: string;
  onRetry?: () => void;
}

export function ApiErrorNotice({ error, title, onRetry }: ApiErrorNoticeProps) {
  const retry = onRetry ? (
    <button type="button" className={`btn btn-secondary ${forms.smallButton}`} onClick={onRetry}>
      Try again
    </button>
  ) : undefined;

  if (error.isNetworkError) {
    return (
      <Notice tone="error" title={`${title}. ${error.message}`} action={retry}>
        {error.code === "network_error" ? <ApiStartHelp /> : <p>The API at {API_URL} may be busy. Try again in a moment.</p>}
      </Notice>
    );
  }
  return (
    <Notice tone="error" title={title} action={retry}>
      <p>{error.message}</p>
      <ErrorCode error={error} />
    </Notice>
  );
}
