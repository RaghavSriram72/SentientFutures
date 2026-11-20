import type { ReactNode } from "react";

import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { enumLabel } from "@/lib/enums";
import type { CaseRating, Confidence, ScorecardRow, UnclearReason } from "@/lib/types";

import styles from "./RatingChip.module.css";

// The rating chip, the neutral chip and the confidence meter, the marks every
// view of a rating uses: the rating cards, the grading key, Where we land,
// the assessment verdicts, the compare columns and the home page. They live
// in a module of their own, so RatingFacts can use them without importing
// the Scorecard that renders RatingFacts.

type Scale = ScorecardRow["scale"];

// strong -> 3, moderate -> 2, weak -> 1. Unclear and not claimed aren't
// points on the scale, so they get their own styles.
function ratingLevel(rating: CaseRating): number {
  if (rating === "strong") {
    return 3;
  }
  if (rating === "moderate") {
    return 2;
  }
  return 1;
}

function levelClass(level: number): string {
  if (level === 3) {
    return styles.caseStrong;
  }
  if (level === 2) {
    return styles.caseModerate;
  }
  return styles.caseWeak;
}

interface RatingChipProps {
  // Kept so every caller can pass the row's scale. A risk row has no rating
  // since v0.4 (it has severity and likelihood instead), so it gets no chip.
  scale: Scale;
  rating: CaseRating | null;
  unclearReason?: UnclearReason | null;
}

// A rating as a monospace chip. The label is always written out, so the
// pips, hatching and outline are extra cues, never the only one.
export function RatingChip({ rating, unclearReason }: RatingChipProps) {
  if (rating === null) {
    return null;
  }
  const label = enumLabel("CaseRating", rating);

  if (rating === "not_claimed") {
    return (
      <span className={`${styles.chip} ${styles.chipNotClaimed}`}>
        <NotClaimedGlyph />
        {label}
      </span>
    );
  }

  if (rating === "unclear") {
    return (
      <span className={styles.unclear}>
        <span className={`${styles.chip} ${styles.chipUnclear}`}>
          <ProvenanceGlyph kind="unclear" />
          {label}
        </span>
        {unclearReason && <span className={styles.reason}>{enumLabel("UnclearReason", unclearReason)}</span>}
      </span>
    );
  }

  const level = ratingLevel(rating);
  return (
    <span className={`${styles.chip} ${levelClass(level)}`}>
      <LevelPips level={level} />
      {label}
    </span>
  );
}

// A value on one of the workbook's other scales, such as a severity
// ("Very high") or an evidence basis ("Argued"). Outline only, with no colour
// or pips, so it never reads as good or bad.
export function NeutralChip({ label }: { label: string }) {
  return <span className={`${styles.chip} ${styles.chipNeutral}`}>{label}</span>;
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
