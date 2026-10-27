import { ExternalLink } from "@/components/common/ExternalLink";
import { enumLabel } from "@/lib/enums";
import { shortCitation, type SourceRef } from "@/lib/sources";
import type { Claim } from "@/lib/types";

import { ProvenanceTag } from "./ProvenanceTag";
import styles from "./Provenance.module.css";

interface ClaimTextProps {
  claim: Claim;
  sources?: Record<string, SourceRef>;
  // "block" for paragraphs, "compact" for short fields inside panels and tables
  variant?: "block" | "compact";
}

// Renders one claim with its provenance mark:
//   source  -> the text, then the exact quote with a hanging rule and a citation
//   team    -> an "Our read" margin tag
//   ai      -> a dashed outline and "AI-suggested · checked by X"
//   unclear -> hatching and the stated reason
export function ClaimText({ claim, sources = {}, variant = "block" }: ClaimTextProps) {
  const kindClass = styles[`claim_${claim.provenance}`];
  const variantClass = variant === "compact" ? styles.compact : "";

  const citedSources: SourceRef[] = [];
  for (const id of claim.source_ids ?? []) {
    const source = sources[id];
    if (source) {
      citedSources.push(source);
    }
  }

  return (
    <div className={`${styles.claim} ${kindClass} ${variantClass}`}>
      <ProvenanceTag
        kind={claim.provenance}
        reviewedBy={claim.reviewed_by}
        unclearReason={claim.unclear_reason}
      />
      <p className={styles.text}>{claim.text}</p>

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

// For a list of claims (strongest case, would move earlier, and so on).
export function ClaimList({
  claims,
  sources,
  variant = "block",
}: {
  claims: Claim[];
  sources?: Record<string, SourceRef>;
  variant?: "block" | "compact";
}) {
  if (claims.length === 0) {
    return <p className={styles.empty}>Nothing recorded yet.</p>;
  }
  return (
    <ul className={styles.claimList}>
      {claims.map((claim, index) => (
        <li key={index}>
          <ClaimText claim={claim} sources={sources} variant={variant} />
        </li>
      ))}
    </ul>
  );
}

export function unclearLabel(reason: Claim["unclear_reason"]): string {
  return reason ? enumLabel("UnclearReason", reason) : "";
}
