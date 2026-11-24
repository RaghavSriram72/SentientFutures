import type { ReactNode } from "react";

import { CodeText } from "@/components/common/CodeText";
import { TextWithTerm } from "@/components/glossary/Term";
import type { CodeIndex } from "@/lib/codes";
import { enumLabel } from "@/lib/enums";
import type { SourceRef } from "@/lib/sources";
import type {
  AlignmentAssessment,
  AlignmentScenario,
  CaseRating,
  Claim,
  Confidence,
  Family,
  IntelligenceCurseAssessment,
  Problem,
  Provenance,
  Scope,
  WelfareGovernance,
} from "@/lib/types";

import { ConfidenceMeter, RatingChip } from "./RatingChip";
import { idText, registerIdText } from "./sections/pageModel";
import { WorkbookClaim } from "./sections/WorkbookClaim";
import styles from "./ScorecardSections.module.css";

// The technology page's sheets and assessment parts, built from the team's
// workbook: the scope sheet, the welfare sheet and the alignment and
// Intelligence Curse parts of the Full assessment. Most labels are the
// workbook's own column headers; a few are reworded so a reader who never
// sees the workbook can follow them (noted where they are). Every workbook
// string goes through CodeText (or WorkbookClaim for a Claim), so its codes
// link and its words stay as written.

type Sources = Record<string, SourceRef>;

// What every workbook block needs to link codes and mark provenance.
export interface WorkbookContext {
  index: CodeIndex;
  family: Family;
  sources: Sources;
  // Site source id -> register id ("s16" -> "S16").
  registerIds: Record<string, string | null>;
  quiet: Provenance;
}

interface SheetItem {
  label: ReactNode;
  key: string;
  value: ReactNode;
  wide?: boolean; // spans both columns in a two-column sheet
}

// Which cells sit in the right-hand column of a two-column sheet, and which
// are on its first line, so the rules between cells fall in the right places.
function placeCells(items: SheetItem[]): { item: SheetItem; right: boolean; first: boolean }[] {
  const placed: { item: SheetItem; right: boolean; first: boolean }[] = [];
  let column = 0;
  let firstLine = true;
  for (const item of items) {
    if (item.wide) {
      placed.push({ item, right: false, first: firstLine });
      column = 0;
      firstLine = false;
      continue;
    }
    placed.push({ item, right: column === 1, first: firstLine });
    if (column === 1) {
      firstLine = false;
    }
    column = column === 0 ? 1 : 0;
  }
  return placed;
}

// A ruled definition list on a paper card, like the spec sheet at the back of
// a manual. With columns={2} the rows pair up side by side on wide screens,
// label over value; a wide row takes a line of its own.
function SpecSheet({ title, items, columns = 1 }: { title: string; items: SheetItem[]; columns?: 1 | 2 }) {
  return (
    <div className={`paper ${styles.sheet}`}>
      <SheetHead title={title} />
      <SheetList items={items} columns={columns} />
    </div>
  );
}

function SheetHead({ title }: { title: string }) {
  return (
    <div className={styles.sheetHead}>
      <span>{title}</span>
    </div>
  );
}

// The ruled cells of a sheet, without its card.
function SheetList({ items, columns }: { items: SheetItem[]; columns: 1 | 2 }) {
  const placed = placeCells(items);
  return (
    <dl className={columns === 2 ? styles.sheetListTwo : ""}>
      {placed.map(({ item, right, first }) => {
        const classes = [styles.sheetRow];
        if (item.wide) {
          classes.push(styles.sheetRowWide);
        }
        if (right) {
          classes.push(styles.sheetRowRight);
        }
        if (first) {
          classes.push(styles.sheetRowFirstLine);
        }
        return (
          <div key={item.key} className={classes.join(" ")}>
            <dt className={styles.sheetLabel}>{item.label}</dt>
            <dd className={styles.sheetValue}>{item.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function claimValue(claim: Claim, context: WorkbookContext): ReactNode {
  return (
    <WorkbookClaim
      claim={claim}
      index={context.index}
      family={context.family}
      sources={context.sources}
      variant="compact"
      quiet={context.quiet}
    />
  );
}

// The workbook's "1 Scope" row for the family. "Problems it claims to
// address" stays open; the other cells are folded under it in a native
// <details>, so the section doesn't open on a wall of codes. PrintOpenDetails
// prints it open. The card itself is id="scope", so a link to #scope lands on
// its title and first cell. Labels are plain-language versions of the tab's
// column headers: "Problems it claims to address" (header "Problem(s)
// claimed to address"), "Definition" ("Technology family definition"),
// "Deployment scenarios considered" (the header adds "(codes → Codebook)"),
// "Who benefits and who bears the risk" ("Target population and affected
// groups (who benefits / who bears risk)") and "Sources" ("Source IDs /
// basis"). The problem named after the arrow at the end of the "Problem(s)
// claimed to address" cell ("→ Both") is stored apart from the text; it is
// shown under it, with "Both" spelled out as the two problems (problemText).
// The problem a scope claims, after its arrow. "Both" alone means nothing to
// a reader, so it names the two problems with their own labels.
function problemText(problem: Problem): string {
  if (problem === "both") {
    return `${enumLabel("Problem", "alignment")} · ${enumLabel("Problem", "intelligence_curse")}`;
  }
  return enumLabel("Problem", problem);
}

export function ScopeSheet({ scope, shortName, context }: { scope: Scope; shortName: string; context: WorkbookContext }) {
  // The "Source IDs / basis" cell word for word, so a range such as "S24-S29"
  // stays as the cell writes it. Only an older import without that text falls
  // back to the expanded ids.
  const sourceText = scope.source_ids_text ?? registerIdText(scope.source_ids ?? [], context.registerIds);
  const problems: SheetItem = {
    key: "problems",
    label: "Problems it claims to address",
    wide: true,
    value: (
      <>
        {claimValue(scope.problems_claimed, context)}
        <p className={styles.problemSuffix}>&rarr; {problemText(scope.problem)}</p>
      </>
    ),
  };
  const rest: SheetItem[] = [
    { key: "definition", label: "Definition", value: claimValue(scope.intervention, context) },
    {
      key: "scenarios",
      // The header without its "(codes → Codebook)". Each code in the value
      // still links to its definition.
      label: "Deployment scenarios considered",
      value: claimValue(scope.deployment_scenario, context),
    },
    {
      key: "groups",
      label: "Who benefits and who bears the risk",
      value: claimValue(scope.affected_groups, context),
    },
    { key: "horizon", label: "Time horizon", value: claimValue(scope.time_horizon, context) },
    {
      key: "comparator",
      // Its first use on the page, so the glossary's definition goes here.
      label: <TextWithTerm text="Comparator" phrase="Comparator" name="comparator" />,
      value: claimValue(scope.comparator, context),
    },
  ];
  if (sourceText !== "") {
    rest.push({
      key: "sources",
      label: "Sources",
      value: (
        <p className={styles.plainValue}>
          <CodeText text={sourceText} index={context.index} family={context.family} mode="workbook" />
        </p>
      ),
    });
  }
  return (
    <div id="scope" className={`paper ${styles.sheet} ${styles.scopeCard}`}>
      <SheetHead title={`Scope · ${shortName}`} />
      <SheetList items={[problems]} columns={1} />
      <details className={styles.sheetFold}>
        <summary className={styles.sheetFoldSummary}>
          <span className={styles.closedLabel}>Show the full scope</span>
          <span className={styles.openLabel}>Hide the full scope</span>
          <span className={styles.sheetFoldChevron} aria-hidden="true" />
        </summary>
        <SheetList items={rest} columns={2} />
      </details>
    </div>
  );
}

// The family's row of "9 Welfare and Governance Judgment": who is exposed, the
// main harms with their risk ids (each links to its risk below) and the
// rationale. Labels are the tab's headers, except "Main harms" (the header
// adds "(risk IDs)"; the ids still show in the value).
export function WelfareSheet({
  welfare,
  shortName,
  context,
}: {
  welfare: WelfareGovernance;
  shortName: string;
  context: WorkbookContext;
}) {
  return (
    <SpecSheet
      title={`Welfare and governance · ${shortName}`}
      columns={2}
      items={[
        { key: "exposed", label: "Who is exposed", value: claimValue(welfare.exposed, context) },
        { key: "harms", label: "Main harms", value: claimValue(welfare.harms, context) },
        { key: "rationale", label: "Rationale", value: claimValue(welfare.rationale, context), wide: true },
      ]}
    />
  );
}

// ---------- The Full assessment's alignment and Intelligence Curse parts ----------

interface VerdictProps {
  rating: CaseRating;
  confidence: Confidence;
  // The scorecard row that gives the reason for this rating. The reason
  // lives there only, so it isn't printed twice.
  whyHref: string;
  whyLabel: string;
}

function Verdict({ rating, confidence, whyHref, whyLabel }: VerdictProps) {
  return (
    <div className={`paper ${styles.verdict}`}>
      <dl className={styles.verdictFacts}>
        <div>
          <dt className={styles.label}>Rating</dt>
          <dd>
            <RatingChip scale="case" rating={rating} />
          </dd>
        </div>
        <div>
          <dt className={styles.label}>Confidence</dt>
          <dd>
            <ConfidenceMeter confidence={confidence} />
          </dd>
        </div>
      </dl>
      <a href={whyHref} className={styles.whyLink}>
        {whyLabel}
      </a>
    </div>
  );
}

function DecisiveQuestion({ claim, context }: { claim: Claim; context: WorkbookContext }) {
  return (
    <div className={styles.decisive}>
      <p className={styles.label}>Decisive open question</p>
      <div className={styles.decisiveClaim}>
        <WorkbookClaim
          claim={claim}
          index={context.index}
          family={context.family}
          sources={context.sources}
          quiet={context.quiet}
        />
      </div>
    </div>
  );
}

// A label over its value, the way the parts set each workbook cell.
function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.pair}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.pairValue}>{children}</dd>
    </div>
  );
}

function CodeLine({ text, context }: { text: string; context: WorkbookContext }) {
  return (
    <p className={styles.plainValue}>
      <CodeText text={text} index={context.index} family={context.family} />
    </p>
  );
}

interface AlignmentPartProps {
  assessment: AlignmentAssessment;
  context: WorkbookContext;
  // Scenario name -> its pathway in "How it would work", only where the two
  // tabs use the very same name.
  pathwayHrefs: Record<string, string>;
  whyHref: string;
  whyLabel: string;
}

// The family row of "4 Alignment Judgment": the problem addressed, the
// mechanism and the decisive open question, then the tab's scenario rows
// word for word, then the rating with a link to its reason on the card.
export function AlignmentPart({ assessment, context, pathwayHrefs, whyHref, whyLabel }: AlignmentPartProps) {
  const scenarios = assessment.scenarios ?? [];
  return (
    <div className={styles.assessment}>
      <dl className={styles.pairs}>
        <Pair label="Problem addressed">
          <CodeLine text={assessment.problem_addressed} context={context} />
        </Pair>
        <Pair label="Mechanism, or effect on the problem">
          <WorkbookClaim
            claim={assessment.mechanism}
            index={context.index}
            family={context.family}
            sources={context.sources}
            quiet={context.quiet}
          />
        </Pair>
      </dl>

      <DecisiveQuestion claim={assessment.decisive_question} context={context} />

      {scenarios.length > 0 && (
        <ul className={styles.rowList}>
          {scenarios.map((scenario, position) => (
            // Two rows can share a scenario name (neuromorphic AI), so the key is the position.
            <ScenarioItem key={position} scenario={scenario} href={pathwayHrefs[scenario.scenario]} context={context} />
          ))}
        </ul>
      )}

      <Verdict rating={assessment.rating} confidence={assessment.confidence} whyHref={whyHref} whyLabel={whyLabel} />
    </div>
  );
}

function ScenarioItem({
  scenario,
  href,
  context,
}: {
  scenario: AlignmentScenario;
  href: string | undefined;
  context: WorkbookContext;
}) {
  const supporting = idText(scenario.supporting);
  const contrary = idText(scenario.contrary_or_qualifying);
  return (
    <li className={styles.rowItem}>
      <p className={styles.rowTitle}>
        <span className="visually-hidden">Scenario: </span>
        {href ? <a href={href}>{scenario.scenario}</a> : scenario.scenario}
      </p>
      <dl className={styles.rowFacts}>
        <Pair label="Problem addressed">
          <CodeLine text={scenario.problem} context={context} />
        </Pair>
        {scenario.mechanism && (
          <Pair label="Mechanism, or effect on the problem">
            <CodeLine text={scenario.mechanism} context={context} />
          </Pair>
        )}
        {supporting !== "" && (
          <Pair label="Supporting entries">
            <CodeLine text={supporting} context={context} />
          </Pair>
        )}
        {contrary !== "" && (
          <Pair label="Contrary or qualifying entries">
            <CodeLine text={contrary} context={context} />
          </Pair>
        )}
        {scenario.gap && (
          <Pair label="Main gap, or reason for rating">
            <CodeLine text={scenario.gap} context={context} />
          </Pair>
        )}
      </dl>
    </li>
  );
}

interface IntelligenceCursePartProps {
  assessment: IntelligenceCurseAssessment;
  context: WorkbookContext;
  whyHref: string;
  whyLabel: string;
}

// The family row of "5 Intelligence Curse Judgment": the mechanism claimed and
// the tab's four questions (their column headers word for word) with the
// answers, then the family's rows of "6 Agency and Ownership" and its
// ownership gate, with a note on what the gate counts, then the rating with
// a link to its reason on the card. The ownership questions' header,
// "Ownership questions (answered in database?)", is reworded for readers.
export function IntelligenceCursePart({ assessment, context, whyHref, whyLabel }: IntelligenceCursePartProps) {
  const questions = assessment.questions ?? [];
  const agency = assessment.agency ?? [];
  return (
    <div className={styles.assessment}>
      <dl className={styles.pairs}>
        <Pair label="Mechanism claimed">
          <WorkbookClaim
            claim={assessment.mechanism}
            index={context.index}
            family={context.family}
            sources={context.sources}
            quiet={context.quiet}
          />
        </Pair>
      </dl>

      {questions.length > 0 && (
        <dl className={styles.qaList}>
          {questions.map((item) => (
            <div key={item.question} className={styles.qaItem}>
              <dt className={styles.question}>{item.question}</dt>
              <dd>
                <WorkbookClaim
                  claim={item.answer}
                  index={context.index}
                  family={context.family}
                  sources={context.sources}
                  quiet={context.quiet}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* The tab has no decisive question column, so it is usually missing. */}
      {assessment.decisive_question && <DecisiveQuestion claim={assessment.decisive_question} context={context} />}

      {(agency.length > 0 || assessment.ownership_gate) && (
        <div className={styles.agency}>
          <h4 className={styles.blockTitle}>Agency and ownership</h4>
          {agency.length > 0 && (
            <ul className={styles.rowList}>
              {agency.map((row) => {
                const entries = idText(row.entries);
                return (
                  <li key={row.group} className={styles.rowItem}>
                    <p className={styles.rowHead}>
                      <span className={styles.rowTitle}>{row.group}</span>
                      <span className={`chip ${styles.neutralChip}`}>
                        <span className="visually-hidden">Effect: </span>
                        {enumLabel("AgencyEffect", row.effect)}
                      </span>
                    </p>
                    {(row.mechanism || row.ownership_questions || entries !== "") && (
                      <dl className={styles.rowFacts}>
                        {row.mechanism && (
                          <Pair label="Mechanism">
                            <CodeLine text={row.mechanism} context={context} />
                          </Pair>
                        )}
                        {row.ownership_questions && (
                          <Pair label="Ownership questions, and whether our sources answer them">
                            <CodeLine text={row.ownership_questions} context={context} />
                          </Pair>
                        )}
                        {entries !== "" && (
                          <Pair label="Evidence entries">
                            <CodeLine text={entries} context={context} />
                          </Pair>
                        )}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {assessment.ownership_gate && (
            <dl className={styles.gate}>
              <Pair label="Ownership gate">
                <CodeLine text={assessment.ownership_gate} context={context} />
                <p className={styles.gateNote}>How many of the ownership questions above are answered by our sources.</p>
              </Pair>
            </dl>
          )}
        </div>
      )}

      <Verdict rating={assessment.rating} confidence={assessment.confidence} whyHref={whyHref} whyLabel={whyLabel} />
    </div>
  );
}
