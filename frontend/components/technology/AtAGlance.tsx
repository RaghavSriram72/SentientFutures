import { ClaimText } from "@/components/provenance/ClaimText";
import type { Claim, Provenance } from "@/lib/types";

import styles from "./AtAGlance.module.css";

export interface GlanceRow {
  label: string;
  href: string; // the detail section further down, e.g. "#case"
  claim: Claim | null; // null shows the placeholder
  placeholder: string;
  // Where the line comes from, when it isn't the obvious field.
  note?: string;
}

// One short line per part of the argument, each linking to its section. The
// lines are excerpts of the claims below, so their marks travel with them.
export function AtAGlance({ rows, quiet }: { rows: GlanceRow[]; quiet: Provenance }) {
  return (
    <dl className={`paper ${styles.card}`}>
      {rows.map((row) => (
        <div key={row.label} className={styles.row}>
          <dt className={styles.label}>
            <a href={row.href} className={styles.labelLink}>
              {row.label}
              <span className={styles.arrow} aria-hidden="true">
                &darr;
              </span>
            </a>
          </dt>
          <dd className={styles.value}>
            {row.claim ? (
              <>
                <ClaimText claim={row.claim} quiet={quiet} />
                {row.note && <p className={styles.note}>{row.note}</p>}
              </>
            ) : (
              <p className={styles.placeholder}>{row.placeholder}</p>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
