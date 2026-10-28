"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import type { AuthResult } from "@/lib/adminTypes";
import {
  API_URL,
  getHealth,
  signInForDevelopment,
  signInWithGoogle,
  toApiError,
  type ApiError,
} from "@/lib/api";
import { decodeJwtPayload, getSignOutNotice, saveSession } from "@/lib/auth";

import forms from "./forms.module.css";
import { GoogleSignInButton } from "./GoogleSignInButton";
import styles from "./LoginCard.module.css";
import { ApiErrorNotice, ApiStartHelp, Notice, SHOW_SETUP_HINTS } from "./Notice";
import { useApiData } from "./useApiData";

// Used when the API doesn't send its own client id in /api/health.
const ENV_GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

// Something, an @, something, a dot, something. The API checks the team list;
// this only catches typos before asking it.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SignInProblem {
  kind: "unreachable" | "not_on_list" | "other";
  message: string;
  email: string | null;
}

function describeProblem(error: ApiError, email: string | null): SignInProblem {
  if (error.isNetworkError) {
    return { kind: "unreachable", message: error.message, email };
  }
  // The API answers 403 not_on_team_list when the account is real but not on
  // the team list. Its other 403 (email_not_verified) has its own message.
  if (error.code === "not_on_team_list") {
    return { kind: "not_on_list", message: error.message, email };
  }
  return { kind: "other", message: error.message, email };
}

// The sign-in card the admin shell shows to anyone without a valid token.
// resuming: the session ended on its own and the page is still open behind
// the card, so signing in carries on from there.
export function LoginCard({ resuming = false }: { resuming?: boolean }) {
  const health = useApiData("health", getHealth);
  const [notice] = useState(getSignOutNotice);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const [devEmail, setDevEmail] = useState("");

  async function finishSignIn(attempt: Promise<AuthResult>, email: string | null) {
    setBusy(true);
    setProblem(null);
    try {
      const result = await attempt;
      // The shell hears this and swaps the card for the admin pages.
      saveSession(result.token, result.user, result.expires_at);
    } catch (error) {
      setProblem(describeProblem(toApiError(error), email));
      setBusy(false);
    }
  }

  function onGoogleCredential(credential: string) {
    // Google's credential is a JWT; its email is only used to word an error.
    const payload = decodeJwtPayload(credential);
    const email = payload && typeof payload.email === "string" ? payload.email : null;
    void finishSignIn(signInWithGoogle(credential), email);
  }

  function onDevSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = devEmail.trim();
    if (email === "") {
      setProblem({ kind: "other", message: "Enter the email you're on the team list with.", email: null });
      return;
    }
    if (!EMAIL_SHAPE.test(email)) {
      setProblem({ kind: "other", message: `"${email}" doesn't look like an email address.`, email: null });
      return;
    }
    void finishSignIn(signInForDevelopment(email), email);
  }

  let body: ReactNode;
  if (health.error?.code === "not_configured") {
    body = (
      <Notice tone="warning" title="Admin isn't connected to the team's server yet.">
        <p>
          This copy of the site was built without the address of the team&rsquo;s API, so nobody can sign in here. To
          fix it, set the <code>API_URL</code> variable in the repo&rsquo;s GitHub settings (Secrets and variables,
          Actions) and run the deploy again.
        </p>
      </Notice>
    );
  } else if (health.error) {
    body = health.error.isNetworkError ? (
      <Notice
        tone="error"
        title={`Can't reach the API at ${API_URL}.`}
        action={
          <button type="button" className={`btn btn-secondary ${forms.smallButton}`} onClick={health.reload}>
            Try again
          </button>
        }
      >
        <ApiStartHelp />
      </Notice>
    ) : (
      <ApiErrorNotice error={health.error} title="The API isn't answering properly" onRetry={health.reload} />
    );
  } else if (!health.data) {
    body = <p className={styles.note}>Checking the API at {API_URL}&hellip;</p>;
  } else {
    const clientId = health.data.google_client_id ?? ENV_GOOGLE_CLIENT_ID;
    body = (
      <>
        {clientId !== "" ? (
          <GoogleSignInButton clientId={clientId} onCredential={onGoogleCredential} className={styles.googleBox} />
        ) : (
          <p className={styles.note}>
            Google sign-in isn&rsquo;t set up here yet.
            {SHOW_SETUP_HINTS && (
              <>
                {" "}
                Give the API a <code>GOOGLE_CLIENT_ID</code>, or set <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> for this
                site.
              </>
            )}
          </p>
        )}

        {health.data.dev_login && (
          <form className={styles.dev} onSubmit={onDevSubmit} noValidate>
            <p className="eyebrow">Local development sign-in</p>
            <p className={styles.devText}>
              The API is running with <code>DEV_LOGIN=1</code>, so an email on the team list is enough. Production
              never shows this.
            </p>
            <div className={forms.field}>
              <label htmlFor="dev-email" className={forms.label}>
                Email
              </label>
              <input
                id="dev-email"
                type="email"
                autoComplete="email"
                className={forms.input}
                value={devEmail}
                onChange={(event) => setDevEmail(event.target.value)}
                disabled={busy}
              />
            </div>
            <button type="submit" className={`btn btn-secondary ${forms.button}`} disabled={busy}>
              Sign in with this email
            </button>
          </form>
        )}
      </>
    );
  }

  return (
    <section className={`paper ${styles.card}`} aria-labelledby="login-heading">
      <div className={styles.head}>
        <LockIcon />
        <p className="eyebrow">For the team</p>
      </div>
      <h1 id="login-heading" className={styles.title}>
        Team <em>login</em>
      </h1>
      <p className={styles.text}>
        {resuming
          ? "Sign in again to carry on. The page behind this is just as you left it, including anything you typed."
          : "Sign in to work through the review queue and run the source pipeline. Only people on the team list can get in."}
      </p>

      {notice && <Notice tone="info">{notice}</Notice>}
      {body}
      {busy && (
        <p className={styles.note} role="status">
          Signing you in&hellip;
        </p>
      )}
      {problem && <ProblemNotice problem={problem} inMemoryDatabase={health.data ? health.data.db_in_memory : false} />}
    </section>
  );
}

interface ProblemNoticeProps {
  problem: SignInProblem;
  // With an in-memory database the team list comes from DEV_USERS, and the
  // users CLI can't change it (its change is gone when the command ends).
  inMemoryDatabase: boolean;
}

function ProblemNotice({ problem, inMemoryDatabase }: ProblemNoticeProps) {
  if (problem.kind === "unreachable") {
    return (
      <Notice tone="error" title={problem.message}>
        <ApiStartHelp />
      </Notice>
    );
  }
  if (problem.kind === "not_on_list") {
    const email = problem.email ?? "you@example.com";
    const title = `${problem.email ?? "That account"} isn't on the team list.`;
    if (!SHOW_SETUP_HINTS) {
      return (
        <Notice tone="error" title={title}>
          <p>Check the address, or ask someone on the team to add you.</p>
        </Notice>
      );
    }
    if (inMemoryDatabase) {
      return (
        <Notice tone="error" title={title}>
          <p>
            This API uses an in-memory database, so the team list comes from <code>DEV_USERS</code>. Add yourself to
            it and restart the API, which also empties the database:
          </p>
          <pre className={styles.command}>
            <code>DEV_USERS=&quot;{email}:Your name&quot;</code>
          </pre>
          <p>Separate several people with commas.</p>
        </Notice>
      );
    }
    return (
      <Notice tone="error" title={title}>
        <p>Anyone with access to the API can add you:</p>
        <pre className={styles.command}>
          <code>flask --app sf_api users add {email} &quot;Your name&quot;</code>
        </pre>
      </Notice>
    );
  }
  return (
    <Notice tone="error" title="Sign-in didn't work.">
      <p>{problem.message}</p>
    </Notice>
  );
}

function LockIcon() {
  return (
    <svg className={styles.lock} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
