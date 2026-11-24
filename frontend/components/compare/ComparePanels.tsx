import Link from "next/link";
import type { ReactNode } from "react";

import { CodeText } from "@/components/common/CodeText";
import { ARTIFICIAL_MINDS_DEFINITION } from "@/components/common/keyTerms";
import { TypeGlyph } from "@/components/common/TypeMark";
import { ConfidenceMeter, NeutralChip } from "@/components/technology/RatingChip";
import { RatingFacts } from "@/components/technology/RatingFacts";
import { WorkbookClaim } from "@/components/technology/sections/WorkbookClaim";
import { lowerFirst } from "@/components/technology/text";
import type { TimelineGroup, TimelineItem } from "@/components/timeline/timelineModel";
import { milestoneHref, riskHref, type CodeIndex } from "@/lib/codes";
import { scorecardHref } from "@/lib/dimensions";
import { enumLabel } from "@/lib/enums";
import { withBase } from "@/lib/paths";
import type { SourceRef } from "@/lib/sources";
import type { MilestoneCategory, Provenance, Risk, ScorecardData, TechnologyPage } from "@/lib/types";
import type { MilestoneRow } from "@/lib/workbook";

import {
  categoryCells,
  categoryInfo,
  columnTitleId,
  domainRisks,
  milestoneRowCode,
  mindsCells,
  panelTitleId,
  scorecardCells,
  type CategoryQuestion,
  type CompareDimension,
  type MindsFacet,
} from "./compareModel";
import styles from "./Compare.module.css";

// The compare page's panels, one per dimension. Server components: every
// panel is rendered at build time, and CompareView only shows one of them.
// They show the team's published work only: ratings, bases, the workbook's
// minds statements and milestone rows. Never a rating card's tracker fields
// (so a placeholder tracker can't appear here unmarked) and never the
// AI-drafted outline sections, so every column is the team's.

type Sources = Record<string, SourceRef>;

// Everything here is the team's, so a team claim shows only its glyph. An AI
// claim, if one ever reached a panel, would still keep its full mark.
const QUIET: Provenance = "team";

interface ComparePanelProps {
  dimension: CompareDimension;
  technologies: TechnologyPage[];
  // From buildTimeline(getPublicMilestones(), nowYear), so codes match the timeline.
  groups: TimelineGroup[];
  sources: Sources;
  // The workbook's shared tables (risks, milestone rows) and what its codes link to.
  scorecard: ScorecardData;
  codeIndex: CodeIndex;
}

// compareDimensions gives every scorecard dimension a rowId and every category
// dimension a category, so the errors below only fire if that changes.
export function ComparePanel({ dimension, technologies, groups, sources, scorecard, codeIndex }: ComparePanelProps) {
  if (dimension.kind === "scorecard") {
    if (!dimension.rowId) {
      throw new Error(`The compare dimension "${dimension.key}" is a scorecard row but has no rowId.`);
    }
    return (
      <ScorecardPanel
        dimension={dimension}
        rowId={dimension.rowId}
        technologies={technologies}
        sources={sources}
        scorecard={scorecard}
        codeIndex={codeIndex}
      />
    );
  }
  if (dimension.kind === "category") {
    if (!dimension.category) {
      throw new Error(`The compare dimension "${dimension.key}" is a milestone category but has no category.`);
    }
    return (
      <CategoryPanel
        dimension={dimension}
        category={dimension.category}
        technologies={technologies}
        groups={groups}
        scorecard={scorecard}
        codeIndex={codeIndex}
      />
    );
  }
  return <MindsPanel dimension={dimension} technologies={technologies} codeIndex={codeIndex} />;
}

// "01", "02", "03": the technology's place in technologies.json, as on its page.
function technologyNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

// ---------- Panels ----------

// Case rows: the rating, the confidence and the basis. Risk rows: severity,
// likelihood and confidence (the workbook never combines them into one
// rating), then the tab 7 risks behind the row in a fold.
function ScorecardPanel({
  dimension,
  rowId,
  technologies,
  sources,
  scorecard,
  codeIndex,
}: {
  dimension: CompareDimension;
  rowId: string;
  technologies: TechnologyPage[];
  sources: Sources;
  scorecard: ScorecardData;
  codeIndex: CodeIndex;
}) {
  const cells = scorecardCells(technologies, rowId);
  return (
    <section className={styles.panel} aria-labelledby={panelTitleId(dimension.key)}>
      <PanelHead dimension={dimension} eyebrow={dimension.group} rubricLink />
      <div className={`${styles.columns} ${styles.scorecardColumns}`}>
        {cells.map(({ technology, row }, index) => (
          <TechnologyColumn key={technology.id} dimensionKey={dimension.key} technology={technology} index={index}>
            <div className={styles.facet}>
              {/* Case rows: the rating and confidence. Risk rows: severity,
                  likelihood and confidence, or only "Not applicable". The
                  same facts as on the rating card. */}
              <RatingFacts row={row} className={styles.ratingFacts} />
            </div>
            {/* Always one element here, so on desktop the foot links stay
                on the same grid row in all three columns. */}
            {row.scale === "risk" ? (
              <RiskList
                risks={domainRisks(scorecard, technology, row)}
                technology={technology}
                codeIndex={codeIndex}
              />
            ) : row.basis ? (
              <dl className={styles.facet}>
                <div className={styles.sheetRow}>
                  <dt className={styles.label}>Why</dt>
                  <dd>
                    {/* Tab 4's words exactly: a source id links bare, with
                        its citation in the link's title, as on the
                        technology page. */}
                    <WorkbookClaim
                      claim={row.basis}
                      index={codeIndex}
                      family={technology.id}
                      sources={sources}
                      variant="compact"
                      quiet={QUIET}
                    />
                  </dd>
                </div>
              </dl>
            ) : (
              <div />
            )}
            <p className={styles.columnFoot}>
              {/* A plain <a>, not next/link: the browser loads the page
                  itself, so the card becomes the page's :target and shows
                  the grape bar that says "you are here". next/link moves
                  with pushState, which never sets :target. withBase adds
                  the base path that next/link would have added. */}
              <a href={withBase(scorecardHref(technology.id, row.id))} className={styles.footLink}>
                Open the rating card
                <span className="visually-hidden"> for {lowerFirst(technology.name)}</span>
              </a>
            </p>
          </TechnologyColumn>
        ))}
      </div>
    </section>
  );
}

// The minds risk row first, then the workbook's tab 4.1 statements, one card
// per facet that has any, each statement under its stage. The facets with
// nothing are named once in one line. A page whose minds row is Not
// applicable (BCI) says so once and shows no facets. The foot links follow
// the column's order: the rating card for the rating at the top, then the
// page's section for the statements.
function MindsPanel({
  dimension,
  technologies,
  codeIndex,
}: {
  dimension: CompareDimension;
  technologies: TechnologyPage[];
  codeIndex: CodeIndex;
}) {
  const cells = mindsCells(technologies);
  return (
    <section className={styles.panel} aria-labelledby={panelTitleId(dimension.key)}>
      <PanelHead dimension={dimension} eyebrow={null} description={ARTIFICIAL_MINDS_DEFINITION} />
      <div className={`${styles.columns} ${styles.mindsColumns}`}>
        {cells.map(({ technology, row, facets, emptyFacets }, index) => (
          <TechnologyColumn key={technology.id} dimensionKey={dimension.key} technology={technology} index={index}>
            {/* Every page has this row (the validator checks). The row's
                name comes from the data (row.dimension), so it always
                matches the rating card's heading. */}
            <div className={styles.facet}>
              {row && (
                <>
                  <p className={styles.ratingName}>{row.dimension}</p>
                  <RatingFacts row={row} className={styles.ratingFacts} />
                </>
              )}
            </div>
            <div className={styles.mindsBody}>
              {facets.length > 0 && (
                <dl className={styles.mindsFacets}>
                  {facets.map((facet) => (
                    <MindsFacetCard key={facet.key} facet={facet} technology={technology} codeIndex={codeIndex} />
                  ))}
                </dl>
              )}
              {emptyFacets.length > 0 && (
                // Semicolons, because one label has a comma in it.
                <p className={`${styles.facet} ${styles.empty}`}>Not assessed yet: {emptyFacets.join("; ")}.</p>
              )}
            </div>
            {/* Two links, one per line on screen, so they read as a pair
                and never wrap differently from one column to the next.
                On paper they share a line (see the print styles). */}
            <div className={`${styles.columnFoot} ${styles.footLinks}`}>
              {row && (
                <p>
                  {/* A plain <a>, as in the scorecard panels, so the card
                      becomes the page's :target and shows its grape bar. */}
                  <a href={withBase(scorecardHref(technology.id, row.id))} className={styles.footLink}>
                    Open the rating card
                    <span className="visually-hidden"> for {lowerFirst(technology.name)}</span>
                  </a>
                </p>
              )}
              <p>
                <Link href={`/${technology.id}/#minds`} className={styles.footLink}>
                  Read the section
                  <span className="visually-hidden"> on {lowerFirst(technology.name)}</span>
                </Link>
              </p>
            </div>
          </TechnologyColumn>
        ))}
      </div>
    </section>
  );
}

// One facet: its label (the tab 4.1 header, reworded as on the technology
// page), then each stage's cell under the stage's name. The stage code (S3)
// sits in the title, as the name drops its number.
function MindsFacetCard({
  facet,
  technology,
  codeIndex,
}: {
  facet: MindsFacet;
  technology: TechnologyPage;
  codeIndex: CodeIndex;
}) {
  return (
    <div className={`${styles.facet} ${styles.sheetRow}`}>
      <dt className={styles.label}>{facet.label}</dt>
      <dd>
        <ul className={styles.statements}>
          {facet.statements.map((statement) => (
            <li key={`${statement.stage ?? ""} ${statement.stageName}`}>
              <p className={styles.stageName} title={statement.stage ?? undefined}>
                {statement.stageName}
              </p>
              <p className={styles.statementText}>
                <CodeText text={statement.text} index={codeIndex} family={technology.id} />
              </p>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

// Each family's tab 1a rows in one category. The eyebrow is the site's
// category label only, not the workbook's M code. The category's question is
// the panel's description, with its "Counts as evidence" and "Does not count"
// parts in a fold. A WBE column also links to the timeline milestone filed
// under the same category.
function CategoryPanel({
  dimension,
  category,
  technologies,
  groups,
  scorecard,
  codeIndex,
}: {
  dimension: CompareDimension;
  category: MilestoneCategory;
  technologies: TechnologyPage[];
  groups: TimelineGroup[];
  scorecard: ScorecardData;
  codeIndex: CodeIndex;
}) {
  const cells = categoryCells(technologies, scorecard, groups, category);
  const info = categoryInfo(scorecard, category);
  const eyebrow = (
    <>
      {dimension.type && <TypeGlyph type={dimension.type.value} className={styles.eyebrowGlyph} />}
      <span>{dimension.group}</span>
    </>
  );
  return (
    <section className={styles.panel} aria-labelledby={panelTitleId(dimension.key)}>
      <PanelHead
        dimension={dimension}
        eyebrow={eyebrow}
        description={info.question?.question}
        extra={info.question && <EvidenceRule question={info.question} />}
      />
      <div className={`${styles.columns} ${styles.categoryColumns}`}>
        {cells.map(({ technology, rows, timelineItems }, index) => (
          <TechnologyColumn key={technology.id} dimensionKey={dimension.key} technology={technology} index={index}>
            {rows.length > 0 ? (
              <ul className={`${styles.facet} ${styles.assessments}`}>
                {rows.map((row) => (
                  <AssessmentRow key={milestoneRowCode(row) + (row.part ?? "")} row={row} technology={technology} codeIndex={codeIndex} />
                ))}
              </ul>
            ) : (
              <p className={`${styles.facet} ${styles.empty}`}>Not assessed yet.</p>
            )}
            {timelineItems.length > 0 && <TimelineLinks items={timelineItems} />}
          </TechnologyColumn>
        ))}
      </div>
    </section>
  );
}

// The question's "Counts as evidence: ..." and "Does not count: ..." parts,
// word for word, folded under the panel's description.
function EvidenceRule({ question }: { question: CategoryQuestion }) {
  if (question.countsAsEvidence === null && question.doesNotCount === null) {
    return null;
  }
  return (
    <details className={`${styles.fold} ${styles.evidenceRule}`}>
      <summary className={styles.foldSummary}>
        What counts as evidence
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.evidenceRuleBody}>
        {question.countsAsEvidence && <p>{question.countsAsEvidence}</p>}
        {question.doesNotCount && <p>{question.doesNotCount}</p>}
      </div>
    </details>
  );
}

// One tab 1a row: its code (a link to the row on the technology page), then
// the tab's own headers and cells word for word. The success criterion is
// folded, as "Criterion met?" is the short answer to it. The main
// bottleneck comes last, in tab 1a's column order.
function AssessmentRow({
  row,
  technology,
  codeIndex,
}: {
  row: MilestoneRow;
  technology: TechnologyPage;
  codeIndex: CodeIndex;
}) {
  const { assessment } = row;
  return (
    <li className={styles.assessment}>
      <p className={styles.assessmentHead}>
        <Link
          href={milestoneHref(assessment.family, assessment.milestone, row.part)}
          className={styles.assessmentCode}
        >
          {milestoneRowCode(row)}
          <span aria-hidden="true"> &rarr;</span>
        </Link>
      </p>
      <dl className={styles.spec}>
        <div className={styles.specRow}>
          <dt className={styles.label}>Applies to</dt>
          <dd>
            <CodeText text={assessment.applies_to} index={codeIndex} family={technology.id} />
          </dd>
        </div>
        <div className={styles.specRow}>
          <dt className={styles.label}>Status</dt>
          <dd>
            <NeutralChip label={enumLabel("MilestoneStatus", assessment.status)} />
          </dd>
        </div>
        <div className={styles.specRow}>
          <dt className={styles.label}>Criterion met?</dt>
          <dd>
            <CodeText text={assessment.criterion_met} index={codeIndex} family={technology.id} />
          </dd>
        </div>
        <div className={styles.specRow}>
          <dt className={styles.label}>Confidence</dt>
          <dd>
            <ConfidenceMeter confidence={assessment.confidence} />
          </dd>
        </div>
      </dl>
      <details className={`${styles.fold} ${styles.criterion}`}>
        <summary className={styles.foldSummary}>
          Success criterion
          <span className={styles.chevron} aria-hidden="true" />
        </summary>
        <p className={styles.criterionText}>
          <CodeText text={assessment.success_criterion} index={codeIndex} family={technology.id} />
        </p>
      </details>
      {/* After the criterion, as in tab 1a and on the technology page: a
          bottleneck can use the criterion's own codes (WBE's P1 to P5). */}
      {assessment.bottleneck && (
        <dl className={styles.spec}>
          <div className={styles.specBlock}>
            <dt className={styles.label}>Main bottleneck</dt>
            <dd>
              <CodeText text={assessment.bottleneck} index={codeIndex} family={technology.id} />
            </dd>
          </div>
        </dl>
      )}
    </li>
  );
}

// "On the timeline: WBE-02", one line per timeline milestone in the category.
function TimelineLinks({ items }: { items: TimelineItem[] }) {
  return (
    <div className={`${styles.columnFoot} ${styles.footLinks}`}>
      {items.map((item) => (
        <p key={item.milestone.id}>
          <Link href={`/timeline/#${item.milestone.id}`} className={styles.footLink}>
            On the timeline: {item.code}
            <span aria-hidden="true"> &rarr;</span>
          </Link>
        </p>
      ))}
    </div>
  );
}

// ---------- Building blocks ----------

// The tab 7 risks behind a risk row, folded: each one's id (a link to it on
// the technology page) and its text. An empty element when there are none,
// so the columns' rows still line up.
function RiskList({ risks, technology, codeIndex }: { risks: Risk[]; technology: TechnologyPage; codeIndex: CodeIndex }) {
  if (risks.length === 0) {
    return <div />;
  }
  return (
    <details className={`${styles.facet} ${styles.fold} ${styles.risks}`}>
      <summary className={styles.foldSummary}>
        Risks ({risks.length})
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <ul className={styles.riskList}>
        {risks.map((risk) => (
          <li key={risk.id}>
            <Link href={riskHref(risk.id, technology.id)} className={styles.riskCode}>
              {risk.id}
            </Link>{" "}
            <CodeText text={risk.risk} index={codeIndex} family={technology.id} />
          </li>
        ))}
      </ul>
    </details>
  );
}

// The dimension's name and what it means, over the three columns. Scorecard
// panels also link to how the ratings are made.
function PanelHead({
  dimension,
  eyebrow,
  description,
  rubricLink = false,
  extra,
}: {
  dimension: CompareDimension;
  eyebrow: ReactNode;
  description?: string;
  // True on the scorecard panels: a "How we rate" link beside the eyebrow.
  rubricLink?: boolean;
  // Under the description, such as a category's evidence rule.
  extra?: ReactNode;
}) {
  return (
    <header className={styles.panelHead}>
      {(eyebrow || rubricLink) && (
        <div className={styles.panelTop}>
          {eyebrow && <p className={`eyebrow ${styles.panelEyebrow}`}>{eyebrow}</p>}
          {rubricLink && (
            <p className={styles.rubric}>
              <Link href="/methodology/#ratings" className={styles.footLink}>
                How we rate<span aria-hidden="true"> &rarr;</span>
              </Link>
            </p>
          )}
        </div>
      )}
      {/* tabIndex -1: the Next card moves focus here after showing the panel. */}
      <h2 id={panelTitleId(dimension.key)} tabIndex={-1} className={styles.panelTitle}>
        {dimension.label}
      </h2>
      {description && <p className={styles.panelDescription}>{description}</p>}
      {extra}
    </header>
  );
}

// One technology's column: a head like the home page's proposal cards (the
// number, the review status, then the name), then the facets. Every column
// shows the team's work only, so every column carries the team chip. On
// desktop the head's three lines are rows of the panel's grid, so the names
// line up even when one eyebrow wraps.
function TechnologyColumn({
  dimensionKey,
  technology,
  index,
  children,
}: {
  dimensionKey: string;
  technology: TechnologyPage;
  index: number;
  children: ReactNode;
}) {
  const titleId = columnTitleId(dimensionKey, technology.id);
  return (
    <article className={`paper ${styles.column}`} aria-labelledby={titleId}>
      <header className={styles.columnHead}>
        <p className={`eyebrow ${styles.columnEyebrow}`}>
          Technology {technologyNumber(index)} · {technology.short_name}
        </p>
        <h3 id={titleId} className={styles.columnTitle}>
          <Link href={`/${technology.id}/`}>{technology.name}</Link>
        </h3>
      </header>
      {children}
    </article>
  );
}
