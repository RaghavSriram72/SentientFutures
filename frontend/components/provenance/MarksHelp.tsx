import Link from "next/link";

import type { Provenance } from "@/lib/types";

import { ProvenanceTag } from "./ProvenanceTag";
import styles from "./MarksHelp.module.css";

// One short line per mark. The full legend lives on /methodology/.
const MARK_LINES: { kind: Provenance; text: string }[] = [
  { kind: "source", text: "Quoted word for word from a cited source." },
  { kind: "team", text: "The team's own interpretation." },
  { kind: "ai", text: "Suggested by an AI model, set in a dashed outline." },
  { kind: "unclear", text: "We don't know yet, and the tag gives the reason." },
];

// A small "How to read the marks" disclosure for any page that shows claims.
// It is a plain <details>, so it opens without JavaScript and works in server
// components.
export function MarksHelp({ label = "How to read the marks" }: { label?: string }) {
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
          {MARK_LINES.map((line) => (
            <li key={line.kind} className={styles.item}>
              <ProvenanceTag kind={line.kind} plain />
              <span className={styles.text}>{line.text}</span>
            </li>
          ))}
        </ul>
        <Link href="/methodology/" className={styles.link}>
          More on the marks in our methodology
        </Link>
      </div>
    </details>
  );
}
