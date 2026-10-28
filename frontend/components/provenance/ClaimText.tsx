import Link from "next/link";
import type { ReactNode } from "react";

import { ExternalLink } from "@/components/common/ExternalLink";
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
//   team    -> an "Our read" margin tag
//   ai      -> a dashed outline and "AI-suggested · checked by X"
//   unclear -> hatching and the stated reason
// With `quiet`, a claim of the default kind keeps its glyph and line style
// but drops the text label.
export function ClaimText({ claim, sources = {}, variant = "block", quiet }: ClaimTextProps) {
  const kindClass = styles[`claim_${claim.provenance}`];
  const variantClass = variant === "compact" ? styles.compact : "";
  const quietClaim = isQuiet(claim, quiet);
  const quietClass = quietClaim ? styles.quiet : "";

  const citedSources: SourceRef[] = [];
  for (const id of claim.source_ids ?? []) {
    const source = sources[id];
    if (source) {
      citedSources.push(source);
    }
  }

  return (
    <div className={`${styles.claim} ${kindClass} ${variantClass} ${quietClass}`}>
      {quietClaim ? (
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

      {claim.provenance !== "source" && citedSources.length > 0 && (
        <p className={styles.citation}>
          See{" "}
          {citedSources.map((source, index) => (
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

// The team's evidence register ids ("S02", "S13") as they appear in claim text.
const REGISTER_ID = /\b(S\d{2,3})\b/g;

// The claim's text, with each register id that matches a source turned into a
// link to that source in the source database, followed by its short citation:
// "S02 (Thiergart 2023)". A reader who has never seen the register can tell
// what it points to. The words themselves don't change.
function TextWithRegisterLinks({ text, sources }: { text: string; sources: Record<string, SourceRef> }) {
  const byRegisterId: Record<string, SourceRef> = {};
  for (const source of Object.values(sources)) {
    if (source.register_id) {
      byRegisterId[source.register_id] = source;
    }
  }

  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(REGISTER_ID)) {
    const source = byRegisterId[match[1]];
    if (!source || match.index === undefined) {
      continue;
    }
    parts.push(text.slice(last, match.index));
    parts.push(
      <Link key={match.index} href={`/sources/#${source.id}`} className={styles.registerLink}>
        {match[1]}
        <span className={styles.registerCite}> ({shortCitation(source)})</span>
      </Link>,
    );
    last = match.index + match[0].length;
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
