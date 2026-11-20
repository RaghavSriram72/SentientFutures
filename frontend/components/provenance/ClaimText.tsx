import Link from "next/link";
import type { ReactNode } from "react";

import { ExternalLink } from "@/components/common/ExternalLink";
import { findCodes, registerIdsIn } from "@/lib/codes";
import { enumLabel } from "@/lib/enums";
import { shortCitation, type SourceRef } from "@/lib/sources";
import type { Claim, Provenance } from "@/lib/types";

import { ProvenanceGlyph, ProvenanceTag } from "./ProvenanceTag";
import styles from "./Provenance.module.css";

interface ClaimTextProps {
  claim: Claim;
  sources?: Record<string, SourceRef>;
  // "block" for paragraphs, "compact" for short fields inside panels and tables
  variant?: "block" | "compact";
  // The section's default kind, stated once in a note above the claims. A
  // claim of this kind shows only its glyph in the margin, with no text label.
  // Claims of any other kind are the exceptions and keep their full tag.
  quiet?: Provenance;
  // Leaves out the "See ..." line, for a claim whose sources are already
  // listed close by (the dossier's status, next to its Sources list).
  hideCitation?: boolean;
}

// True when the claim matches the section's default, so its label can go.
// An AI claim someone has checked keeps its tag, because "checked by X" is
// news the section note can't give.
function isQuiet(claim: Claim, quiet: Provenance | undefined): boolean {
  if (!quiet || claim.provenance !== quiet) {
    return false;
  }
  if (claim.provenance === "ai" && claim.reviewed_by) {
    return false;
  }
  return true;
}

// Renders one claim with its provenance mark:
//   source  -> the text, then the exact quote with a hanging rule and a citation
//   team    -> no mark at all: anything without a mark is the team's
//   ai      -> a dashed rule down its left side and "AI-suggested · checked by X"
//   unclear -> hatching and the stated reason
// With `quiet`, a claim of the default kind keeps its glyph and line style
// but drops the text label.
export function ClaimText({ claim, sources = {}, variant = "block", quiet, hideCitation = false }: ClaimTextProps) {
  const kindClass = styles[`claim_${claim.provenance}`];
  const variantClass = variant === "compact" ? styles.compact : "";
  // The team's own claims carry no tag or glyph. Readers take anything
  // unmarked as the team's, so only the other kinds are labelled.
  const unmarked = claim.provenance === "team";
  const quietClaim = !unmarked && isQuiet(claim, quiet);
  const quietClass = quietClaim ? styles.quiet : "";

  const citedSources: SourceRef[] = [];
  for (const id of claim.source_ids ?? []) {
    const source = sources[id];
    if (source) {
      citedSources.push(source);
    }
  }

  // The "See ..." line skips a source the text already names by its register
  // id ("S02 (Thiergart 2023)" links to it), so it isn't cited twice in a row.
  // A range names every source in it: "S24-S29" covers S25 to S28 too.
  const namedInText = registerIdsIn(claim.text);
  const seeAlso: SourceRef[] = [];
  for (const source of citedSources) {
    if (!source.register_id || !namedInText.includes(source.register_id)) {
      seeAlso.push(source);
    }
  }

  return (
    <div className={`${styles.claim} ${kindClass} ${variantClass} ${quietClass}`}>
      {unmarked ? null : quietClaim ? (
        <span className={`${styles.quietMark} ${styles[`mark_${claim.provenance}`]}`} aria-hidden="true">
          <ProvenanceGlyph kind={claim.provenance} />
        </span>
      ) : (
        <ProvenanceTag
          kind={claim.provenance}
          reviewedBy={claim.reviewed_by}
          unclearReason={claim.unclear_reason}
        />
      )}
      <p className={styles.text}>
        <TextWithRegisterLinks text={claim.text} sources={sources} />
      </p>

      {claim.provenance === "unclear" && claim.unclear_reason === "other" && claim.unclear_note && (
        <p className={styles.unclearNote}>{claim.unclear_note}</p>
      )}

      {claim.provenance === "source" && claim.quote && (
        <blockquote className={styles.quote}>
          <p>&ldquo;{claim.quote}&rdquo;</p>
          <footer className={styles.citation}>
            {citedSources.map((source, index) => (
              <span key={source.id}>
                {index > 0 && "; "}
                <ExternalLink href={source.url}>{shortCitation(source)}</ExternalLink>
              </span>
            ))}
            {claim.quote_location && <span> · {claim.quote_location}</span>}
          </footer>
        </blockquote>
      )}

      {claim.provenance !== "source" && !hideCitation && seeAlso.length > 0 && (
        <p className={styles.citation}>
          See{" "}
          {seeAlso.map((source, index) => (
            <span key={source.id}>
              {index > 0 && "; "}
              <ExternalLink href={source.url}>{shortCitation(source)}</ExternalLink>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// The claim's text, with each register id that matches a source turned into a
// link to that source in the source database, followed by its short citation:
// "S02 (Thiergart 2023)". A reader who has never seen the register can tell
// what it points to. The words themselves don't change. Source ids are two
// digits (lib/codes.ts), so the stage codes S1 to S6 are never linked. In a
// range ("S20-S22") each end links on its own and the citation goes in the
// link's title instead, so it doesn't split the range.
function TextWithRegisterLinks({ text, sources }: { text: string; sources: Record<string, SourceRef> }) {
  const byRegisterId: Record<string, SourceRef> = {};
  for (const source of Object.values(sources)) {
    if (source.register_id) {
      byRegisterId[source.register_id] = source;
    }
  }

  const parts: ReactNode[] = [];
  let last = 0;
  for (const found of findCodes(text)) {
    const source = found.kind === "source" ? byRegisterId[found.code] : undefined;
    if (!source) {
      continue;
    }
    const citation = shortCitation(source);
    parts.push(text.slice(last, found.index));
    parts.push(
      <Link
        key={found.index}
        href={`/sources/#${source.id}`}
        className={styles.registerLink}
        title={found.inRange ? citation : undefined}
        aria-label={found.inRange ? `${found.code} (${citation})` : undefined}
      >
        {found.code}
        {!found.inRange && <span className={styles.registerCite}> ({citation})</span>}
      </Link>,
    );
    last = found.index + found.code.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

// For a list of claims (strongest case, would move earlier, and so on).
export function ClaimList({
  claims,
  sources,
  variant = "block",
  quiet,
}: {
  claims: Claim[];
  sources?: Record<string, SourceRef>;
  variant?: "block" | "compact";
  quiet?: Provenance;
}) {
  if (claims.length === 0) {
    return <p className={styles.empty}>Nothing recorded yet.</p>;
  }
  return (
    <ul className={styles.claimList}>
      {claims.map((claim, index) => (
        <li key={index}>
          <ClaimText claim={claim} sources={sources} variant={variant} quiet={quiet} />
        </li>
      ))}
    </ul>
  );
}

export function unclearLabel(reason: Claim["unclear_reason"]): string {
  return reason ? enumLabel("UnclearReason", reason) : "";
}
