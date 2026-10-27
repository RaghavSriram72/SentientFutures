import { ExternalLink } from "@/components/common/ExternalLink";
import { DraftMark, SampleChip } from "@/components/common/Marks";
import { formatDate } from "@/components/common/format";
import { ClaimText } from "@/components/provenance/ClaimText";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { enumLabel, isDraftEnum, type EnumName } from "@/lib/enums";
import type { SourceRef } from "@/lib/sources";
import type { Source } from "@/lib/types";

import styles from "./CatalogCard.module.css";

type FieldKey =
  | "kind"
  | "technology"
  | "problem"
  | "evidence_type"
  | "directness"
  | "independence"
  | "relevance"
  | "credibility";

interface CatalogField {
  key: FieldKey;
  label: string;
  enumName: EnumName;
}

// The categorical fields, in reading order: what it is and what it's about,
// then how much weight it can carry.
const CATALOG_FIELDS: CatalogField[] = [
  { key: "kind", label: "Kind", enumName: "SourceKind" },
  { key: "technology", label: "Technology", enumName: "Technology" },
  { key: "problem", label: "Problem", enumName: "Problem" },
  { key: "evidence_type", label: "Evidence type", enumName: "EvidenceType" },
  { key: "directness", label: "Directness", enumName: "Directness" },
  { key: "independence", label: "Independence", enumName: "Independence" },
  { key: "relevance", label: "Relevance", enumName: "Relevance" },
  { key: "credibility", label: "Credibility", enumName: "Credibility" },
];

// A field can hold one value, several (technology) or none (problem).
function fieldValues(source: Source, key: FieldKey): string[] {
  const raw = source[key];
  if (raw === null || raw === undefined) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  return [raw];
}

// "Preprint · 2025 · arXiv 0000.00000" (shown in caps by CSS)
function catalogLine(source: Source): string {
  const parts = [enumLabel("SourceType", source.source_type), String(source.year)];
  if (source.arxiv_id) {
    parts.push(`arXiv ${source.arxiv_id}`);
  } else if (source.doi) {
    parts.push(`DOI ${source.doi}`);
  }
  return parts.join(" · ");
}

// Same wording as ProvenanceTag, so the AI mark reads the same everywhere.
function aiNote(reviewedBy: string | null | undefined): string {
  const label = enumLabel("Provenance", "ai");
  return reviewedBy ? `${label} · checked by ${reviewedBy}` : `${label} · not yet reviewed`;
}

// One source as a library catalog card: mono call line, serif title, our summary,
// then every category as a labeled chip. Fields the AI suggested keep the AI mark.
// The validator only accepts these names in ai_suggested_fields: source_type
// (marked under the call line), credibility_unclear_reason (marked with the
// credibility cell) and the eight CATALOG_FIELDS. Each one gets marked here.
export function CatalogCard({ source, sources }: { source: Source; sources: Record<string, SourceRef> }) {
  const titleId = `${source.id}-title`;
  const isAiSourceType = source.ai_suggested_fields.includes("source_type");

  return (
    <article id={source.id} className={`paper ${styles.card}`} aria-labelledby={titleId}>
      <header className={styles.header}>
        <p className={styles.callLine}>{catalogLine(source)}</p>
        {source.sample && <SampleChip />}
        {isAiSourceType && (
          <span className={styles.aiNote}>
            <ProvenanceGlyph kind="ai" />
            Source type: {aiNote(source.reviewed_by)}
          </span>
        )}
      </header>

      <div className={styles.titleBlock}>
        <h3 id={titleId} className={styles.title}>
          <ExternalLink href={source.url}>{source.title}</ExternalLink>
        </h3>
        <p className={styles.byline}>
          {source.authors.join(", ")}
          {source.venue && (
            <>
              <span className={styles.dot} aria-hidden="true">
                ·
              </span>
              <span className={styles.venue}>{source.venue}</span>
            </>
          )}
        </p>
      </div>

      <div className={styles.summary}>
        <ClaimText claim={source.summary} sources={sources} variant="compact" />
      </div>

      <dl className={styles.fields}>
        {CATALOG_FIELDS.map((field) => (
          <CatalogFieldCell key={field.key} field={field} source={source} />
        ))}
      </dl>

      <footer className={styles.footer}>
        <span>
          {source.reviewed_by ? `Reviewed by ${source.reviewed_by}` : "Not yet reviewed"}
          {source.reviewed_on && ` · ${formatDate(source.reviewed_on)}`}
        </span>
        <span className={styles.ref}>Ref. {source.id}</span>
      </footer>
    </article>
  );
}

function CatalogFieldCell({ field, source }: { field: CatalogField; source: Source }) {
  const values = fieldValues(source, field.key);
  let isAi = source.ai_suggested_fields.includes(field.key);
  // The reason for an Unclear credibility is shown inside the credibility chip.
  if (field.key === "credibility" && source.ai_suggested_fields.includes("credibility_unclear_reason")) {
    isAi = true;
  }
  const isUnclearCredibility = field.key === "credibility" && source.credibility === "unclear";

  let chipClass = "chip";
  if (isUnclearCredibility) {
    chipClass = `chip ${styles.chipUnclear}`;
  } else if (isAi) {
    chipClass = `chip ${styles.chipAi}`;
  }

  return (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>
        {field.label}
        {isDraftEnum(field.enumName) && <DraftMark />}
      </dt>
      <dd className={styles.fieldValue}>
        {values.length === 0 && <span className={styles.none}>Not stated</span>}
        {values.map((value) => (
          <span key={value} className={chipClass}>
            {enumLabel(field.enumName, value)}
            {isUnclearCredibility && source.credibility_unclear_reason && (
              <>: {enumLabel("UnclearReason", source.credibility_unclear_reason)}</>
            )}
          </span>
        ))}
        {isAi && (
          <span className={styles.aiNote}>
            <ProvenanceGlyph kind="ai" />
            {aiNote(source.reviewed_by)}
          </span>
        )}
      </dd>
    </div>
  );
}
