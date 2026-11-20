import Link from "next/link";

import { Term, TextWithTerm } from "@/components/glossary/Term";
import { compareHref, scorecardRowId } from "@/lib/dimensions";
import type { ScorecardRow } from "@/lib/types";

import { RatingChip } from "./RatingChip";
import { MetaParts } from "./sections/MetaParts";
import { countNoun, rowMetaParts, sharedConfidence } from "./text";
import styles from "./WhereWeLand.module.css";

interface WhereWeLandProps {
  rows: ScorecardRow[];
  // The technology's id ("bci"), for the links to its sources and entries.
  technologyId: string;
  // How many real sources (no samples) are tagged with this technology.
  sourceCount: number;
  // How many milestones the family's tab 1a rows assess (a split one counts once).
  milestoneCount: number;
  // How many evidence-register entries the /evidence/ family filter finds.
  entryCount: number;
}

// The hero box: the six scorecard rows one line each, each with a link down
// to its rating card, then one line each for the milestones, the evidence,
// the sources and the comparison. A case row shows its rating chip; a risk
// row shows no chip but a line under it with its severity and likelihood
// (the workbook never gives a risk one rating). A confidence every row
// shares is said once, above the rows. It restates the scorecard and adds no
// judgment of its own.
export function WhereWeLand({ rows, technologyId, sourceCount, milestoneCount, entryCount }: WhereWeLandProps) {
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
      {shared && <p className={styles.sharedMeta}>{shared}</p>}

      <ul className={styles.rows}>
        {rows.map((row, index) => {
          const meta = rowMetaParts(row, shared !== null);
          const chip = row.rating ? <RatingChip scale={row.scale} rating={row.rating} /> : null;
          return (
            <li key={row.id} className={`${styles.row} ${meta.length > 0 ? "" : styles.rowNoMeta}`}>
              <span className={styles.dimension}>
                <DimensionName dimension={row.dimension} />
              </span>
              {chip && (
                <span className={styles.rating}>
                  {index === notClaimedTermIndex ? (
                    <Term name="not-claimed" align="end">
                      {chip}
                    </Term>
                  ) : (
                    chip
                  )}
                </span>
              )}
              {/* Down to this rating's card in the collapsed full scorecard,
                  which OpenDetailsOnHash opens. A sibling of the Terms, so
                  nothing interactive is nested. */}
              <a href={`#${scorecardRowId(row.id)}`} className={styles.rowLink}>
                <span className={styles.rowArrow} aria-hidden="true">
                  &darr;
                </span>
                <span className="visually-hidden">{row.dimension} in the full scorecard</span>
              </a>
              {meta.length > 0 && <MetaParts parts={meta} className={styles.meta} />}
            </li>
          );
        })}
      </ul>

      <div className={styles.footer}>
        {milestoneCount > 0 && (
          <p className={styles.footerLine}>
            <a href="#milestones" className={styles.footerLink}>
              {countNoun(milestoneCount, "milestone", "milestones")} assessed
              <span aria-hidden="true"> &darr;</span>
            </a>
          </p>
        )}
        {entryCount > 0 && (
          <p className={styles.footerLine}>
            <Link href={`/evidence/?family=${technologyId}`} className={styles.footerLink}>
              {countNoun(entryCount, "evidence entry", "evidence entries")}
              <span aria-hidden="true"> &rarr;</span>
            </Link>
          </p>
        )}
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
