import Link from "next/link";

import { SampleChip } from "@/components/common/Marks";
import { enumDescription } from "@/lib/enums";
import type { Provenance } from "@/lib/types";

import { ProvenanceTag } from "./ProvenanceTag";
import styles from "./MarksHelp.module.css";

// Every mark, in the legend's order. The team's own claims carry no mark.
export const ALL_MARKS: Provenance[] = ["source", "ai", "unclear"];

// The first and last id of the codes a page links ("E001", "E121"), worked
// out from the data by the page, so the lines stay true as the register grows.
// stages are the Codebook's stage rows for the page's family, word for word,
// so "S1" (a stage) isn't mistaken for "S01" (a source).
export interface MarksCodeRanges {
  entries?: [string, string] | null;
  sources?: [string, string] | null;
  stages?: { type: string; code: string; definition: string }[];
}

// A small "How to read the marks" disclosure for any page that shows claims.
// Each line is the mark's description from the shared enums, the same one the
// legend on /methodology/ shows. kinds limits it to the marks a page actually
// shows (the sources page passes only the marks its list uses). With
// codes, more lines say what the workbook's E-ids, S-ids and stage codes
// are, with a link to the methodology's Definitions section ("What the codes
// mean"). With placeholder, a line after the marks explains the Placeholder
// tag a rating card's example tracker starts with (RatingCard's Tracker), for
// a page that shows one. It is a tag, not a mark, so ALL_MARKS leaves it out.
// It is a plain <details>, so it opens without JavaScript and works in server
// components.
export function MarksHelp({
  label = "How to read the marks",
  kinds = ALL_MARKS,
  codes,
  placeholder = false,
}: {
  label?: string;
  kinds?: Provenance[];
  codes?: MarksCodeRanges;
  placeholder?: boolean;
}) {
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
          {placeholder && (
            <li className={styles.item}>
              <span className={styles.tag}>
                <SampleChip label="Placeholder" />
              </span>
              <span className={styles.text}>An example we haven&rsquo;t checked yet.</span>
            </li>
          )}
          {codes?.entries && (
            <li className={styles.item}>
              <span className={styles.code}>
                {codes.entries[0]} to {codes.entries[1]}
              </span>
              <span className={styles.text}>Entries in the evidence register.</span>
            </li>
          )}
          {codes?.sources && (
            <li className={styles.item}>
              <span className={styles.code}>
                {codes.sources[0]} to {codes.sources[1]}
              </span>
              <span className={styles.text}>Sources in the source database.</span>
            </li>
          )}
          {(codes?.stages ?? []).map((stage) => (
            <li key={stage.code} className={styles.item}>
              <span className={styles.code}>
                {stage.type} {stage.code}
              </span>
              <span className={styles.text}>{stage.definition}</span>
            </li>
          ))}
        </ul>
        <div className={styles.links}>
          <Link href="/methodology/#marks" className={styles.link}>
            More on the marks in our methodology
          </Link>
          {codes && (
            <Link href="/methodology/#codebook" className={styles.link}>
              What the codes mean
            </Link>
          )}
        </div>
      </div>
    </details>
  );
}
