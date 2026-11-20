import Link from "next/link";

import type { Family } from "@/lib/types";

import styles from "./EvidenceRegister.module.css";

// The Full assessment's evidence part. The register itself lives on its own
// page (/evidence/), so this is one line: how many entries the family filter
// finds there, and a link to them. The filter matches an entry whose Family
// cell names the family or whose "Ratings it feeds" names one of its
// ratings, the same rule as entriesForFamily in lib/workbook.ts.
export function EvidenceRegisterLink({ family, shortName, count }: { family: Family; shortName: string; count: number }) {
  const href = `/evidence/?family=${family}`;
  if (count === 0) {
    return null;
  }
  const start =
    count === 1
      ? `1 entry in the evidence register is about ${shortName} or informs its ratings.`
      : `${count} entries in the evidence register are about ${shortName} or inform its ratings.`;
  return (
    <p className={styles.line}>
      {start}{" "}
      <Link href={href} className={styles.link}>
        Open the evidence register
        <span aria-hidden="true"> &rarr;</span>
      </Link>
    </p>
  );
}
