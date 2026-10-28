import Link from "next/link";

import { SECONDARY_NAV, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

import styles from "./SiteFooter.module.css";

// One line: the site's name, then the pages the header leaves to the menu.
// Admin pages pass showTeamLogin={false}, since the reader is already there.
export function SiteFooter({ showTeamLogin = true }: { showTeamLogin?: boolean }) {
  return (
    <footer className={styles.footer} data-site-chrome="footer">
      <div className={`container ${styles.inner}`}>
        <p className={styles.name}>
          {SITE_NAME}
          <span className={styles.tagline}>{SITE_TAGLINE}</span>
        </p>
        <nav aria-label="Footer">
          <ul className={styles.links}>
            {SECONDARY_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
            {showTeamLogin && (
              <li>
                <Link href="/admin/">Team login</Link>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
