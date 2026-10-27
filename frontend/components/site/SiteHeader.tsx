import Link from "next/link";

import { IS_DRAFT, PRIMARY_NAV, SITE_NAME } from "@/lib/site";

import { NavLinks } from "./NavLinks";
import styles from "./SiteHeader.module.css";

// The draft banner sits above the sticky header and scrolls away with the page,
// so the part that sticks is always exactly --header-height (plus its border)
// however many lines the banner wraps to.
export function SiteHeader() {
  return (
    <>
      {IS_DRAFT && (
        <section className={styles.draftBanner} aria-label="Draft notice">
          <span className={styles.draftDot} aria-hidden="true" />
          Draft prototype. Content is placeholder or unreviewed, and not for citation.
        </section>
      )}
      <header className={styles.header}>
        <div className={`container ${styles.bar}`}>
          <Link href="/" className={styles.brand} aria-label={`${SITE_NAME} home`}>
            <BrandMark />
            <span className={styles.wordmark}>
              Minds <em>in the</em> Loop
            </span>
          </Link>
          <NavLinks items={PRIMARY_NAV} />
        </div>
      </header>
    </>
  );
}

// A small loop drawn as a dashed orbit around a dot: a mind inside a loop.
function BrandMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.4" />
      <circle cx="16" cy="16" r="5" fill="currentColor" />
      <circle cx="27.5" cy="11" r="2.2" fill="var(--stage-widely)" />
    </svg>
  );
}
