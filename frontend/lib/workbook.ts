// Pure selectors over the workbook's shared tables (content/scorecard.json).
// No React and no file reading: pages load the data with getScorecard() in
// lib/data.ts and pass it here. Every list keeps the workbook's own row order;
// nothing here sorts, merges or reconciles two tabs (tests/workbook.test.ts).
// The last section turns a few workbook values into the words readers see;
// the data itself keeps the workbook's values.
import { milestoneParts } from "./codes";
import { enumLabel, enumValues } from "./enums";
import type {
  CausalLink,
  CodebookRow,
  EntryFeed,
  EvidenceEntry,
  EvidenceStatus,
  Family,
  FeedTarget,
  GovernanceItem,
  GovernanceStatus,
  MilestoneAssessment,
  MilestoneCategoryInfo,
  Outcome,
  Risk,
  RiskDomain,
  ScorecardData,
} from "./types";

// The workbook's scale orders, as in enums.py, for grouping and counting.
export const EVIDENCE_STATUSES: EvidenceStatus[] = [
  "supporting",
  "contrary",
  "conflicting",
  "no_relevant_evidence",
  "search_incomplete",
];
export const GOVERNANCE_STATUSES: GovernanceStatus[] = ["not_addressed", "proposal_found", "evidence_found"];
export const RISK_DOMAINS: RiskDomain[] = ["human_welfare", "artificial_mind_welfare", "governance"];

// The scorecard row each risk domain belongs to (technologies.json row ids).
export const RISK_ROW_BY_DOMAIN: Record<RiskDomain, string> = {
  human_welfare: "human-welfare-risk",
  artificial_mind_welfare: "artificial-mind-welfare-and-rights-risk",
  governance: "governance-risk",
};

// The headline ratings entries feed, and the case row each one is.
export const CASE_ROW_BY_TARGET: Record<"alignment" | "intelligence_curse", string> = {
  alignment: "alignment-case",
  intelligence_curse: "intelligence-curse-case",
};

// ---------- Evidence entries ----------

export function entryById(scorecard: ScorecardData): Record<string, EvidenceEntry> {
  const map: Record<string, EvidenceEntry> = {};
  for (const entry of scorecard.entries ?? []) {
    map[entry.id] = entry;
  }
  return map;
}

// The entries with these ids, in the order given; unknown ids are skipped.
export function entriesWithIds(scorecard: ScorecardData, ids: string[]): EvidenceEntry[] {
  const byId = entryById(scorecard);
  const found: EvidenceEntry[] = [];
  for (const id of ids) {
    if (byId[id]) {
      found.push(byId[id]);
    }
  }
  return found;
}

// An entry belongs to a family when its Family cell names it, or when its
// "Ratings it feeds" names one of the family's ratings (a Cross-family entry
// can feed a family's card).
export function entriesForFamily(scorecard: ScorecardData, family: Family | "cross_family"): EvidenceEntry[] {
  const found: EvidenceEntry[] = [];
  for (const entry of scorecard.entries ?? []) {
    const fed = (entry.feeds ?? []).some((feed) => feed.family === family);
    if (entry.family === family || fed) {
      found.push(entry);
    }
  }
  return found;
}

export function entriesForSource(scorecard: ScorecardData, sourceId: string): EvidenceEntry[] {
  return (scorecard.entries ?? []).filter((entry) => entry.source_id === sourceId);
}

// "source id" -> how many register entries cite it. Sources with none are absent.
export function entryCountsBySource(scorecard: ScorecardData): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of scorecard.entries ?? []) {
    counts[entry.source_id] = (counts[entry.source_id] ?? 0) + 1;
  }
  return counts;
}

// A feed as a filter key: "bci-alignment", "neuromorphic-intelligence-curse", "wbe-m1".
export function feedKey(family: Family, target: FeedTarget | string): string {
  return `${family}-${target.toLowerCase().replace(/_/g, "-")}`;
}

// Every feed key an entry has, in its own order. Empty for "Not used in a headline rating".
export function feedKeys(entry: EvidenceEntry): string[] {
  const keys: string[] = [];
  for (const feed of entry.feeds ?? []) {
    const key = feedKey(feed.family, feed.target);
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }
  return keys;
}

// The entries whose "Ratings it feeds" names this family and target.
export function entriesFeeding(scorecard: ScorecardData, family: Family, target: FeedTarget): EvidenceEntry[] {
  return (scorecard.entries ?? []).filter((entry) =>
    (entry.feeds ?? []).some((feed) => feed.family === family && feed.target === target),
  );
}

export interface FeedGroup {
  direction: EntryFeed["direction"];
  // The register's own note, word for word ("efficiency prerequisite only"), or null.
  note: string | null;
  entries: EvidenceEntry[];
}

// The entries feeding one rating, grouped as the register words it: supports
// first, then against or qualifies, with a noted feed in a group of its own.
// Entries keep register order inside each group.
export function feedGroups(scorecard: ScorecardData, family: Family, target: FeedTarget): FeedGroup[] {
  const groups: FeedGroup[] = [];
  for (const direction of ["supports", "against_or_qualifies"] as const) {
    for (const entry of scorecard.entries ?? []) {
      for (const feed of entry.feeds ?? []) {
        if (feed.family !== family || feed.target !== target || feed.direction !== direction) {
          continue;
        }
        const note = feed.note ?? null;
        let group = groups.find((item) => item.direction === direction && item.note === note);
        if (!group) {
          group = { direction, note, entries: [] };
          groups.push(group);
        }
        if (!group.entries.includes(entry)) {
          group.entries.push(entry);
        }
      }
    }
  }
  // Within a direction, the plain group comes before noted ones.
  groups.sort((a, b) => {
    if (a.direction !== b.direction) {
      return a.direction === "supports" ? -1 : 1;
    }
    return (a.note === null ? 0 : 1) - (b.note === null ? 0 : 1);
  });
  return groups;
}

// ---------- Causal links (tab 2) ----------

export function linksForFamily(scorecard: ScorecardData, family: Family): CausalLink[] {
  return (scorecard.links ?? []).filter((link) => link.family === family);
}

export interface Pathway {
  scenario: string; // the tab's Scenario name
  scenarioCode: string; // from the link ids, e.g. "WBE-O"
  outcomes: Outcome[]; // the Outcome values its links name, in first-seen order
  links: CausalLink[]; // sheet order, never renumbered
  statusCounts: Partial<Record<EvidenceStatus, number>>;
}

// The family's links grouped by the tab's Scenario name, in sheet order.
export function linksByScenario(scorecard: ScorecardData, family: Family): Pathway[] {
  const pathways: Pathway[] = [];
  for (const link of linksForFamily(scorecard, family)) {
    let pathway = pathways.find((item) => item.scenario === link.scenario);
    if (!pathway) {
      pathway = { scenario: link.scenario, scenarioCode: link.scenario_code, outcomes: [], links: [], statusCounts: {} };
      pathways.push(pathway);
    }
    pathway.links.push(link);
    if (!pathway.outcomes.includes(link.outcome)) {
      pathway.outcomes.push(link.outcome);
    }
    pathway.statusCounts[link.status] = (pathway.statusCounts[link.status] ?? 0) + 1;
  }
  return pathways;
}

// ---------- Risks (tab 7) and the governance checklist (tab 8) ----------

// The risks whose Family cell names this family (R05 names all three).
export function risksForFamily(scorecard: ScorecardData, family: Family, domain: RiskDomain | null = null): Risk[] {
  return (scorecard.risks ?? []).filter(
    (risk) => risk.families.includes(family) && (domain === null || risk.domain === domain),
  );
}

export interface RiskGroup {
  domain: RiskDomain;
  risks: Risk[];
}

// One group per domain in the workbook's order, empty groups included.
export function risksByDomain(scorecard: ScorecardData, family: Family): RiskGroup[] {
  return RISK_DOMAINS.map((domain) => ({ domain, risks: risksForFamily(scorecard, family, domain) }));
}

export function governanceForFamily(scorecard: ScorecardData, family: Family): GovernanceItem[] {
  return (scorecard.governance ?? []).filter((item) => item.family === family);
}

export interface GovernanceGroup {
  status: GovernanceStatus;
  items: GovernanceItem[];
}

// One group per status in the workbook's order, leaving out empty ones. Items keep sheet order.
export function governanceByStatus(scorecard: ScorecardData, family: Family): GovernanceGroup[] {
  const groups: GovernanceGroup[] = [];
  for (const status of GOVERNANCE_STATUSES) {
    const items = governanceForFamily(scorecard, family).filter((item) => item.status === status);
    if (items.length > 0) {
      groups.push({ status, items });
    }
  }
  return groups;
}

export function governanceStatusCounts(scorecard: ScorecardData, family: Family): Partial<Record<GovernanceStatus, number>> {
  const counts: Partial<Record<GovernanceStatus, number>> = {};
  for (const item of governanceForFamily(scorecard, family)) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

// ---------- Milestone rows (tab 1a) ----------

export interface MilestoneRow {
  assessment: MilestoneAssessment;
  // null for a milestone with one row; 1, 2, ... for a split one (BCI M1, NM M1).
  part: number | null;
}

// The family's tab 1a rows in sheet order, each with its part number for its anchor.
export function milestoneRowsForFamily(scorecard: ScorecardData, family: Family): MilestoneRow[] {
  const rows = scorecard.milestone_assessments ?? [];
  const parts = milestoneParts(rows);
  const found: MilestoneRow[] = [];
  rows.forEach((assessment, index) => {
    if (assessment.family === family) {
      found.push({ assessment, part: parts[index] });
    }
  });
  return found;
}

// The rows for one milestone category across families, in sheet order (the compare page).
export function milestoneRowsForCategory(scorecard: ScorecardData, category: string): MilestoneAssessment[] {
  return (scorecard.milestone_assessments ?? []).filter((row) => row.category === category);
}

// The category header ("M1 Technical capability" and its question) by code or category.
export function milestoneCategoryInfo(scorecard: ScorecardData, idOrCategory: string): MilestoneCategoryInfo | undefined {
  return (scorecard.milestone_categories ?? []).find(
    (info) => info.id === idOrCategory || info.category === idOrCategory,
  );
}

// ---------- The Codebook ----------

// The Codebook's word for each family.
export const CODEBOOK_FAMILY: Record<Family, string> = { wbe: "WBE", bci: "BCI", neuromorphic: "Neuromorphic AI" };

// The Codebook row for a code of one type, preferring the family's own row
// over an "All" row. No family (a Cross-family entry's stage) finds only "All"
// rows, since stages mean different things per family. Undefined codes
// (A-X, BCI-C) find nothing: the workbook doesn't define them.
export function codebookRow(
  scorecard: ScorecardData,
  type: string,
  code: string,
  family: Family | "cross_family" | null = null,
): CodebookRow | undefined {
  const rows = (scorecard.codebook ?? []).filter((row) => row.type === type && row.code === code);
  if (family !== null && family !== "cross_family") {
    const own = rows.find((row) => row.family === CODEBOOK_FAMILY[family]);
    if (own) {
      return own;
    }
  }
  return rows.find((row) => row.family === "All");
}

// The Codebook's rows grouped by type, keeping sheet order inside each group
// and the order types first appear. A row is never split or moved between groups.
export function codebookByType(scorecard: ScorecardData): { type: string; rows: CodebookRow[] }[] {
  const groups: { type: string; rows: CodebookRow[] }[] = [];
  for (const row of scorecard.codebook ?? []) {
    let group = groups.find((item) => item.type === row.type);
    if (!group) {
      group = { type: row.type, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

// ---------- Counts ----------

export interface FamilyCounts {
  entries: number; // entries for the family (entriesForFamily)
  links: number;
  linkStatuses: Partial<Record<EvidenceStatus, number>>;
  risks: number;
  governance: number;
  governanceStatuses: Partial<Record<GovernanceStatus, number>>;
  milestoneRows: number;
}

export function familyCounts(scorecard: ScorecardData, family: Family): FamilyCounts {
  const linkStatuses: Partial<Record<EvidenceStatus, number>> = {};
  const links = linksForFamily(scorecard, family);
  for (const link of links) {
    linkStatuses[link.status] = (linkStatuses[link.status] ?? 0) + 1;
  }
  return {
    entries: entriesForFamily(scorecard, family).length,
    links: links.length,
    linkStatuses,
    risks: risksForFamily(scorecard, family).length,
    governance: governanceForFamily(scorecard, family).length,
    governanceStatuses: governanceStatusCounts(scorecard, family),
    milestoneRows: milestoneRowsForFamily(scorecard, family).length,
  };
}

// ---------- Display wording ----------
// Display only: the data keeps the workbook's own values, and every page that
// shows one of these values uses the helper here, so they read the same.

// What each Outcome value names, as readers see it. "Both" names the two
// outcomes, so a list never shows "Both" beside them.
const OUTCOME_DISPLAY: Record<Outcome, string[]> = {
  "AI Alignment": ["AI alignment"],
  "Intelligence Curse": ["Intelligence Curse"],
  Both: ["AI alignment", "Intelligence Curse"],
  Neither: ["Neither"],
};

// The outcomes one Outcome value, or a list of them, names, each once, in
// first-seen order:
//   "AI Alignment"                                  -> ["AI alignment"]
//   "Both"                                          -> ["AI alignment", "Intelligence Curse"]
//   ["Both", "AI Alignment", "Intelligence Curse"]  -> ["AI alignment", "Intelligence Curse"]
// A value the table above doesn't know is shown as it is. Join the result
// for a line of text: outcomeLabels(values).join(" · ").
export function outcomeLabels(outcomes: string | readonly string[]): string[] {
  const values = typeof outcomes === "string" ? [outcomes] : outcomes;
  const labels: string[] = [];
  for (const value of values) {
    const known = Object.prototype.hasOwnProperty.call(OUTCOME_DISPLAY, value);
    const words = known ? OUTCOME_DISPLAY[value as Outcome] : [value];
    for (const word of words) {
      if (!labels.includes(word)) {
        labels.push(word);
      }
    }
  }
  return labels;
}

// A causal link's step without the leading number the workbook uses to order
// its steps: "1 Capability" -> "Capability", "3 Change in capability,
// incentives or power" -> "Change in capability, incentives or power". A step
// with no number ("Condition (timing, spillover, security)") stays as it is.
export function stepLabel(step: string): string {
  const stripped = step.replace(/^\d+\s+/, "");
  return stripped === "" ? step : stripped;
}

// The name a milestone category shows: the site's own label from the shared
// enums, the words the timeline uses ("Scalable manufacture, compute or
// data"). The workbook's header label is kept only for a category the enums
// don't have.
export function milestoneCategoryLabel(info: MilestoneCategoryInfo): string {
  const known = enumValues("MilestoneCategory").some((value) => value.value === info.category);
  return known ? enumLabel("MilestoneCategory", info.category) : info.label;
}
