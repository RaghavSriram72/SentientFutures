// What a rating card works out from the content at build time: which kind of
// row it is, the register entries that feed its rating, how many of the
// workbook's risks sit in its domain, and what the team's tracker holds; and
// the Codebook's words for each rating and confidence, which the scorecard's
// grading key shows once. Nothing here is stored. Pure, no React, so the
// tests can load it.
import type { TimelineItem } from "@/components/timeline/timelineModel";
import { enumLabel, enumValues } from "@/lib/enums";
import type {
  CaseRating,
  Claim,
  CodebookRow,
  Confidence,
  EntryFeed,
  EvidenceEntry,
  Family,
  RatingChange,
  RiskDomain,
  ScorecardData,
  ScorecardRow,
} from "@/lib/types";
import { CASE_ROW_BY_TARGET, feedGroups, feedKey, RISK_ROW_BY_DOMAIN, risksForFamily } from "@/lib/workbook";

// The safeguard row's id. Ids never change once public (types.ts).
export const SAFEGUARD_ROW_ID = "safeguard-adequacy";

// A case row has a rating on the Codebook's Rating scale. The safeguard row
// has a rating too, but tab 9's "Safeguards adequate?" is its own scale, so
// the Rating definitions never show on it. A risk row has no rating at all:
// the workbook keeps severity, likelihood and confidence apart.
export type CardKind = "case" | "safeguard" | "risk";

export function cardKind(row: ScorecardRow): CardKind {
  if (row.scale === "risk") {
    return "risk";
  }
  return row.id === SAFEGUARD_ROW_ID ? "safeguard" : "case";
}

// "Case · Alignment", "Risk". The rating cards and the compare page use it.
export function scaleLabel(row: ScorecardRow): string {
  const scale = row.scale === "case" ? "Case" : "Risk";
  if (row.problem) {
    return `${scale} · ${enumLabel("Problem", row.problem)}`;
  }
  return scale;
}

// ---------- The Codebook's words for a rating and a confidence ----------

// The Codebook's Rating row for this rating, word for word ("Weak" ->
// "Poorly targeted, ..."). The row's code is the rating's label, so the
// enum label finds it. Empty when the Codebook has no such row.
export function ratingDefinition(codebook: CodebookRow[], rating: CaseRating): string {
  const label = enumLabel("CaseRating", rating);
  const row = codebook.find((item) => item.type === "Rating" && item.code === label);
  return row ? row.definition : "";
}

// The Codebook writes all three confidences in one cell: "High: ... Medium:
// ... Low: ...". This cuts out the part after this confidence's own label,
// up to the next label, word for word except that its first letter is made a
// capital, since it now starts a line of its own ("multiple robust sources,
// ..." shows as "Multiple robust sources, ..."). Display only: the data keeps
// the cell as written. Empty when the cell or the label is missing.
export function confidenceDefinition(codebook: CodebookRow[], confidence: Confidence): string {
  const row = codebook.find((item) => item.type === "Confidence");
  if (!row) {
    return "";
  }
  const labels = enumValues("Confidence").map((info) => info.label);
  const pattern = new RegExp(`(?:^|\\s)(${labels.join("|")}):\\s*`, "g");
  const starts: { label: string; at: number; textAt: number }[] = [];
  for (const match of row.definition.matchAll(pattern)) {
    if (match.index !== undefined) {
      starts.push({ label: match[1], at: match.index, textAt: match.index + match[0].length });
    }
  }
  const wanted = enumLabel("Confidence", confidence);
  const index = starts.findIndex((start) => start.label === wanted);
  if (index === -1) {
    return "";
  }
  const end = index + 1 < starts.length ? starts[index + 1].at : row.definition.length;
  const text = row.definition.slice(starts[index].textAt, end).trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface ScaleMeaning<T extends string> {
  value: T;
  definition: string; // "" when the Codebook has none
}

// Every rating and every confidence in the scale's own order, each with its
// Codebook meaning (word for word, a confidence's with a capital first
// letter), for the scorecard's grading key.
export function gradingMeanings(codebook: CodebookRow[]): {
  ratings: ScaleMeaning<CaseRating>[];
  confidences: ScaleMeaning<Confidence>[];
} {
  const ratings: ScaleMeaning<CaseRating>[] = [];
  for (const info of enumValues("CaseRating")) {
    const value = info.value as CaseRating;
    ratings.push({ value, definition: ratingDefinition(codebook, value) });
  }
  const confidences: ScaleMeaning<Confidence>[] = [];
  for (const info of enumValues("Confidence")) {
    const value = info.value as Confidence;
    confidences.push({ value, definition: confidenceDefinition(codebook, value) });
  }
  return { ratings, confidences };
}

// ---------- Evidence that feeds a rating ----------

// The rating a case row stands for, as the register's column G names it.
// null for rows no entry can feed (the safeguard and risk rows).
export function feedTargetFor(row: ScorecardRow): "alignment" | "intelligence_curse" | null {
  for (const target of ["alignment", "intelligence_curse"] as const) {
    if (CASE_ROW_BY_TARGET[target] === row.id) {
      return target;
    }
  }
  return null;
}

// Column G's own direction words.
const DIRECTION_WORDS: Record<EntryFeed["direction"], string> = {
  supports: "supports",
  against_or_qualifies: "against or qualifies",
};

export interface EvidenceGroupView {
  // "Supports", "Against or qualifies", or with the register's note
  // "Supports, efficiency prerequisite only" (column G word for word).
  heading: string;
  // "Supports: 5", "Supports, efficiency prerequisite only: 2".
  count: string;
  entries: EvidenceEntry[];
}

export interface RowEvidence {
  groups: EvidenceGroupView[];
  total: number; // distinct entries across the groups
  href: string; // the register filtered to this rating
}

function directionText(direction: EntryFeed["direction"], note: string | null): string {
  const words = DIRECTION_WORDS[direction];
  return note ? `${words}, ${note}` : words;
}

// The entries whose column G feeds this row's rating, grouped as the register
// words them (supports first; a noted feed is a group of its own), in
// register order. null when nothing feeds the row.
export function rowEvidence(scorecard: ScorecardData, family: Family, row: ScorecardRow): RowEvidence | null {
  const target = feedTargetFor(row);
  if (target === null) {
    return null;
  }
  const groups: EvidenceGroupView[] = [];
  const seen = new Set<string>();
  for (const group of feedGroups(scorecard, family, target)) {
    const text = directionText(group.direction, group.note);
    const heading = text.charAt(0).toUpperCase() + text.slice(1);
    groups.push({
      heading,
      count: `${heading}: ${group.entries.length}`,
      entries: group.entries,
    });
    for (const entry of group.entries) {
      seen.add(entry.id);
    }
  }
  if (groups.length === 0) {
    return null;
  }
  return { groups, total: seen.size, href: `/evidence/?feeds=${feedKey(family, target)}` };
}

// ---------- A risk row's domain ----------

// The tab 7 domain a risk row stands for. null for case rows.
export function riskDomainFor(row: ScorecardRow): RiskDomain | null {
  for (const [domain, rowId] of Object.entries(RISK_ROW_BY_DOMAIN) as [RiskDomain, string][]) {
    if (rowId === row.id) {
      return domain;
    }
  }
  return null;
}

// How many of the workbook's risks name this family and sit in the row's domain.
export function riskCount(scorecard: ScorecardData, family: Family, row: ScorecardRow): number {
  const domain = riskDomainFor(row);
  return domain === null ? 0 : risksForFamily(scorecard, family, domain).length;
}

// The risk card's link to its domain's risks: "See the 4 governance risks",
// or "See the governance risk" when there is one.
export function riskLinkText(count: number, row: ScorecardRow): string {
  const domain = riskDomainFor(row);
  const label = domain === null ? "" : enumLabel("RiskDomain", domain);
  const domainWords = label ? `${label.charAt(0).toLowerCase()}${label.slice(1)} ` : "";
  if (count === 1) {
    return `See the ${domainWords}risk`;
  }
  return `See the ${count} ${domainWords}risks`;
}

// ---------- Which page a scorecard belongs to ----------

// The family of the technology with this name, or null. The cards read the
// workbook by family; the pages pass the name, so this finds the id.
export function familyForTechnology(technologies: { id: string; name: string }[], name: string): Family | null {
  const page = technologies.find((technology) => technology.name === name);
  if (!page || page.id === "hybrid") {
    return null;
  }
  return page.id as Family;
}

// ---------- The team's tracker ----------

// The milestones this rating informs, in the team's order. `items` are this
// technology's public milestones. An id that isn't among them is left out:
// the validator and the export already refuse or drop those, so this is only
// a safety net.
export function linkedMilestones(row: ScorecardRow, items: TimelineItem[]): TimelineItem[] {
  const linked: TimelineItem[] = [];
  for (const id of row.tracker?.milestone_ids ?? []) {
    for (const item of items) {
      if (item.milestone.id === id) {
        linked.push(item);
      }
    }
  }
  return linked;
}

// The claim that stands for "not assessed yet": unclear, because the search
// isn't finished. The same rule as is_not_assessed in shared/sf_shared/models.py,
// and as the dossier's placeholder claims. A missing claim isn't assessed either.
export function isNotAssessed(claim: Claim | null | undefined): boolean {
  if (!claim) {
    return true;
  }
  return claim.provenance === "unclear" && claim.unclear_reason === "search_incomplete";
}

// True when the team has put anything in the row's tracker. Without it the
// card shows no tracker at all: no "Not added yet" line and no ledger.
export function hasTrackerContent(row: ScorecardRow, milestones: TimelineItem[]): boolean {
  const tracker = row.tracker;
  if (!tracker) {
    return false;
  }
  return (
    tracker.placeholder === true ||
    !isNotAssessed(tracker.what_would_change) ||
    milestones.length > 0 ||
    Boolean(tracker.last_updated) ||
    (tracker.history ?? []).length > 0
  );
}

// What the tracker can't show yet, for its one "Not added yet" line, in the
// order the fields appear. The evidence is no longer a tracker field: it
// comes from the workbook's register.
export function notYetAssessed(row: ScorecardRow, milestones: TimelineItem[]): string[] {
  const missing: string[] = [];
  if (isNotAssessed(row.tracker?.what_would_change)) {
    missing.push("what would change the assessment");
  }
  if (milestones.length === 0) {
    missing.push("the milestones it informs");
  }
  return missing;
}

// The history is stored oldest first; the card shows the newest change first.
// A copy, so the content is never reordered in place.
export function newestFirst(history: RatingChange[]): RatingChange[] {
  return [...history].reverse();
}

export interface ChangeValue {
  label: "Rating" | "Confidence";
  before: string; // the written label, such as "Unclear"
  after: string;
  changed: boolean;
}

// One history entry's two values as labels, for the line "Rating: Unclear →
// Weak · Confidence unchanged". Only case rows keep a history.
export function changeValues(entry: RatingChange): ChangeValue[] {
  return [
    {
      label: "Rating",
      before: enumLabel("CaseRating", entry.rating_before),
      after: enumLabel("CaseRating", entry.rating_after),
      changed: entry.rating_before !== entry.rating_after,
    },
    {
      label: "Confidence",
      before: enumLabel("Confidence", entry.confidence_before),
      after: enumLabel("Confidence", entry.confidence_after),
      changed: entry.confidence_before !== entry.confidence_after,
    },
  ];
}
