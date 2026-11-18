import Link from "next/link";

import { enumDescription } from "@/lib/enums";
import type { Provenance } from "@/lib/types";

import { ProvenanceTag } from "./ProvenanceTag";
import styles from "./MarksHelp.module.css";

// Every mark, in the legend's order.
export const ALL_MARKS: Provenance[] = ["source", "team", "ai", "unclear"];

// A small "How to read the marks" disclosure for any page that shows claims.
// Each line is the mark's description from the shared enums, the same one the
// legend on /methodology/ shows. kinds limits it to the marks a page shows,
// such as the sources page, where every summary is the team's read.
// It is a plain <details>, so it opens without JavaScript and works in server
// components.
export function MarksHelp({ label = "How to read the marks", kinds = ALL_MARKS }: { label?: string; kinds?: Provenance[] }) {
  return (
    <details className={styles.help}>
      <summary className={styles.summary}>
        <span className={styles.mark} aria-hidden="true">
          ?
        </span>
        {label}
      </summary>
      <div className={styles.panel}>
        <ul className={styles.list}>
          {kinds.map((kind) => (
            <li key={kind} className={styles.item}>
              <ProvenanceTag kind={kind} plain />
              <span className={styles.text}>{enumDescription("Provenance", kind)}</span>
            </li>
          ))}
        </ul>
        <Link href="/methodology/#marks" className={styles.link}>
          More on the marks in our methodology
        </Link>
      </div>
    </details>
  );
}
