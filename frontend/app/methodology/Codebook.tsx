// The methodology's Definitions section (id "codebook"): the workbook's
// purpose, core principles, the Scope tab's notes on its time horizons, every
// Codebook row in sheet order, and the reference frameworks. Every cell is
// Vilija's text, with its codes linked (CodeText: "S28" to the source, "WBE-O"
// to its pathway). The headings are the workbook's own ("Purpose", "Core
// principles" and so on); a row whose code is a lone "-" shows no code.
import { CodeText } from "@/components/common/CodeText";
import { ExternalLink } from "@/components/common/ExternalLink";
import type { CodeIndex } from "@/lib/codes";
import type { Framework, Overview } from "@/lib/types";

import { scopeNotesWithoutKeyQuestion, shownCode, type CodebookRun } from "./codebookModel";
import styles from "./Codebook.module.css";

// The Overview tab's items keep their leading "1. ", so they are paragraphs,
// not an <ol> that would number them a second time.
function NumberedLines({ lines, index }: { lines: string[]; index: CodeIndex }) {
  return (
    <div className={styles.lines}>
      {lines.map((line, position) => (
        <p key={position} className={styles.line}>
          <CodeText text={line} index={index} />
        </p>
      ))}
    </div>
  );
}

export function OverviewItems({
  overview,
  scopeNotes,
  index,
}: {
  overview: Overview | null;
  scopeNotes: string[];
  index: CodeIndex;
}) {
  const notes = scopeNotesWithoutKeyQuestion(scopeNotes);
  return (
    <div className={styles.overview}>
      {overview && overview.purpose !== "" && (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Purpose</h3>
          <p className={styles.purpose}>
            <CodeText text={overview.purpose} index={index} />
          </p>
        </div>
      )}
      {overview && (overview.principles ?? []).length > 0 && (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Core principles</h3>
          <NumberedLines lines={overview.principles ?? []} index={index} />
        </div>
      )}
      {/* The Scope tab's first rows: its title and the provisional
          time-horizon bands the Time horizon cells rely on. Its key question
          is left out, as it repeats the Purpose above. */}
      {notes.length > 0 && (
        <div className={`${styles.block} ${styles.scope}`}>
          {notes.map((note, position) => (
            <p key={position} className={styles.scopeLine}>
              <CodeText text={note} index={index} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// One fold per run of rows that share a Type, in sheet order, named by the
// run's title ("Scenario", then "Scenario · BCI-X"). A fold whose rows
// all share a Family names it once at the top; otherwise each row shows
// its own, with the Codebook's "Family" header read out before it.
export function CodebookFolds({
  runs,
  frameworks,
  index,
}: {
  runs: CodebookRun[];
  frameworks: Framework[];
  index: CodeIndex;
}) {
  return (
    <div className={styles.folds}>
      {runs.map((run) => (
        // suppressHydrationWarning: a link to the fold opens it before React
        // starts (see More in page.tsx).
        <details key={run.id} id={run.id} className={styles.fold} suppressHydrationWarning>
          <summary className={styles.summary}>
            <span className={styles.foldTitle}>{run.title}</span>
            <span className={styles.chevron} aria-hidden="true" />
          </summary>
          {run.family !== null && (
            <p className={styles.runFamily}>
              Family: <span className={styles.runFamilyValue}>{run.family}</span>
            </p>
          )}
          <dl className={styles.rows}>
            {run.rows.map((row, position) => (
              // A rule row with no code and no family of its own to show has
              // nothing in its <dt>, so its definition takes the full width.
              <div
                key={position}
                className={
                  shownCode(row.code) === "" && run.family !== null ? `${styles.row} ${styles.rowNoCode}` : styles.row
                }
              >
                <dt className={styles.code}>
                  {shownCode(row.code) !== "" && (
                    <span>
                      <CodeText text={shownCode(row.code)} index={index} />
                    </span>
                  )}
                  {run.family === null && (
                    <span className={styles.family}>
                      <span className="visually-hidden">Family: </span>
                      {row.family}
                    </span>
                  )}
                </dt>
                <dd className={styles.definition}>
                  <CodeText text={row.definition} index={index} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
      {frameworks.length > 0 && (
        <details id="reference-frameworks" className={styles.fold} suppressHydrationWarning>
          <summary className={styles.summary}>
            <span className={styles.foldTitle}>Reference frameworks</span>
            <span className={styles.chevron} aria-hidden="true" />
          </summary>
          <ul className={styles.frameworks}>
            {frameworks.map((framework) => (
              <li key={framework.id} className={styles.framework}>
                <p className={styles.frameworkHead}>
                  <span className={styles.frameworkId}>{framework.id}</span>
                  {framework.url ? (
                    <ExternalLink href={framework.url} className={styles.frameworkLink}>
                      {framework.reference}
                    </ExternalLink>
                  ) : (
                    <span className={styles.frameworkLink}>{framework.reference}</span>
                  )}
                </p>
                <dl className={styles.frameworkFacts}>
                  <div>
                    <dt>What it contributes</dt>
                    <dd>
                      <CodeText text={framework.contributes} index={index} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
