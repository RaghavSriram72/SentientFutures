import Link from "next/link";

import { RUBRIC_VERSION } from "@/lib/enums";
import { PRIMARY_NAV, SECONDARY_NAV, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.about}>
          <p className={styles.name}>{SITE_NAME}</p>
          <p className={styles.tagline}>{SITE_TAGLINE}</p>
          <p className={styles.note}>
            Every research claim here carries one of four marks: From a source, Our read,
            AI-suggested or Unclear. AI text that nobody has checked yet is marked &ldquo;not yet
            reviewed,&rdquo; and after launch none of it will go live until a person has checked it.
          </p>
        </div>
        <nav className={styles.cols} aria-label="Footer">
          <ul>
            {PRIMARY_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
          <ul>
            {SECONDARY_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
            <li>
              <Link href="/admin/">Team login</Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className={`container ${styles.base}`}>
        <span>Rubric v{RUBRIC_VERSION}</span>
        <span>Categories marked draft are still being decided.</span>
      </div>
    </footer>
  );
}
