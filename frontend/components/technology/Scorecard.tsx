import Link from "next/link";

import type { TimelineItem } from "@/components/timeline/timelineModel";
import { buildCodeIndex } from "@/lib/codes";
import { getScorecard, getTechnologies } from "@/lib/data";
import { enumValues } from "@/lib/enums";
import type { SourceRef } from "@/lib/sources";
import type { CodebookRow, Family, Provenance, ScorecardData, ScorecardRow } from "@/lib/types";

import { RatingCardList } from "./RatingCard";
import { familyForTechnology, gradingMeanings } from "./ratingCardModel";
import { ConfidenceMeter, NeutralChip, RatingChip } from "./RatingChip";
import styles from "./Scorecard.module.css";

// The card ids moved to lib/dimensions, which the compare page shares. Kept
// here too, so older imports still work. It takes the row's id now.
export { scorecardRowId } from "@/lib/dimensions";
// The same for the card's scale label. It lives in the pure model now, so
// the rating cards don't import it from here.
export { scaleLabel } from "./ratingCardModel";
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
  // This technology's public milestones, for the ones each rating informs.
  items: TimelineItem[];
  sources: Record<string, SourceRef>;
  // The page's default provenance; claims of this kind show only their glyph.
  quiet?: Provenance;
  // Keyed by row id: the section elsewhere on the page that covers the row
  // in full, which its card links to.
  detailLinks?: Record<string, ScorecardDetailLink>;
  // The page's family, for the evidence and risks each card reads. Found
  // from technologyName when not given; null shows neither.
  family?: Family | null;
  // The workbook's shared tables. Read from content/scorecard.json when not
  // given, so this is a server component.
  scorecard?: ScorecardData;
}

// The scorecard as a printed report card: one rating card per dimension, with
// the rating, how confident we are, the claim the rating rests on and the
// evidence that feeds it, then the grading key with the Codebook's meaning of
// each rating and confidence. Rows are generic, so the team can add or rename
// dimensions in content only (a rename keeps the row's id).
export function Scorecard({
  rows,
  technologyName,
  shortName,
  headingLevel,
  items,
  sources,
  quiet,
  detailLinks = {},
  family,
  scorecard,
}: ScorecardProps) {
  const workbook = scorecard ?? getScorecard();
  const pageFamily = family !== undefined ? family : familyForTechnology(getTechnologies(), technologyName);
  // Built here once for every card's evidence lines. Plain data.
  const codeIndex = buildCodeIndex(workbook, Object.values(sources));

  return (
    <div className={`paper ${styles.card}`}>
      <div className={styles.cardHead}>
        <span>Scorecard · {shortName}</span>
      </div>

      <RatingCardList
        rows={rows}
        technologyName={technologyName}
        headingLevel={headingLevel}
        items={items}
        sources={sources}
        quiet={quiet}
        detailLinks={detailLinks}
        family={pageFamily}
        scorecard={workbook}
        codeIndex={codeIndex}
      />

      <GradingKey codebook={workbook.codebook ?? []} showRiskScales={hasRiskScale(rows)} />
    </div>
  );
}

// A page whose risk rows show a severity or a likelihood gets those scales in the key.
function hasRiskScale(rows: ScorecardRow[]): boolean {
  return rows.some((row) => row.scale === "risk" && (row.severity || row.likelihood));
}

// Every value on each scale the cards use, so readers can see that Not
// claimed, Weak and Unclear are three different things. Each rating and each
// confidence has its Codebook meaning beside it, word for word (the
// Confidence cell cut at its own "High:", "Medium:" and "Low:", each part
// with a capital first letter); the cards don't repeat them. Values and labels come from the shared enums;
// "Severity" and "Likelihood" are the workbook's own headers. Their chips
// are neutral, like the cards': no scale value is coloured as good or bad.
// Not claimed has its Codebook meaning beside its chip like the others, so
// the key doesn't add a second sentence for it.
function GradingKey({ codebook, showRiskScales }: { codebook: CodebookRow[]; showRiskScales: boolean }) {
  const meanings = gradingMeanings(codebook);
  return (
    <div className={styles.key}>
      <p className={styles.keyTitle}>Grading key</p>
      <div className={styles.keyScale}>
        <p className={styles.keyLabel}>Case</p>
        <div className={styles.keyValues}>
          <dl className={styles.keyMeanings}>
            {meanings.ratings.map(({ value, definition }) => (
              <div key={value} className={styles.keyMeaning}>
                <dt>
                  <RatingChip scale="case" rating={value} />
                </dt>
                {definition && <dd className={styles.keyDefinition}>{definition}</dd>}
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className={styles.keyScale}>
        <p className={styles.keyLabel}>Confidence</p>
        <dl className={styles.keyMeanings}>
          {meanings.confidences.map(({ value, definition }) => (
            <div key={value} className={styles.keyMeaning}>
              <dt>
                <ConfidenceMeter confidence={value} />
              </dt>
              {definition && <dd className={styles.keyDefinition}>{definition}</dd>}
            </div>
          ))}
        </dl>
      </div>
      {showRiskScales && (
        <>
          <div className={styles.keyScale}>
            <p className={styles.keyLabel}>Severity</p>
            <p className={styles.keyChips}>
              {enumValues("Severity").map((info) => (
                <NeutralChip key={info.value} label={info.label} />
              ))}
            </p>
          </div>
          <div className={styles.keyScale}>
            <p className={styles.keyLabel}>Likelihood</p>
            <p className={styles.keyChips}>
              {enumValues("Likelihood").map((info) => (
                <NeutralChip key={info.value} label={info.label} />
              ))}
            </p>
          </div>
        </>
      )}
      <p className={styles.keyMore}>
        <Link href="/methodology/#ratings">
          How we rate<span aria-hidden="true"> &rarr;</span>
        </Link>
      </p>
    </div>
  );
}
