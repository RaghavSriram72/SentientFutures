import type { Metadata } from "next";
import Link from "next/link";

import styles from "./not-found.module.css";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className={styles.wrap}>
      <div className={`container ${styles.inner}`}>
        <OffTheMap />
        <p className={`eyebrow ${styles.eyebrow}`}>404 · Not found</p>
        <h1 className={styles.title}>
          This page is <em>off the map</em>
        </h1>
        <p className={`lede ${styles.lede}`}>
          The link may be old, or the page may have moved while the site is still a draft. Everything else is still
          where you left it.
        </p>
        <div className={styles.actions}>
          <Link href="/" className="btn btn-primary">
            Back to home
          </Link>
          <Link href="/timeline/" className="btn btn-secondary">
            See the timeline
          </Link>
        </div>
      </div>
    </div>
  );
}

// The site's dashed orbit, with the dot wandered off its path.
function OffTheMap() {
  return (
    <svg className={styles.mark} viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="44" className={styles.orbit} />
      <circle cx="60" cy="60" r="26" className={styles.orbitInner} />
      <circle cx="60" cy="60" r="7" className={styles.core} />
      <circle cx="108" cy="22" r="5" className={styles.stray} />
    </svg>
  );
}
