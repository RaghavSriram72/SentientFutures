import styles from "./LoginCard.module.css";

// Static placeholder. Google sign-in with a team allowlist arrives in Phase 2,
// so the button is disabled and nothing here talks to a server.
export function LoginCard() {
  return (
    <section className={`paper ${styles.card}`} aria-labelledby="login-heading">
      <div className={styles.head}>
        <LockIcon />
        <p className="eyebrow">For the team</p>
      </div>
      <h2 id="login-heading" className={styles.title}>
        Team <em>login</em>
      </h2>
      <p className={styles.text}>
        Reviewers will sign in here to work through the review queue, add sources and edit milestones.
      </p>
      <button type="button" className={styles.google} disabled aria-describedby="login-note">
        {/* A plain letter in a ring, not Google's colored logo */}
        <span className={styles.mark} aria-hidden="true">
          G
        </span>
        Sign in with Google
      </button>
      <p id="login-note" className={styles.note}>
        Sign-in isn&rsquo;t built yet. When it is, only people on the team&rsquo;s allowlist will be able to get in.
      </p>
    </section>
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
