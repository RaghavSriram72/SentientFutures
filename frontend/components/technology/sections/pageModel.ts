// Pure helpers for the technology page's workbook sections: counts, lists of
// codes and lookups. No React and no file reading, so tests/pageModel.test.ts
// can load it. Nothing here sorts, merges or reconciles two workbook tabs.
import { CODEBOOK_FAMILY, type MilestoneRow } from "@/lib/workbook";
import type { CodebookRow, Family, MilestoneCategory, RiskDomain, ScorecardData } from "@/lib/types";

// A count per value, in the scale's own order, leaving out zeros.
export function countList<T extends string>(
  counts: Partial<Record<T, number>>,
  order: readonly T[],
): { value: T; count: number }[] {
  const list: { value: T; count: number }[] = [];
  for (const value of order) {
    const count = counts[value] ?? 0;
    if (count > 0) {
      list.push({ value, count });
    }
  }
  return list;
}

// How many milestones the family's tab 1a rows cover. A split milestone
// (BCI M1 has two rows) counts once.
export function milestoneCount(rows: MilestoneRow[]): number {
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.assessment.milestone);
  }
  return seen.size;
}

// The workbook's own words for a risk's families, in cell order:
// ["wbe", "neuromorphic", "bci"] -> "WBE; Neuromorphic AI; BCI".
export function familyCell(families: Family[]): string {
  return families.map((family) => CODEBOOK_FAMILY[family]).join("; ");
}

// The id of a risk domain's group in "Welfare and governance risks", where
// a risk card's link lands: "human_welfare" -> "risks-human-welfare".
export function riskDomainAnchor(domain: RiskDomain): string {
  return `risks-${domain.replace(/_/g, "-")}`;
}

// Site source ids as the register writes them: ["s16", "s22"] -> "S16, S22".
// A source the site doesn't have is left out (the validator stops that).
export function registerIdText(sourceIds: string[], registerIds: Record<string, string | null>): string {
  const ids: string[] = [];
  for (const id of sourceIds) {
    const registerId = registerIds[id];
    if (registerId) {
      ids.push(registerId);
    }
  }
  return ids.join(", ");
}

// A list of entry ids as text CodeText can link: ["E043", "E065"] -> "E043, E065".
export function idText(ids: string[] | undefined): string {
  return (ids ?? []).join(", ");
}

// The timeline milestone of each category, for the "On the timeline" link in
// a tab 1a row. Only categories with exactly one timeline milestone get one;
// with two or more, which one a row means would be a guess.
export interface TimelineRef {
  id: string; // the milestone's slug, its anchor on /timeline/
  code: string; // the timeline's display code, "WBE-02"
  category: MilestoneCategory;
}

export function timelineRefByCategory(refs: TimelineRef[]): Partial<Record<MilestoneCategory, TimelineRef>> {
  const counts: Partial<Record<MilestoneCategory, number>> = {};
  for (const ref of refs) {
    counts[ref.category] = (counts[ref.category] ?? 0) + 1;
  }
  const byCategory: Partial<Record<MilestoneCategory, TimelineRef>> = {};
  for (const ref of refs) {
    if (counts[ref.category] === 1) {
      byCategory[ref.category] = ref;
    }
  }
  return byCategory;
}

// The lowest and highest of a set of codes like "E001" or "S13", by number,
// for the marks help ("E001 to E121"). null for an empty set.
export function idRange(ids: string[]): [string, string] | null {
  const numbered: { id: string; number: number }[] = [];
  for (const id of ids) {
    const number = Number(id.replace(/^\D+/, ""));
    if (!Number.isNaN(number)) {
      numbered.push({ id, number });
    }
  }
  if (numbered.length === 0) {
    return null;
  }
  let low = numbered[0];
  let high = numbered[0];
  for (const item of numbered) {
    if (item.number < low.number) {
      low = item;
    }
    if (item.number > high.number) {
      high = item;
    }
  }
  return [low.id, high.id];
}

// Element ids must be unique on a page. Two pathways could share a scenario
// code in a later workbook; only the first then keeps the anchor.
export function firstOnly(ids: string[]): (string | undefined)[] {
  const seen = new Set<string>();
  return ids.map((id) => {
    if (seen.has(id)) {
      return undefined;
    }
    seen.add(id);
    return id;
  });
}

// The Codebook's stage rows for one family ("S1 Read-only / passive
// decoding"), in sheet order, for the marks help. Stage codes mean different
// things per family, so only the family's own rows count.
export function familyStages(scorecard: ScorecardData, family: Family): CodebookRow[] {
  return (scorecard.codebook ?? []).filter((row) => row.type === "Stage" && row.family === CODEBOOK_FAMILY[family]);
}
