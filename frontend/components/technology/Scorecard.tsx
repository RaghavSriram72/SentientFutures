import type { ReactNode } from "react";

import { ClaimText } from "@/components/provenance/ClaimText";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { enumLabel, enumValues, RUBRIC_VERSION } from "@/lib/enums";
import type { SourceRef } from "@/lib/sources";
import type { CaseRating, Confidence, Provenance, RiskRating, ScorecardRow, UnclearReason } from "@/lib/types";

import styles from "./Scorecard.module.css";

type Scale = ScorecardRow["scale"];
type Rating = CaseRating | RiskRating;
type Severity = NonNullable<ScorecardRow["potential_severity"]>;

// A section elsewhere on the page that covers a row's basis in full.
export interface ScorecardDetailLink {
  href: string;
  label: string;
}

interface ScorecardProps {
  rows: ScorecardRow[];
  technologyName: string;
  shortName: string;
  sources: Record<string, SourceRef>;
  // The page's default provenance; claims of this kind show only their glyph.
  quiet?: Provenance;
  // Keyed by dimension. A row listed here shows the first sentence of its
  // basis and a link to the section that covers the rest.
  detailLinks?: Record<string, ScorecardDetailLink>;
}

// The scorecard as a printed report card: one ruled row per dimension, with
// the rating, how confident we are, and the claim the rating rests on.
// Rows are generic, so the team can add or rename dimensions in content only.
export function Scorecard({ rows, technologyName, shortName, sources, quiet, detailLinks = {} }: ScorecardProps) {
  return (
    <div className={`paper ${styles.card}`}>
      <div className={styles.cardHead}>
        <span>Scorecard · {shortName}</span>
        <span>Rubric v{RUBRIC_VERSION}</span>
      </div>

      {/* The explicit roles keep table semantics on small screens, where the
          CSS turns each row into a card and browsers drop the implicit ones. */}
      <table className={styles.table} role="table">
        <caption className="visually-hidden">Scorecard for {technologyName}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col" className={styles.colDimension}>
              Dimension
            </th>
            <th role="columnheader" scope="col" className={styles.colRating}>
              Rating
            </th>
            <th role="columnheader" scope="col" className={styles.colConfidence}>
              Confidence
            </th>
            <th role="columnheader" scope="col" className={styles.colBasis}>
              Basis
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row, index) => (
            <ScorecardTableRow
              key={index}
              row={row}
              sources={sources}
              quiet={quiet}
              detailLink={detailLinks[row.dimension]}
            />
          ))}
        </tbody>
      </table>

      <GradingKey showSeverity={hasSeverityFlag(rows)} />
    </div>
  );
}

export function hasSeverityFlag(rows: ScorecardRow[]): boolean {
  for (const row of rows) {
    if (row.scale === "risk" && row.rating === "unclear" && row.potential_severity) {
      return true;
    }
  }
  return false;
}

// "Alignment case" -> "scorecard-alignment-case", so other parts of the page
// can link to one row.
export function scorecardRowId(dimension: string): string {
  const slug = dimension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `scorecard-${slug}`;
}

// The text up to and including the first full stop that ends a sentence.
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.?!](?=\s|$)/);
  return match ? match[0] : text;
}

interface ScorecardTableRowProps {
  row: ScorecardRow;
  sources: Record<string, SourceRef>;
  quiet?: Provenance;
  detailLink?: ScorecardDetailLink;
}

function ScorecardTableRow({ row, sources, quiet, detailLink }: ScorecardTableRowProps) {
  // With a detail section, the row keeps one sentence and points to the rest.
  const basis = detailLink ? { ...row.basis, text: firstSentence(row.basis.text) } : row.basis;
  return (
    <tr className={styles.row} role="row" id={scorecardRowId(row.dimension)}>
      <th className={styles.dimension} scope="row" role="rowheader">
        <span className={styles.dimensionName}>{row.dimension}</span>
        <span className={styles.scale}>{scaleLabel(row)}</span>
      </th>
      <td className={styles.cell} data-label="Rating" role="cell">
        <RatingChip
          scale={row.scale}
          rating={row.rating}
          unclearReason={row.unclear_reason}
          potentialSeverity={row.scale === "risk" ? row.potential_severity : null}
        />
      </td>
      <td className={`${styles.cell} ${styles.confidenceCell}`} data-label="Confidence" role="cell">
        <ConfidenceMeter confidence={row.confidence} />
      </td>
      <td className={`${styles.cell} ${styles.basisCell}`} data-label="Basis" role="cell">
        <ClaimText claim={basis} sources={sources} variant="compact" quiet={quiet} />
        {detailLink && (
          <a href={detailLink.href} className={styles.detailLink}>
            More in {detailLink.label}
          </a>
        )}
      </td>
    </tr>
  );
}

// "Case · Alignment", "Risk"
function scaleLabel(row: ScorecardRow): string {
  const scale = row.scale === "case" ? "Case" : "Risk";
  if (row.problem) {
    return `${scale} · ${enumLabel("Problem", row.problem)}`;
  }
  return scale;
}

// strong/high -> 3, moderate/medium -> 2, weak/low -> 1. Unclear and
// not claimed aren't points on the scale, so they get their own styles.
function ratingLevel(rating: Rating): number {
  if (rating === "strong" || rating === "high") {
    return 3;
  }
  if (rating === "moderate" || rating === "medium") {
    return 2;
  }
  if (rating === "weak" || rating === "low") {
    return 1;
  }
  return 0;
}

function levelClass(scale: Scale, level: number): string {
  if (scale === "case") {
    if (level === 3) {
      return styles.caseStrong;
    }
    if (level === 2) {
      return styles.caseModerate;
    }
    return styles.caseWeak;
  }
  if (level === 3) {
    return styles.riskHigh;
  }
  if (level === 2) {
    return styles.riskMedium;
  }
  return styles.riskLow;
}

interface RatingChipProps {
  scale: Scale;
  rating: Rating;
  unclearReason?: UnclearReason | null;
  // Risk rows only. Shown beside an Unclear chip as a warning, never as a rating.
  potentialSeverity?: Severity | null;
}

// A rating as a monospace chip. The label is always written out, so the
// pips, hatching and outline are extra cues, never the only one.
export function RatingChip({ scale, rating, unclearReason, potentialSeverity }: RatingChipProps) {
  const label = scale === "case" ? enumLabel("CaseRating", rating) : enumLabel("RiskRating", rating);

  if (rating === "not_claimed") {
    return (
      <span className={`${styles.chip} ${styles.chipNotClaimed}`}>
        <NotClaimedGlyph />
        {label}
      </span>
    );
  }

  if (rating === "unclear") {
    const severity = scale === "risk" ? potentialSeverity : null;
    return (
      <span className={styles.unclear}>
        <span className={styles.unclearLine}>
          <span className={`${styles.chip} ${styles.chipUnclear}`}>
            <ProvenanceGlyph kind="unclear" />
            {label}
          </span>
          {severity && <SeverityFlag severity={severity} afterChip />}
        </span>
        {unclearReason && <span className={styles.reason}>{enumLabel("UnclearReason", unclearReason)}</span>}
      </span>
    );
  }

  const level = ratingLevel(rating);
  return (
    <span className={`${styles.chip} ${levelClass(scale, level)}`}>
      <LevelPips level={level} />
      {label}
    </span>
  );
}

// "Potentially high severity" next to an Unclear risk. It is plain text with
// an outline triangle, so it can't be mistaken for a High chip. After a chip,
// screen readers hear "Unclear, potentially high severity".
function SeverityFlag({ severity, afterChip = false }: { severity: Severity; afterChip?: boolean }) {
  return (
    <span className={`${styles.severity} ${severityClass(severity)}`}>
      {afterChip && <span className="visually-hidden">, </span>}
      <WarningGlyph />
      Potentially {enumLabel("RiskRating", severity).toLowerCase()} severity
    </span>
  );
}

function severityClass(severity: Severity): string {
  if (severity === "high") {
    return styles.severityHigh;
  }
  if (severity === "medium") {
    return styles.severityMedium;
  }
  return styles.severityLow;
}

function WarningGlyph() {
  return (
    <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.4 11 10.3H1Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <line x1="6" y1="4.6" x2="6" y2="7.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6" cy="8.85" r="0.65" fill="currentColor" />
    </svg>
  );
}

function LevelPips({ level }: { level: number }) {
  const pips: ReactNode[] = [];
  for (let index = 1; index <= 3; index++) {
    const className = index <= level ? `${styles.pip} ${styles.pipOn}` : styles.pip;
    pips.push(<span key={index} className={className} />);
  }
  return (
    <span className={styles.pips} aria-hidden="true">
      {pips}
    </span>
  );
}

// A dash struck through: "nobody is making this case", which is a different
// statement from "the case is weak".
function NotClaimedGlyph() {
  return (
    <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
      <line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="4" y1="10" x2="8" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function confidenceLevel(confidence: Confidence): number {
  if (confidence === "high") {
    return 3;
  }
  if (confidence === "medium") {
    return 2;
  }
  return 1;
}

// Three rising bars, like a signal meter, next to the written label.
export function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const level = confidenceLevel(confidence);
  const bars: ReactNode[] = [];
  for (let index = 1; index <= 3; index++) {
    const className = index <= level ? `${styles.bar} ${styles.barOn}` : styles.bar;
    bars.push(<span key={index} className={className} />);
  }
  return (
    <span className={styles.confidence}>
      <span className={styles.bars} aria-hidden="true">
        {bars}
      </span>
      {enumLabel("Confidence", confidence)}
    </span>
  );
}

// Every value on both scales, so readers can see that Not claimed, Weak and
// Unclear are three different things. Values come from the shared enums.
// The severity warning gets its own line only when a row on the page uses it.
function GradingKey({ showSeverity }: { showSeverity: boolean }) {
  return (
    <div className={styles.key}>
      <p className={styles.keyTitle}>Grading key</p>
      <div className={styles.keyRow}>
        <span className={styles.keyLabel}>Case</span>
        {enumValues("CaseRating").map((info) => (
          <RatingChip key={info.value} scale="case" rating={info.value as CaseRating} />
        ))}
      </div>
      <div className={styles.keyRow}>
        <span className={styles.keyLabel}>Risk</span>
        {enumValues("RiskRating").map((info) => (
          <RatingChip key={info.value} scale="risk" rating={info.value as RiskRating} />
        ))}
      </div>
      {showSeverity && (
        <div className={styles.keyRow}>
          <span className={styles.keyLabel}>Warning</span>
          <SeverityFlag severity="high" />
          <span className={styles.keyNote}>
            How bad an Unclear risk could be. The rating itself stays Unclear.
          </span>
        </div>
      )}
    </div>
  );
}
