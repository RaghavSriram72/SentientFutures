import Link from "next/link";
import type { ReactNode } from "react";

import { CodeText } from "@/components/common/CodeText";
import { entryAnchor, type CodeIndex } from "@/lib/codes";
import { enumLabel } from "@/lib/enums";
import {
  FAMILY_WORDS,
  citationRepeatsTitle,
  entryByline,
  outcomeText,
  type EvidenceRowData,
} from "@/lib/evidenceFilters";

import styles from "./EvidenceRow.module.css";

interface EvidenceRowProps {
  row: EvidenceRowData;
  index: CodeIndex;
}

// One register entry as a single line of the list: its id, the exact claim
// and a muted line with the source, family and the ratings it informs. It is
// a native <details> with the entry's id ("e042"), so links like
// /evidence/#e042 land on it. Open, it shows every register column under a
// plain-words label, codes linked and explained from the Codebook.
export function EvidenceRow({ row, index }: EvidenceRowProps) {
  const { entry, source, definitions } = row;
  // The page a risk code links to: the entry's own family. A Cross-family
  // entry has none, so a risk goes to its first family.
  const family = entry.family === "cross_family" ? null : entry.family;
  const directness = enumLabel("EvidenceDirectness", entry.directness);
  const codes = entry.codes ?? [];
  const scenarios = entry.scenarios ?? [];
  // A source cited by its title (S01, S25): the Source ID link carries it.
  const titleInLink = source !== null && citationRepeatsTitle(source);

  return (
    <details id={entryAnchor(entry.id)} className={styles.row}>
      <summary className={styles.summary}>
        {/* The labels for the id and the claim. They only show once the row
            is open, next to the other fields' labels. Each label comes just
            before its own value, so a screen reader reads "Entry E042,
            Claim ..."; the grid areas still put both labels on the line
            above. */}
        <span className={`${styles.summaryLabel} ${styles.idLabel}`}>Entry</span>
        <span className={styles.id}>{entry.id}</span>
        <span className={`${styles.summaryLabel} ${styles.claimLabel}`}>Claim</span>
        <span className={styles.main}>
          <span className={styles.claim}>{entry.claim}</span>
          <span className={styles.byline}>{entryByline(entry)}</span>
        </span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.body}>
        <dl className={styles.fields}>
          <Field label="Source ID">
            {/* "S13 (Mineault et al. 2024)" over the full title. A source with
                no authors or venue is cited by a cut-down title, so it gets a
                plain id link instead, and the full title under it is the only
                place its name appears: screen readers hear "S25" and then the
                whole title once. */}
            {titleInLink && source ? (
              <Link href={`/sources/#${source.id}`}>{entry.register_id}</Link>
            ) : (
              <CodeText text={entry.register_id} index={index} mode="claim" />
            )}
            {source && <span className={styles.note}>{source.title}</span>}
          </Field>
          <Field label="Where in the source">
            <CodeText text={entry.locator} index={index} family={family} />
          </Field>
          {codes.length > 0 && (
            <Field label="Linked to">
              <CodeText text={codes.join("; ")} index={index} family={family} />
            </Field>
          )}
          <Field label="Family">{FAMILY_WORDS[entry.family]}</Field>
          <Field label="Ratings it informs">
            <CodeText text={entry.feeds_text} index={index} family={family} />
          </Field>
          <Field label="Source type and independence">
            <CodeText text={entry.source_type_independence} index={index} family={family} />
          </Field>
          <Field label="Outcome addressed">{outcomeText(entry)}</Field>
          <Field label="Alignment problem">
            <Defined code={entry.alignment_problem} definition={definitions[entry.alignment_problem]} />
          </Field>
          {scenarios.length > 0 && (
            <Field label="Scenarios">
              {/* One code per line, each with its definition. */}
              {scenarios.map((code, position) => (
                <span key={position} className={styles.line}>
                  <Defined code={<CodeText text={code} index={index} family={family} />} definition={definitions[code]} />
                </span>
              ))}
            </Field>
          )}
          <Field label="Stage">
            <Defined code={entry.stage} definition={definitions[entry.stage]} />
          </Field>
          <Field label="Directness">
            {directness}
            {definitions[directness] && <span className={styles.note}>{definitions[directness]}</span>}
          </Field>
          <Field label="Evidence role">{enumLabel("EvidenceRole", entry.role)}</Field>
          <Field label="Evidence basis">{enumLabel("EvidenceBasis", entry.basis)}</Field>
        </dl>
        <p className={styles.codebook}>
          <Link href="/methodology/#codebook">What the codes mean</Link>
        </p>
      </div>
    </details>
  );
}

// One register column: its label, then the cell.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}

// A code followed by its Codebook definition: "WBE-O AI overseer". A code
// the Codebook doesn't define (A-X, N/A) stands alone.
function Defined({ code, definition }: { code: ReactNode; definition: string | undefined }) {
  return (
    <>
      <span className={styles.code}>{code}</span>
      {definition && <span className={styles.definition}> {definition}</span>}
    </>
  );
}
