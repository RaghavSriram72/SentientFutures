import Link from "next/link";

import { GLOSSARY } from "@/components/glossary/glossary";
import type { TimelineItem } from "@/components/timeline/timelineModel";
import { enumLabel, enumValues, isDraftEnum, RUBRIC_VERSION } from "@/lib/enums";
import type { SourceRef } from "@/lib/sources";
import type { CaseRating, EvidenceRow, Provenance, RiskRating, ScorecardRow } from "@/lib/types";

import { RatingCardList } from "./RatingCard";
import { RatingChip, SeverityFlag } from "./RatingChip";
import { lowerFirst } from "./text";
import styles from "./Scorecard.module.css";

// The card ids moved to lib/dimensions, which the compare page shares. Kept
// here too, so older imports still work. It takes the row's id now.
export { scorecardRowId } from "@/lib/dimensions";
// The same for the card's text helpers. They live in the pure model now, so
// the rating cards don't import them from here.
export { firstSentence, scaleLabel } from "./ratingCardModel";
// The chip and the meter moved to RatingChip.tsx, so RatingFacts (which the
// rating cards here render) doesn't import this file. Kept here too, so
// older imports still work.
export { ConfidenceMeter, RatingChip } from "./RatingChip";

// A section elsewhere on the page that covers a row's basis in full.
export interface ScorecardDetailLink {
  href: string;
  label: string;
}

interface ScorecardProps {
  rows: ScorecardRow[];
  technologyName: string;
  shortName: string;
  // h4 under the "Full scorecard" h3, or h3 when the scorecard is the only
  // part of the section and the section's h2 names it.
  headingLevel: 3 | 4;
  // The page's evidence register, for the lines each card links to.
  register: EvidenceRow[];
  // This technology's public milestones, for the ones each rating informs.
  items: TimelineItem[];
  sources: Record<string, SourceRef>;
  // The same sources keyed by register id ("S02"), for the evidence lines.
  sourcesByRegisterId: Record<string, SourceRef>;
  // The page's default provenance; claims of this kind show only their glyph.
  quiet?: Provenance;
  // Keyed by row id. A card listed here shows the first sentence of its
  // basis and a link to the section that covers the rest.
  detailLinks?: Record<string, ScorecardDetailLink>;
}

// The scorecard as a printed report card: one rating card per dimension, with
// the rating, how confident we are, the claim the rating rests on and what
// the team tracks for it. Rows are generic, so the team can add or rename
// dimensions in content only (a rename keeps the row's id).
export function Scorecard({
  rows,
  technologyName,
  shortName,
  headingLevel,
  register,
  items,
  sources,
  sourcesByRegisterId,
  quiet,
  detailLinks = {},
}: ScorecardProps) {
  return (
    <div className={`paper ${styles.card}`}>
      <div className={styles.cardHead}>
        <span>Scorecard · {shortName}</span>
        <span>Rubric v{RUBRIC_VERSION}</span>
      </div>

      <RatingCardList
        rows={rows}
        technologyName={technologyName}
        headingLevel={headingLevel}
        register={register}
        items={items}
        sources={sources}
        sourcesByRegisterId={sourcesByRegisterId}
        quiet={quiet}
        detailLinks={detailLinks}
      />

      <GradingKey showSeverity={hasSeverityFlag(rows)} showNotClaimed={hasNotClaimed(rows)} />
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

function hasNotClaimed(rows: ScorecardRow[]): boolean {
  for (const row of rows) {
    if (row.rating === "not_claimed") {
      return true;
    }
  }
  return false;
}

// Every value on both scales, so readers can see that Not claimed, Weak and
// Unclear are three different things. Values come from the shared enums.
// Each rule sits under the chips it explains. The Not claimed note and the
// severity warning show only when a row on the page uses them.
function GradingKey({ showSeverity, showNotClaimed }: { showSeverity: boolean; showNotClaimed: boolean }) {
  return (
    <div className={styles.key}>
      <p className={styles.keyTitle}>Grading key</p>
      <div className={styles.keyRow}>
        <span className={styles.keyLabel}>Case</span>
        {enumValues("CaseRating").map((info) => (
          <RatingChip key={info.value} scale="case" rating={info.value as CaseRating} />
        ))}
        {showNotClaimed && (
          <p className={styles.keyRule}>
            {enumLabel("CaseRating", "not_claimed")}: {lowerFirst(GLOSSARY["not-claimed"])}
          </p>
        )}
      </div>
      <div className={styles.keyRow}>
        <span className={styles.keyLabel}>Risk</span>
        {enumValues("RiskRating").map((info) => (
          <RatingChip key={info.value} scale="risk" rating={info.value as RiskRating} />
        ))}
        <p className={styles.keyRule}>
          We never rate a risk Low just because nobody has studied it.
          {isDraftEnum("RiskRating") && " The scale’s cutoffs aren’t set yet."}
        </p>
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
      <p className={styles.keyMore}>
        <Link href="/methodology/#ratings">
          How we rate<span aria-hidden="true"> &rarr;</span>
        </Link>
      </p>
    </div>
  );
}
