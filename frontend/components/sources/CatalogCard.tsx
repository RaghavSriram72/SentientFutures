import { ExternalLink } from "@/components/common/ExternalLink";
import { DraftMark, SampleChip } from "@/components/common/Marks";
import { formatDate } from "@/components/common/format";
import { ClaimText } from "@/components/provenance/ClaimText";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { enumLabel, isDraftEnum, type EnumName } from "@/lib/enums";
import type { SourceRef } from "@/lib/sources";
import type { Source } from "@/lib/types";

import { AuthorList } from "./AuthorList";
import { ClaimDirectionChip } from "./ClaimDirectionChip";
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

// What the source is and what it's about. The claim direction sits after
// these in its own wide cell.
const TAG_FIELDS: CatalogField[] = [
  { key: "kind", label: "Kind", enumName: "SourceKind" },
  { key: "technology", label: "Technology", enumName: "Technology" },
  { key: "problem", label: "Problem", enumName: "Problem" },
];

// The rubric: how much weight the source can carry. Each one is null until
// someone rates it.
const RUBRIC_FIELDS: CatalogField[] = [
  { key: "evidence_type", label: "Evidence type", enumName: "EvidenceType" },
  { key: "directness", label: "Directness", enumName: "Directness" },
  { key: "independence", label: "Independence", enumName: "Independence" },
  { key: "relevance", label: "Relevance", enumName: "Relevance" },
  { key: "credibility", label: "Credibility", enumName: "Credibility" },
];

// What an empty tag means. The Notion import leaves technology empty for
// general background (like the Intelligence Curse essay) and problem empty
// when the team tagged it Neither.
const EMPTY_TAG_TEXT: Partial<Record<FieldKey, string>> = {
  technology: "General background",
  problem: "Neither",
};

// A field can hold one value, several (technology) or none.
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

function countRated(source: Source): number {
  let count = 0;
  for (const field of RUBRIC_FIELDS) {
    if (fieldValues(source, field.key).length > 0) {
      count += 1;
    }
  }
  return count;
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

// "https://www.lesswrong.com/posts/..." -> "lesswrong.com"
function siteName(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

// Same wording as ProvenanceTag, so the AI mark reads the same everywhere.
function aiNote(reviewedBy: string | null | undefined): string {
  const label = enumLabel("Provenance", "ai");
  return reviewedBy ? `${label} · checked by ${reviewedBy}` : `${label} · not yet reviewed`;
}

interface CardOptions {
  // The name shared by most sources ("Vilija"). The page header says it once,
  // so a card only shows "Added by" when its name is different.
  sharedAddedBy?: string | null;
  // The page header already says nothing is rated, so drop the per-card line.
  hideUnrated?: boolean;
}

// One source as a library catalog card: the register id and call line, a serif
// title, the team's summary, the tags, then the rubric ratings.
// Fields the AI suggested keep the AI mark. The validator only accepts these
// names in ai_suggested_fields: source_type (marked under the call line),
// credibility_unclear_reason (marked with the credibility cell), claim_directions,
// and the tag and rubric fields above. Each one gets marked here.
export function CatalogCard({
  source,
  sources,
  sharedAddedBy = null,
  hideUnrated = false,
}: { source: Source; sources: Record<string, SourceRef> } & CardOptions) {
  const titleId = `${source.id}-title`;
  const isAiSourceType = source.ai_suggested_fields.includes("source_type");
  const otherUrls = source.other_urls ?? [];

  return (
    <article id={source.id} className={`paper ${styles.card}`} aria-labelledby={titleId}>
      <header className={styles.header}>
        <p className={styles.callLine}>
          {source.register_id && (
            <span className={styles.registerId}>
              <span className="visually-hidden">Register ID </span>
              {source.register_id}
            </span>
          )}
          <span>{catalogLine(source)}</span>
        </p>
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
          <AuthorList authors={source.authors} />
          {source.venue && (
            <>
              <span className={styles.dot} aria-hidden="true">
                ·
              </span>
              <span className={styles.venue}>{source.venue}</span>
            </>
          )}
        </p>
        {otherUrls.length > 0 && <AlsoAt urls={otherUrls} />}
      </div>

      <CardBody source={source} sources={sources} sharedAddedBy={sharedAddedBy} hideUnrated={hideUnrated} />
    </article>
  );
}

// What a compact row on the sources page opens to: everything on the card
// except the title and byline, which the row already shows. The link to the
// source moves to the top, since the row's title isn't a link.
export function SourceDetails({
  source,
  sources,
  sharedAddedBy = null,
  hideUnrated = false,
}: { source: Source; sources: Record<string, SourceRef> } & CardOptions) {
  const isAiSourceType = source.ai_suggested_fields.includes("source_type");
  const otherUrls = source.other_urls ?? [];
  const identifier = source.arxiv_id ? `arXiv ${source.arxiv_id}` : source.doi ? `DOI ${source.doi}` : null;

  return (
    <div className={styles.details}>
      <div className={styles.detailsLinks}>
        <p className={styles.openLink}>
          <ExternalLink href={source.url}>Open the source at {siteName(source.url)}</ExternalLink>
          <span aria-hidden="true"> &#8599;</span>
        </p>
        {(identifier || source.venue) && (
          <p className={styles.byline}>
            {source.venue && <span className={styles.venue}>{source.venue}</span>}
            {source.venue && identifier && (
              <span className={styles.dot} aria-hidden="true">
                ·
              </span>
            )}
            {identifier && <span className="mono">{identifier}</span>}
          </p>
        )}
        {otherUrls.length > 0 && <AlsoAt urls={otherUrls} />}
        {/* The row shows a lone author in full already; longer lists get their full names here. */}
        {source.authors.length > 1 && (
          <p className={styles.byline}>
            <AuthorList authors={source.authors} />
          </p>
        )}
        {isAiSourceType && (
          <span className={styles.aiNote}>
            <ProvenanceGlyph kind="ai" />
            Source type: {aiNote(source.reviewed_by)}
          </span>
        )}
      </div>
      <CardBody source={source} sources={sources} sharedAddedBy={sharedAddedBy} hideUnrated={hideUnrated} />
    </div>
  );
}

function AlsoAt({ urls }: { urls: string[] }) {
  return (
    <p className={styles.alsoAt}>
      <span className={styles.alsoAtLabel}>Also at</span>
      {urls.map((url, index) => (
        <span key={index}>
          {index > 0 && (
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
          )}
          <ExternalLink href={url}>{siteName(url)}</ExternalLink>
        </span>
      ))}
    </p>
  );
}

// The team's summary, the tags, the rubric and who added and reviewed it.
function CardBody({
  source,
  sources,
  sharedAddedBy,
  hideUnrated,
}: { source: Source; sources: Record<string, SourceRef> } & Required<CardOptions>) {
  const directions = source.claim_directions ?? [];
  const isAiDirections = source.ai_suggested_fields.includes("claim_directions");
  const showAddedBy = Boolean(source.added_by) && source.added_by !== sharedAddedBy;
  const showFooter = showAddedBy || Boolean(source.reviewed_by);

  return (
    <>
      <div className={styles.summary}>
        <ClaimText claim={source.summary} sources={sources} variant="compact" />
      </div>

      <dl className={styles.fields}>
        {TAG_FIELDS.map((field) => {
          // Kind is left out until someone classifies the source.
          if (field.key === "kind" && fieldValues(source, "kind").length === 0) {
            return null;
          }
          return (
            <CatalogFieldCell
              key={field.key}
              field={field}
              source={source}
              emptyText={EMPTY_TAG_TEXT[field.key] ?? "Not stated"}
              emptyAsChip={EMPTY_TAG_TEXT[field.key] !== undefined}
            />
          );
        })}
        <div className={`${styles.field} ${styles.fieldWide}`}>
          <dt className={styles.fieldLabel}>
            Claim direction
            {isDraftEnum("ClaimDirection") && <DraftMark />}
          </dt>
          <dd className={styles.fieldValue}>
            {directions.length === 0 && <span className={styles.none}>Not tagged</span>}
            {directions.map((direction) => (
              <ClaimDirectionChip key={direction} direction={direction} />
            ))}
            {isAiDirections && (
              <span className={styles.aiNote}>
                <ProvenanceGlyph kind="ai" />
                {aiNote(source.reviewed_by)}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <RubricBlock source={source} hideUnrated={hideUnrated} />

      {showFooter && (
        <footer className={styles.footer}>
          <span>{showAddedBy ? `Added by ${source.added_by}` : ""}</span>
          {source.reviewed_by && (
            <span>
              Reviewed by {source.reviewed_by}
              {source.reviewed_on && ` · ${formatDate(source.reviewed_on)}`}
            </span>
          )}
        </footer>
      )}
    </>
  );
}

// One line when nothing is rated, so a scouted source doesn't show five empty
// cells, or nothing at all when the page has already said so. Once any rating
// is in, every rubric field gets its own cell.
function RubricBlock({ source, hideUnrated }: { source: Source; hideUnrated: boolean }) {
  if (countRated(source) === 0) {
    if (hideUnrated) {
      return null;
    }
    return (
      <p className={styles.notRated}>
        <span className={styles.fieldLabel}>Rubric ratings</span>
        <span className={styles.none}>Not rated yet</span>
      </p>
    );
  }
  return (
    <dl className={`${styles.fields} ${styles.rubricFields}`}>
      {RUBRIC_FIELDS.map((field) => (
        <CatalogFieldCell key={field.key} field={field} source={source} emptyText="Not rated" emptyAsChip={false} />
      ))}
    </dl>
  );
}

function CatalogFieldCell({
  field,
  source,
  emptyText,
  emptyAsChip,
}: {
  field: CatalogField;
  source: Source;
  emptyText: string;
  emptyAsChip: boolean;
}) {
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
        {values.length === 0 && emptyAsChip && <span className={chipClass}>{emptyText}</span>}
        {values.length === 0 && !emptyAsChip && <span className={styles.none}>{emptyText}</span>}
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
