import Link from "next/link";

import { Term, TextWithTerm } from "@/components/glossary/Term";
import { compareHref, scorecardRowId } from "@/lib/dimensions";
import { enumLabel } from "@/lib/enums";
import type { ScorecardRow } from "@/lib/types";

import { RatingChip } from "./RatingChip";
import { capitalize, countWord, stillNeedsClauses, unclearReasonSentence } from "./text";
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
  // The technology's id ("bci"), for the link to its sources.
  technologyId: string;
  // How many real sources (no samples) are tagged with this technology.
  sourceCount: number;
}

// The hero box: the six scorecard ratings one line each, each with a link
// down to its rating card, then one line about the milestones, one about the
// sources and one to the comparison. It restates the scorecard and adds no
// judgment of its own.
export function WhereWeLand({ rows, milestones, technologyId, sourceCount }: WhereWeLandProps) {
  const summary = ratingsSummary(rows);
  const shared = sharedConfidence(rows);
  // The Not claimed tooltip goes on the first such chip only, so its id stays unique.
  const notClaimedTermIndex = rows.findIndex((row) => row.rating === "not_claimed");
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
      {(summary || shared) && (
        <div className={styles.lead}>
          {summary && <p className={styles.summary}>{summary}</p>}
          {shared && <p className={styles.sharedMeta}>{shared}</p>}
        </div>
      )}

      <ul className={styles.rows}>
        {rows.map((row, index) => {
          const meta = ratingMeta(row, shared !== null);
          const chip = <RatingChip scale={row.scale} rating={row.rating} />;
          return (
            <li key={row.id} className={`${styles.row} ${meta ? "" : styles.rowNoMeta}`}>
              <span className={styles.dimension}>
                <DimensionName dimension={row.dimension} />
              </span>
              <span className={styles.rating}>
                {index === notClaimedTermIndex ? (
                  <Term name="not-claimed" align="end">
                    {chip}
                  </Term>
                ) : (
                  chip
                )}
              </span>
              {/* Down to this rating's card in the collapsed full scorecard,
                  which OpenDetailsOnHash opens. A sibling of the Terms, so
                  nothing interactive is nested. */}
              <a href={`#${scorecardRowId(row.id)}`} className={styles.rowLink}>
                <span className={styles.rowArrow} aria-hidden="true">
                  &darr;
                </span>
                <span className="visually-hidden">{row.dimension} in the full scorecard</span>
              </a>
              {meta && <span className={styles.meta}>{meta}</span>}
            </li>
          );
        })}
      </ul>

      <div className={styles.footer}>
        <MilestoneLine milestones={milestones} />
        <SourcesLine technologyId={technologyId} count={sourceCount} />
        <p className={`${styles.footerLine} ${styles.compareLine}`}>
          <Link href={compareHref(null)} className={styles.footerLink}>
            Compare side by side
            <span aria-hidden="true"> &rarr;</span>
          </Link>
        </p>
      </div>
    </section>
  );
}

// The dimension's name, with its glossary term explained on hover or focus:
// "Intelligence Curse" in "Intelligence Curse case", "Alignment" in
// "Alignment case". Other names show as they are.
function DimensionName({ dimension }: { dimension: string }) {
  if (dimension.includes("Intelligence Curse")) {
    return <TextWithTerm text={dimension} phrase="Intelligence Curse" name="intelligence-curse" />;
  }
  return <TextWithTerm text={dimension} phrase="Alignment" name="alignment" />;
}

// "Low confidence in all six." ("in both" for two rows) when every row has the
// same confidence, so the rows don't each repeat it. null when the rows differ
// (each row then says its own) or there is only one row.
function sharedConfidence(rows: ScorecardRow[]): string | null {
  if (rows.length < 2) {
    return null;
  }
  const first = rows[0].confidence;
  for (const row of rows) {
    if (row.confidence !== first) {
      return null;
    }
  }
  const scope = rows.length === 2 ? "both" : `all ${countWord(rows.length)}`;
  return `${enumLabel("Confidence", first)} confidence in ${scope}.`;
}

// The small line under a row. With a shared confidence, only an Unclear
// risk's severity is left ("Potentially high severity"), or nothing.
// Otherwise: "Low confidence · potentially high severity".
function ratingMeta(row: ScorecardRow, confidenceShared: boolean): string | null {
  let severity: string | null = null;
  if (row.scale === "risk" && row.rating === "unclear" && row.potential_severity) {
    severity = `potentially ${enumLabel("RiskRating", row.potential_severity).toLowerCase()} severity`;
  }
  if (confidenceShared) {
    return severity ? capitalize(severity) : null;
  }
  const confidence = `${enumLabel("Confidence", row.confidence)} confidence`;
  return severity ? `${confidence} · ${severity}` : confidence;
}

// "All six ratings are Unclear for now. For four of them, the reason is that
// the proposal isn't specific enough to assess." Nothing when none are Unclear.
// When every rating is held back by a gap the team has found, say what's
// missing rather than "All six ratings are Unclear".
function ratingsSummary(rows: ScorecardRow[]): string | null {
  const stillNeeds = stillNeedsClauses(rows);
  if (stillNeeds !== null) {
    return `Each rating names what's missing. ${capitalize(stillNeeds)}.`;
  }
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
    if (rows.length === 1) {
      return "The one rating is Unclear for now.";
    }
    if (rows.length === 2) {
      return "Both ratings are Unclear for now.";
    }
    return `All ${countWord(rows.length)} ratings are Unclear for now.`;
  }
  return `${capitalize(countWord(unclear))} of the ${countWord(rows.length)} ratings are Unclear for now.`;
}

function MilestoneLine({ milestones }: { milestones: MilestoneFacts }) {
  const { count, dated, firstId } = milestones;
  if (count === 0 || !firstId) {
    return <p className={styles.footerLine}>No milestones mapped yet</p>;
  }
  const noun = count === 1 ? "milestone" : "milestones";
  let datedText = `${dated} dated`;
  if (dated === 0) {
    datedText = "none dated yet";
  } else if (dated === count) {
    datedText = count === 1 ? "dated" : "all dated";
  }
  return (
    <p className={styles.footerLine}>
      {/* The whole timeline, not one milestone's dossier: the line is about all of them. */}
      <Link href="/timeline/" className={styles.footerLink}>
        {count} {noun} on the timeline, {datedText}
        <span aria-hidden="true"> &rarr;</span>
      </Link>
    </p>
  );
}

// "18 sources collected so far", linking to the source database filtered to
// this technology. "Collected", not "read": none of them is rated yet.
function SourcesLine({ technologyId, count }: { technologyId: string; count: number }) {
  if (count === 0) {
    return null;
  }
  const noun = count === 1 ? "source" : "sources";
  return (
    <p className={styles.footerLine}>
      <Link href={`/sources/?technology=${technologyId}`} className={styles.footerLink}>
        {count} {noun} collected so far
        <span aria-hidden="true"> &rarr;</span>
      </Link>
    </p>
  );
}
