// The compare page's dimensions, and what each technology shows on one of
// them. Every join (a dimension to its rows, minds and milestones) happens
// here at build time, from the JSON. Pure: no React and no data loading, so
// the tests can load it.
import type { TimelineGroup, TimelineItem } from "@/components/timeline/timelineModel";
import { COMPARE_MINDS_KEY, COMPARE_PARAM, MINDS_ROW_ID, compareCategoryKey } from "@/lib/dimensions";
import { enumLabel, milestoneTypes, type MilestoneTypeInfo } from "@/lib/enums";
import type {
  ArtificialMindsStage,
  MilestoneCategory,
  Risk,
  RiskDomain,
  ScorecardData,
  ScorecardRow,
  TechnologyPage,
} from "@/lib/types";
import {
  RISK_DOMAINS,
  RISK_ROW_BY_DOMAIN,
  milestoneCategoryInfo,
  milestoneRowsForFamily,
  risksForFamily,
  type MilestoneRow,
} from "@/lib/workbook";

// What a dimension compares: one scorecard row, the artificial minds
// questions, or one milestone category.
export type DimensionKind = "scorecard" | "minds" | "category";

export interface CompareDimension {
  key: string; // the address value: /compare/?dimension=<key>
  kind: DimensionKind;
  label: string; // the select option and the panel's h2
  group: string | null; // the select's option group, or null for a standalone option
  rowId?: string; // scorecard dimensions only
  category?: MilestoneCategory; // category dimensions only
  type?: MilestoneTypeInfo; // category dimensions only: the type it belongs to
}

const SCORECARD_GROUP = "Scorecard";
const MINDS_LABEL = "Artificial minds";

const VALIDATE_COMMAND = "python -m sf_shared.validate content/";

// Every dimension, in the select's order:
// - the scorecard rows, in the first page's order (the validator checks that
//   every page has the same rows in the same order);
// - Artificial minds, on its own;
// - each milestone type's categories, type by type.
// Throws at build when two dimensions share a key, which only happens when a
// scorecard row takes a reserved id. The validator refuses those too.
export function compareDimensions(technologies: TechnologyPage[]): CompareDimension[] {
  const dimensions: CompareDimension[] = [];

  if (technologies.length > 0) {
    for (const row of technologies[0].scorecard) {
      dimensions.push({
        key: row.id,
        kind: "scorecard",
        label: row.dimension,
        group: SCORECARD_GROUP,
        rowId: row.id,
      });
    }
  }

  dimensions.push({ key: COMPARE_MINDS_KEY, kind: "minds", label: MINDS_LABEL, group: null });

  for (const type of milestoneTypes()) {
    for (const category of type.categories) {
      dimensions.push({
        key: compareCategoryKey(category),
        kind: "category",
        label: enumLabel("MilestoneCategory", category),
        group: `${type.label} milestones`,
        category,
        type,
      });
    }
  }

  const seen = new Set<string>();
  for (const dimension of dimensions) {
    if (seen.has(dimension.key)) {
      throw new Error(
        `The compare page has two dimensions with the key "${dimension.key}". ` +
          `A scorecard row id can't be "${COMPARE_MINDS_KEY}" or a milestone category. ` +
          `Run ${VALIDATE_COMMAND} to see which row.`,
      );
    }
    seen.add(dimension.key);
  }
  return dimensions;
}

// A run of dimensions that share an option group, in order. A dimension with
// no group gets a run of its own and becomes a standalone option.
export interface DimensionGroup {
  group: string | null;
  dimensions: CompareDimension[];
}

export function dimensionGroups(dimensions: CompareDimension[]): DimensionGroup[] {
  const groups: DimensionGroup[] = [];
  for (const dimension of dimensions) {
    const last = groups.length > 0 ? groups[groups.length - 1] : null;
    if (last !== null && last.group !== null && last.group === dimension.group) {
      last.dimensions.push(dimension);
    } else {
      groups.push({ group: dimension.group, dimensions: [dimension] });
    }
  }
  return groups;
}

// The dimension the address asks for. Keys match exactly. No parameter shows
// the first dimension. A value that matches nothing (stale, mistyped or empty)
// also shows the first one, with unknown set so the page can drop it from the
// address.
export function chosenDimension(
  dimensions: CompareDimension[],
  raw: string | null,
): { dimension: CompareDimension; unknown: boolean } {
  if (raw === null) {
    return { dimension: dimensions[0], unknown: false };
  }
  for (const dimension of dimensions) {
    if (dimension.key === raw) {
      return { dimension, unknown: false };
    }
  }
  return { dimension: dimensions[0], unknown: true };
}

// The query string for a dimension, keeping any other parameters:
// ("economic-viability", "?utm=x") -> "?utm=x&dimension=economic-viability".
// A null key removes the parameter, and with nothing left the result is "".
export function compareAddress(key: string | null, current: URLSearchParams): string {
  const params = new URLSearchParams(current);
  if (key === null) {
    params.delete(COMPARE_PARAM);
  } else {
    params.set(COMPARE_PARAM, key);
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

// The dimension after this one, wrapping from the last back to the first.
export function nextDimension(dimensions: CompareDimension[], key: string): CompareDimension {
  for (let index = 0; index < dimensions.length; index++) {
    if (dimensions[index].key === key) {
      return dimensions[(index + 1) % dimensions.length];
    }
  }
  return dimensions[0];
}

// The ids in a panel, prefixed with its key so they stay unique on a page
// that holds every panel.
export function panelTitleId(key: string): string {
  return `compare-${key}-title`;
}

export function columnTitleId(key: string, technologyId: string): string {
  return `compare-${key}-${technologyId}`;
}

// ---------- What each technology shows ----------

export interface ScorecardCell {
  technology: TechnologyPage;
  row: ScorecardRow;
}

// Each technology's row with this id, in technologies.json order. Every page
// has every row (the validator checks), so a missing one fails the build.
export function scorecardCells(technologies: TechnologyPage[], rowId: string): ScorecardCell[] {
  const cells: ScorecardCell[] = [];
  for (const technology of technologies) {
    const row = findRow(technology, rowId);
    if (row === null) {
      throw new Error(
        `content/technologies.json: ${technology.id} has no scorecard row with id "${rowId}". ` +
          `Every page needs the same scorecard rows. Run ${VALIDATE_COMMAND} to see what differs.`,
      );
    }
    cells.push({ technology, row });
  }
  return cells;
}

function findRow(technology: TechnologyPage, rowId: string): ScorecardRow | null {
  for (const row of technology.scorecard) {
    if (row.id === rowId) {
      return row;
    }
  }
  return null;
}

// The risk domain a scorecard row stands for ("governance-risk" ->
// "governance"), or null for a case row. RISK_ROW_BY_DOMAIN in lib/workbook.ts
// is the one place that pairs them.
export function riskDomainOfRow(rowId: string): RiskDomain | null {
  for (const domain of RISK_DOMAINS) {
    if (RISK_ROW_BY_DOMAIN[domain] === rowId) {
      return domain;
    }
  }
  return null;
}

// The risks (tab 7) behind a risk row on one page: those whose Family cell
// names the page and whose Domain is the row's, in sheet order. Empty for a
// case row and for a row the workbook marks Not applicable.
export function domainRisks(scorecard: ScorecardData, technology: TechnologyPage, row: ScorecardRow): Risk[] {
  const domain = riskDomainOfRow(row.id);
  if (row.scale !== "risk" || domain === null || row.applicable === false) {
    return [];
  }
  return risksForFamily(scorecard, technology.id, domain);
}

// ---------- Artificial minds ----------

// The facets of tab 4.1, labelled as on the technology page (mindsParts.ts):
// the tab's column headers reworded to read as headings.
export const MINDS_FACETS = [
  { key: "consciousness", label: "Consciousness" },
  { key: "moral_status", label: "Grounds for moral status" },
  { key: "identity", label: "Identity, copying and modification" },
  { key: "welfare", label: "Welfare harms or benefits" },
  { key: "protections", label: "Proposed protections" },
] as const;

export type MindsFacetKey = (typeof MINDS_FACETS)[number]["key"];

// One stage's cell in one facet.
export interface MindsStatement {
  stage: string | null; // "S3", or null for a row like BCI's "All stages"
  // The tab's Stage cell without its leading number: "3 Whole brain
  // emulation (one instance)" -> "Whole brain emulation (one instance)".
  stageName: string;
  text: string; // the cell, word for word
}

export interface MindsFacet {
  key: MindsFacetKey;
  label: string;
  statements: MindsStatement[]; // in the tab's stage order
}

// "3 Whole brain emulation (one instance)" -> "Whole brain emulation (one
// instance)". Only a label the importer found a stage number in loses its
// first word, so "All stages" stays as it is.
export function stageName(stage: ArtificialMindsStage): string {
  if (stage.stage_number === null || stage.stage_number === undefined) {
    return stage.stage_label;
  }
  const prefix = `${stage.stage_number} `;
  return stage.stage_label.startsWith(prefix) ? stage.stage_label.slice(prefix.length) : stage.stage_label;
}

// The facets with at least one statement, and the labels of those with none,
// both in the tab's column order. A facet with no text gets no card.
export function mindsFacets(stages: ArtificialMindsStage[]): { filled: MindsFacet[]; empty: string[] } {
  const filled: MindsFacet[] = [];
  const empty: string[] = [];
  for (const facet of MINDS_FACETS) {
    const statements: MindsStatement[] = [];
    for (const stage of stages) {
      const text = stage[facet.key];
      if (typeof text === "string" && text.trim() !== "") {
        statements.push({ stage: stage.stage ?? null, stageName: stageName(stage), text });
      }
    }
    if (statements.length > 0) {
      filled.push({ key: facet.key, label: facet.label, statements });
    } else {
      empty.push(facet.label);
    }
  }
  return { filled, empty };
}

export interface MindsCell {
  technology: TechnologyPage;
  row: ScorecardRow | null; // the artificial-mind welfare and rights risk row
  // True when that row says Not applicable (BCI). The column then shows that
  // once, and no facets.
  notApplicable: boolean;
  facets: MindsFacet[];
  emptyFacets: string[];
}

// The artificial minds view for each technology: its minds risk row and the
// tab 4.1 statements, facet by facet. The page's own questions are left out:
// on BCI and neuromorphic AI they are AI drafts, and this page shows only the
// team's work.
export function mindsCells(technologies: TechnologyPage[]): MindsCell[] {
  const cells: MindsCell[] = [];
  for (const technology of technologies) {
    const row = findRow(technology, MINDS_ROW_ID);
    const notApplicable = row !== null && row.applicable === false;
    const { filled, empty } = mindsFacets(technology.artificial_minds_by_stage ?? []);
    cells.push({
      technology,
      row,
      notApplicable,
      facets: notApplicable ? [] : filled,
      emptyFacets: notApplicable ? [] : empty,
    });
  }
  return cells;
}

// ---------- Milestone categories ----------

// A tab 1a category question cut where the sheet itself starts its
// "Counts as evidence:" and "Does not count:" parts. Nothing is reworded:
// joining the non-null parts with single spaces gives back the question.
export interface CategoryQuestion {
  question: string; // "Can the relevant components be built and operated?"
  countsAsEvidence: string | null; // "Counts as evidence: ..."
  doesNotCount: string | null; // "Does not count: ..."
}

const COUNTS_MARK = "Counts as evidence:";
const DOES_NOT_COUNT_MARK = "Does not count:";

export function splitCategoryQuestion(text: string): CategoryQuestion {
  const countsAt = text.indexOf(` ${COUNTS_MARK}`);
  if (countsAt === -1) {
    return { question: text, countsAsEvidence: null, doesNotCount: null };
  }
  const question = text.slice(0, countsAt);
  const rest = text.slice(countsAt + 1);
  const notAt = rest.indexOf(` ${DOES_NOT_COUNT_MARK}`);
  if (notAt === -1) {
    return { question, countsAsEvidence: rest, doesNotCount: null };
  }
  return { question, countsAsEvidence: rest.slice(0, notAt), doesNotCount: rest.slice(notAt + 1) };
}

export interface CategoryInfo {
  code: string | null; // the tab's "M1", or null without a header row
  question: CategoryQuestion | null;
}

// The category's tab 1a header: its M code and its question.
export function categoryInfo(scorecard: ScorecardData, category: MilestoneCategory): CategoryInfo {
  const info = milestoneCategoryInfo(scorecard, category);
  if (!info) {
    return { code: null, question: null };
  }
  return { code: info.id, question: splitCategoryQuestion(info.question) };
}

export interface CategoryCell {
  technology: TechnologyPage;
  // The family's tab 1a rows in this category, in sheet order (BCI and
  // neuromorphic AI have two M1 rows each), with their part for the anchor.
  rows: MilestoneRow[];
  // Its public timeline milestones in this category, in timeline order.
  timelineItems: TimelineItem[];
}

// Each technology's tab 1a rows in one category, plus the timeline milestones
// filed under the same category. groups come from
// buildTimeline(getPublicMilestones(), nowYear), so the codes match the
// timeline. A sample milestone is dropped here as well, in case one gets
// through.
export function categoryCells(
  technologies: TechnologyPage[],
  scorecard: ScorecardData,
  groups: TimelineGroup[],
  category: MilestoneCategory,
): CategoryCell[] {
  const cells: CategoryCell[] = [];
  for (const technology of technologies) {
    const rows: MilestoneRow[] = [];
    for (const row of milestoneRowsForFamily(scorecard, technology.id)) {
      if (row.assessment.category === category) {
        rows.push(row);
      }
    }
    const timelineItems: TimelineItem[] = [];
    for (const group of groups) {
      if (group.technology !== technology.id) {
        continue;
      }
      for (const item of group.items) {
        if (item.milestone.sample !== true && item.milestone.category === category) {
          timelineItems.push(item);
        }
      }
    }
    cells.push({ technology, rows, timelineItems });
  }
  return cells;
}

// The family prefix the workbook writes before a milestone code: "BCI" in "BCI-M1".
const CODE_PREFIX: Record<TechnologyPage["id"], string> = { wbe: "WBE", bci: "BCI", neuromorphic: "NM" };

// "BCI-M1", the workbook's own name for a family's milestone row.
export function milestoneRowCode(row: MilestoneRow): string {
  return `${CODE_PREFIX[row.assessment.family]}-${row.assessment.milestone}`;
}
