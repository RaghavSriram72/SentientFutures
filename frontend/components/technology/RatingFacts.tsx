import { enumLabel } from "@/lib/enums";
import type { ScorecardRow } from "@/lib/types";

import { cardKind } from "./ratingCardModel";
import { ConfidenceMeter, NeutralChip, RatingChip } from "./RatingChip";
import styles from "./RatingFacts.module.css";

interface RatingFactsProps {
  row: ScorecardRow;
  className?: string;
}

// A scorecard row's headline facts as a labelled list. The rating cards and
// the compare columns both use it, so the two always show a row the same way.
//   case rows: the rating and the confidence
//   the safeguard row: the same under tab 9's own header, "Safeguards
//     adequate?" (it is a different scale)
//   risk rows: severity, likelihood and confidence, which the workbook keeps
//     apart, or only "Not applicable" when tab 9 says so
export function RatingFacts({ row, className }: RatingFactsProps) {
  const wrapperClassName = className ? `${styles.facts} ${className}` : styles.facts;
  return <div className={wrapperClassName}>{cardKind(row) === "risk" ? <RiskFacts row={row} /> : <CaseFacts row={row} />}</div>;
}

function CaseFacts({ row }: { row: ScorecardRow }) {
  const safeguard = cardKind(row) === "safeguard";
  return (
    <dl className={styles.list}>
      <div>
        <dt className={styles.label}>{safeguard ? "Safeguards adequate?" : "Current rating"}</dt>
        <dd className={styles.value}>
          <RatingChip scale={row.scale} rating={row.rating} unclearReason={row.unclear_reason} />
        </dd>
      </div>
      <div>
        <dt className={styles.label}>Confidence</dt>
        <dd className={styles.value}>
          <ConfidenceMeter confidence={row.confidence} />
        </dd>
      </div>
    </dl>
  );
}

// "Severity" and "Likelihood" are the workbook's own headers. A value the
// workbook hasn't given is left out rather than guessed. When tab 9 says
// "Not applicable" (BCI's artificial-mind row) that is all the card shows:
// the row's stored confidence is left out on purpose (port-design.md).
function RiskFacts({ row }: { row: ScorecardRow }) {
  if (row.applicable === false) {
    return (
      <p className={styles.notApplicable}>
        <NeutralChip label="Not applicable" />
      </p>
    );
  }
  return (
    <dl className={`${styles.list} ${styles.listRisk}`}>
      {row.severity && (
        <div>
          <dt className={styles.label}>Severity</dt>
          <dd className={styles.value}>
            <NeutralChip label={enumLabel("Severity", row.severity)} />
          </dd>
        </div>
      )}
      {row.likelihood && (
        <div>
          <dt className={styles.label}>Likelihood</dt>
          <dd className={styles.value}>
            <NeutralChip label={enumLabel("Likelihood", row.likelihood)} />
          </dd>
        </div>
      )}
      <div>
        <dt className={styles.label}>Confidence</dt>
        <dd className={styles.value}>
          <ConfidenceMeter confidence={row.confidence} />
        </dd>
      </div>
    </dl>
  );
}
