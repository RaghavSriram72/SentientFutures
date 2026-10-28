import Link from "next/link";

import { TextWithTerm } from "@/components/glossary/Term";
import { enumLabel } from "@/lib/enums";
import type { ScorecardRow } from "@/lib/types";

import { RatingChip } from "./Scorecard";
import { capitalize, countWord, unclearReasonSentence } from "./text";
import styles from "./WhereWeLand.module.css";

// What the hero box needs to know about this technology's real milestones.
export interface MilestoneFacts {
  count: number;
  dated: number; // achieved, estimated by the team, or forecast
  firstId: string | null;
}

interface WhereWeLandProps {
  rows: ScorecardRow[];
  milestones: MilestoneFacts;
}

// The hero box: the six scorecard ratings one line each, then one line about
// the milestones. It restates the scorecard and adds no judgment of its own.
export function WhereWeLand({ rows, milestones }: WhereWeLandProps) {
  const summary = ratingsSummary(rows);
  return (
    <section className={styles.box} aria-labelledby="where-we-land-title">
      <div className={styles.head}>
        <h2 id="where-we-land-title" className={styles.title}>
          Where we land
        </h2>
        <a href="#scorecard" className={styles.headLink}>
          Full scorecard <span aria-hidden="true">&darr;</span>
        </a>
      </div>
      {summary && <p className={styles.summary}>{summary}</p>}

      <ul className={styles.rows}>
        {rows.map((row) => (
          <li key={row.dimension} className={styles.row}>
            <span className={styles.dimension}>
              <TextWithTerm text={row.dimension} phrase="Intelligence Curse" name="intelligence-curse" />
            </span>
            <span className={styles.rating}>
              <RatingChip scale={row.scale} rating={row.rating} />
            </span>
            <span className={styles.meta}>{ratingMeta(row)}</span>
          </li>
        ))}
      </ul>

      <MilestoneLine milestones={milestones} />
    </section>
  );
}

// "Low confidence · potentially high severity"
function ratingMeta(row: ScorecardRow): string {
  let text = `${enumLabel("Confidence", row.confidence)} confidence`;
  if (row.scale === "risk" && row.rating === "unclear" && row.potential_severity) {
    text += ` · potentially ${enumLabel("RiskRating", row.potential_severity).toLowerCase()} severity`;
  }
  return text;
}

// "All six ratings are Unclear for now. For four of them, the reason is that
// the proposal isn't specific enough to assess." Nothing when none are Unclear.
function ratingsSummary(rows: ScorecardRow[]): string | null {
  const count = unclearCount(rows);
  if (count === null) {
    return null;
  }
  const reason = unclearReasonSentence(rows);
  return reason === "" ? count : `${count} ${reason}`;
}

function unclearCount(rows: ScorecardRow[]): string | null {
  let unclear = 0;
  for (const row of rows) {
    if (row.rating === "unclear") {
      unclear += 1;
    }
  }
  if (unclear === 0) {
    return null;
  }
  if (unclear === rows.length) {
    return rows.length === 1 ? "The one rating is Unclear for now." : `All ${countWord(rows.length)} ratings are Unclear for now.`;
  }
  return `${capitalize(countWord(unclear))} of the ${countWord(rows.length)} ratings are Unclear for now.`;
}

function MilestoneLine({ milestones }: { milestones: MilestoneFacts }) {
  const { count, dated, firstId } = milestones;
  if (count === 0 || !firstId) {
    return <p className={styles.milestones}>No milestones mapped yet</p>;
  }
  const noun = count === 1 ? "milestone" : "milestones";
  let datedText = `${dated} dated`;
  if (dated === 0) {
    datedText = "none dated yet";
  } else if (dated === count) {
    datedText = count === 1 ? "dated" : "all dated";
  }
  return (
    <p className={styles.milestones}>
      {/* The whole timeline, not one milestone's dossier: the line is about all of them. */}
      <Link href="/timeline/" className={styles.milestonesLink}>
        {count} {noun} on the timeline, {datedText}
        <span aria-hidden="true"> &rarr;</span>
      </Link>
    </p>
  );
}
