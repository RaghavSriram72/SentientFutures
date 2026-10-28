import Link from "next/link";

import { ClaimText } from "@/components/provenance/ClaimText";
import { enumLabel } from "@/lib/enums";
import { shortCitation, type SourceRef } from "@/lib/sources";
import type { Claim, EvidenceRow, Provenance } from "@/lib/types";

import styles from "./EvidenceRegister.module.css";

interface EvidenceRegisterProps {
  rows: EvidenceRow[];
  technologyName: string;
  shortName: string;
  // Keyed by register id ("S02"), the ids the register cites.
  sourcesByRegisterId: Record<string, SourceRef>;
  // The page's default provenance; claims of this kind show only their glyph.
  quiet?: Provenance;
}

type RegisterSources = Record<string, SourceRef>;

// How many of the cited ids are in the source database, and how many aren't.
function countLinked(rows: EvidenceRow[], sources: RegisterSources): { linked: number; unlinked: number } {
  const counts = { linked: 0, unlinked: 0 };
  for (const row of rows) {
    for (const id of [...row.supporting_ids, ...row.contrary_ids]) {
      if (sources[id]) {
        counts.linked += 1;
      } else {
        counts.unlinked += 1;
      }
    }
  }
  return counts;
}

// The sentence under the register. It says whether the ids link anywhere,
// so it stays true as sources are added to the database.
function linkNote(linked: number, unlinked: number): string {
  const start = "The Supporting and Contrary columns list sources by the team’s register IDs.";
  if (linked === 0) {
    return `${start} The full citations aren’t on the site yet.`;
  }
  if (unlinked === 0) {
    return `${start} Each ID links to the source’s card in the source database.`;
  }
  return `${start} An ID with a link opens the source’s card in the source database. The others aren’t in the database yet.`;
}

// The evidence register as a ruled table when there is room for seven
// columns, and one card per claim otherwise, built like the Scorecard.
export function EvidenceRegister({
  rows,
  technologyName,
  shortName,
  sourcesByRegisterId,
  quiet,
}: EvidenceRegisterProps) {
  const counts = countLinked(rows, sourcesByRegisterId);
  return (
    <div className={`paper ${styles.card}`}>
      <div className={styles.cardHead}>
        <span>Evidence register · {shortName}</span>
        <span>
          {rows.length} {rows.length === 1 ? "claim" : "claims"}
        </span>
      </div>

      {/* The explicit roles keep table semantics on small screens, where the
          CSS turns each row into a card and browsers drop the implicit ones. */}
      <table className={styles.table} role="table">
        <caption className="visually-hidden">Evidence register for {technologyName}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col" className={styles.colClaim}>
              Claim
            </th>
            <th role="columnheader" scope="col" className={styles.colIds}>
              Supporting
            </th>
            <th role="columnheader" scope="col" className={styles.colIds}>
              Contrary
            </th>
            <th role="columnheader" scope="col" className={styles.colType}>
              Evidence type
            </th>
            <th role="columnheader" scope="col" className={styles.colDirectness}>
              Directness
            </th>
            <th role="columnheader" scope="col" className={styles.colLimitation}>
              Main limitation
            </th>
            <th role="columnheader" scope="col" className={styles.colIndependence}>
              Independence
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row, index) => (
            <RegisterRow key={index} row={row} sources={sourcesByRegisterId} quiet={quiet} />
          ))}
        </tbody>
      </table>

      <p className={styles.note}>{linkNote(counts.linked, counts.unlinked)}</p>
    </div>
  );
}

function RegisterRow({ row, sources, quiet }: { row: EvidenceRow; sources: RegisterSources; quiet?: Provenance }) {
  // A register line is a plain string with a provenance, so it is wrapped as
  // a Claim to get the same mark as every other sentence on the site.
  const claim: Claim = { text: row.claim, provenance: row.provenance };
  return (
    <tr className={styles.row} role="row">
      <th className={styles.claimCell} scope="row" role="rowheader">
        <ClaimText claim={claim} variant="compact" quiet={quiet} />
      </th>
      <td className={`${styles.cell} ${styles.supporting}`} data-label="Supporting" role="cell">
        <IdList ids={row.supporting_ids} sources={sources} />
      </td>
      <td className={`${styles.cell} ${styles.contrary}`} data-label="Contrary" role="cell">
        <IdList ids={row.contrary_ids} sources={sources} />
      </td>
      <td className={`${styles.cell} ${styles.small}`} data-label="Evidence type" role="cell">
        {row.evidence_type}
      </td>
      <td className={`${styles.cell} ${styles.small}`} data-label="Directness" role="cell">
        {enumLabel("Directness", row.directness)}
      </td>
      <td className={`${styles.cell} ${styles.limitation}`} data-label="Main limitation" role="cell">
        {row.limitation}
      </td>
      <td className={`${styles.cell} ${styles.small}`} data-label="Independence" role="cell">
        {row.independence}
      </td>
    </tr>
  );
}

// Each id links to its card in the source database when the source is there.
// An id the database doesn't have yet stays a plain chip.
function IdList({ ids, sources }: { ids: string[]; sources: RegisterSources }) {
  if (ids.length === 0) {
    return <span className={styles.none}>None in our current sources</span>;
  }
  return (
    <span className={styles.ids}>
      {ids.map((id) => {
        const source = sources[id];
        if (!source) {
          return (
            <span key={id} className={styles.id}>
              {id}
            </span>
          );
        }
        const citation = shortCitation(source);
        return (
          <Link
            key={id}
            href={`/sources/#${source.id}`}
            className={`${styles.id} ${styles.idLink}`}
            title={`${citation}: ${source.title}`}
            aria-label={`${id}, ${citation}`}
          >
            {id}
          </Link>
        );
      })}
    </span>
  );
}
