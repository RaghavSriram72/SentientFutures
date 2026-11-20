import { CodeText } from "@/components/common/CodeText";
import { ExternalLink } from "@/components/common/ExternalLink";
import { ProvenanceGlyph, ProvenanceTag } from "@/components/provenance/ProvenanceTag";
import styles from "@/components/provenance/Provenance.module.css";
import { registerIdsIn, type CodeIndex } from "@/lib/codes";
import { shortCitation, type SourceRef } from "@/lib/sources";
import type { Claim, Family, Provenance } from "@/lib/types";

interface WorkbookClaimProps {
  claim: Claim;
  index: CodeIndex;
  // The page the claim is on, for codes that live on several pages (R05).
  // null where no one family applies.
  family: Family | null;
  sources: Record<string, SourceRef>;
  variant?: "block" | "compact";
  // The page's default kind: a claim of this kind shows only its glyph.
  quiet?: Provenance;
}

// A claim the team's workbook wrote (scope, assessments, welfare, a rating
// card's Why, the compare page's bases), with the same provenance mark
// ClaimText gives. The difference is the text: it goes through CodeText, so
// entry, link, risk, checklist and milestone codes link too, and a source id
// links bare with its citation in the link's title. Vilija's words stay
// exactly as written, with nothing added after each S-id.
export function WorkbookClaim({ claim, index, family, sources, variant = "block", quiet }: WorkbookClaimProps) {
  // The team's own claims carry no mark (anything unmarked is the team's).
  const unmarked = claim.provenance === "team";
  const quietClaim =
    !unmarked && quiet !== undefined && claim.provenance === quiet && !(claim.provenance === "ai" && claim.reviewed_by);
  const classes = [
    styles.claim,
    styles[`claim_${claim.provenance}`],
    variant === "compact" ? styles.compact : "",
    quietClaim ? styles.quiet : "",
  ];

  // A cited source the text doesn't name by its register id still gets a
  // "See ..." line, as in ClaimText. Workbook claims name their sources in
  // the text, so this is usually empty.
  const named = registerIdsIn(claim.text);
  const seeAlso: SourceRef[] = [];
  for (const id of claim.source_ids ?? []) {
    const source = sources[id];
    if (source && (!source.register_id || !named.includes(source.register_id))) {
      seeAlso.push(source);
    }
  }

  return (
    <div className={classes.join(" ")}>
      {unmarked ? null : quietClaim ? (
        <span className={`${styles.quietMark} ${styles[`mark_${claim.provenance}`]}`} aria-hidden="true">
          <ProvenanceGlyph kind={claim.provenance} />
        </span>
      ) : (
        <ProvenanceTag kind={claim.provenance} reviewedBy={claim.reviewed_by} unclearReason={claim.unclear_reason} />
      )}
      <p className={styles.text}>
        <CodeText text={claim.text} index={index} family={family} />
      </p>
      {seeAlso.length > 0 && (
        <p className={styles.citation}>
          See{" "}
          {seeAlso.map((source, position) => (
            <span key={source.id}>
              {position > 0 && "; "}
              <ExternalLink href={source.url}>{shortCitation(source)}</ExternalLink>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
