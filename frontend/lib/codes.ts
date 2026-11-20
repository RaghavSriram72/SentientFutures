// The workbook's codes as they appear in text, and where each one links.
// One shared place, so every page links "E037", "S13", "WBE-O-L1", "R01",
// "G15", "BCI-M1" and "WBE-O" the same way. Pure: no React, no data loading,
// so the tests can load it (tests/codes.test.ts runs every pattern over the
// workbook's own text).
//
// Rules:
//   - A code links only when it names something that exists (buildCodeIndex
//     lists them). Codes the workbook never defines (AM, D03, D05, A-X, N/A,
//     WBE-C, BCI-U) stay plain text.
//   - Sources are two digits after S ("S13"). Stage codes ("S1" to "S6") are
//     one digit, so they are never read as sources.
//   - A range like "S20-S22" or "R01-R06" links each end and keeps its text;
//     for id lists (idsIn) it stands for every id in between.
//   - Shorthands like "WBE-O/R/G" are left alone, never expanded.
// The paths have no base path: next/link adds it.
import { shortCitation, type SourceRef } from "./sources";
import type { Family, ScorecardData } from "./types";

// ---------- Patterns ----------

const PREFIX = "(?:WBE|BCI|NM)";

// Each pattern matches one code, with word boundaries. Global, for matchAll.
export const CODE_PATTERNS = {
  // A causal link: "WBE-O-L1".
  link: new RegExp(`\\b${PREFIX}-[A-Z]-L\\d+\\b`, "g"),
  // A milestone row named with its family: "BCI-M1".
  milestone: new RegExp(`\\b${PREFIX}-M\\d+\\b`, "g"),
  // A scenario: "WBE-O". Not when it starts a link id or a slash shorthand ("WBE-O/R/G").
  scenario: new RegExp(`\\b${PREFIX}-[A-Z]\\b(?![-/][A-Za-z0-9])`, "g"),
  // An evidence register entry: "E037".
  entry: /\bE\d{3}\b/g,
  // A source: "S13". Exactly two digits, so the stage codes S1 to S6 never match.
  source: /\bS\d{2}\b/g,
  // A risk: "R01".
  risk: /\bR\d{2}\b/g,
  // A governance checklist item: "G15".
  governance: /\bG\d{2}\b/g,
} as const;

export type CodeKind = keyof typeof CODE_PATTERNS;

// The order the combined pattern tries them in: longer codes first, so
// "WBE-O-L1" is one link, not the scenario "WBE-O" followed by text.
const KIND_ORDER: CodeKind[] = ["link", "milestone", "scenario", "entry", "source", "risk", "governance"];

function combinedPattern(): RegExp {
  const parts: string[] = [];
  for (const kind of KIND_ORDER) {
    parts.push(`(?<${kind}>${CODE_PATTERNS[kind].source})`);
  }
  return new RegExp(parts.join("|"), "g");
}

const ANY_CODE = combinedPattern();

// "S20-S22", "R01-R06", "E001-E004": two codes of the same kind joined by a hyphen.
const RANGE = /\b([ESRG])(\d{2,3})-\1(\d{2,3})\b/g;

// ---------- Finding codes ----------

export interface FoundCode {
  kind: CodeKind;
  code: string;
  index: number; // where it starts in the text
  // True when it is one end of a range ("S20" in "S20-S22").
  inRange: boolean;
}

// Every code in the text, in order. Nothing is expanded.
export function findCodes(text: string): FoundCode[] {
  const rangeEnds = new Set<number>();
  for (const match of text.matchAll(RANGE)) {
    if (match.index === undefined) {
      continue;
    }
    const first = match[1] + match[2];
    rangeEnds.add(match.index);
    rangeEnds.add(match.index + first.length + 1);
  }

  const found: FoundCode[] = [];
  for (const match of text.matchAll(ANY_CODE)) {
    if (match.index === undefined || !match.groups) {
      continue;
    }
    for (const kind of KIND_ORDER) {
      const code = match.groups[kind];
      if (code !== undefined) {
        found.push({ kind, code, index: match.index, inRange: rangeEnds.has(match.index) });
        break;
      }
    }
  }
  return found;
}

// "S24-S29" -> ["S24", "S25", ..., "S29"], keeping the number of digits.
function expandRange(letter: string, from: string, to: string): string[] {
  const start = Number(from);
  const end = Number(to);
  const width = from.length;
  if (end < start || end - start > 200) {
    // A backwards or huge range is a typo: keep just its two ends.
    return [letter + from, letter + to];
  }
  const ids: string[] = [];
  for (let number = start; number <= end; number += 1) {
    ids.push(letter + String(number).padStart(width, "0"));
  }
  return ids;
}

// The ids of one kind the text names, ranges expanded, each once, in text order.
// idsIn("(S20-S22); S13", "source") -> ["S20", "S21", "S22", "S13"].
export function idsIn(text: string, kind: CodeKind): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) {
      ids.push(id);
    }
  };
  const ranges: { index: number; ids: string[]; end: number }[] = [];
  for (const match of text.matchAll(RANGE)) {
    if (match.index !== undefined) {
      ranges.push({ index: match.index, ids: expandRange(match[1], match[2], match[3]), end: match.index + match[0].length });
    }
  }
  for (const found of findCodes(text)) {
    if (found.kind !== kind) {
      continue;
    }
    const range = ranges.find((item) => item.index === found.index);
    if (range) {
      range.ids.forEach(add);
    } else if (!ranges.some((item) => found.index > item.index && found.index < item.end)) {
      add(found.code);
    }
  }
  return ids;
}

// The register ids of the sources a text names: registerIdsIn("S24-S29") is S24 to S29.
export function registerIdsIn(text: string): string[] {
  return idsIn(text, "source");
}

// ---------- Where codes point ----------

// The page path for a family ("neuromorphic" -> "/neuromorphic/").
export function familyPath(family: Family): string {
  return `/${family}/`;
}

const FAMILY_BY_PREFIX: Record<string, Family> = { WBE: "wbe", BCI: "bci", NM: "neuromorphic" };

// The family a code's prefix names: "NM-A-L1" -> "neuromorphic". null without one.
export function familyOfCode(code: string): Family | null {
  const prefix = code.split("-")[0];
  return FAMILY_BY_PREFIX[prefix] ?? null;
}

// The element ids (anchors). Lowercase, so "WBE-O-L1" is #link-wbe-o-l1.
export function entryAnchor(entryId: string): string {
  return entryId.toLowerCase();
}

export function linkAnchor(linkId: string): string {
  return `link-${linkId.toLowerCase()}`;
}

export function pathwayAnchor(scenarioCode: string): string {
  return `pathway-${scenarioCode.toLowerCase()}`;
}

export function riskAnchor(riskId: string): string {
  return `risk-${riskId.toLowerCase()}`;
}

export function governanceAnchor(itemId: string): string {
  return `governance-${itemId.toLowerCase()}`;
}

// A family's milestone row: "milestone-bci-m1". A split row (BCI M1 and NM M1
// have two) adds its place among them: "milestone-bci-m1-1", "-2".
export function milestoneAnchor(family: Family, milestone: string, part: number | null = null): string {
  const base = `milestone-${family}-${milestone.toLowerCase()}`;
  return part === null ? base : `${base}-${part}`;
}

export function entryHref(entryId: string): string {
  return `/evidence/#${entryAnchor(entryId)}`;
}

export function sourceHref(sourceId: string): string {
  return `/sources/#${sourceId}`;
}

export function linkHref(linkId: string): string | null {
  const family = familyOfCode(linkId);
  return family === null ? null : `${familyPath(family)}#${linkAnchor(linkId)}`;
}

export function pathwayHref(scenarioCode: string): string | null {
  const family = familyOfCode(scenarioCode);
  return family === null ? null : `${familyPath(family)}#${pathwayAnchor(scenarioCode)}`;
}

export function riskHref(riskId: string, family: Family): string {
  return `${familyPath(family)}#${riskAnchor(riskId)}`;
}

export function governanceHref(itemId: string, family: Family): string {
  return `${familyPath(family)}#${governanceAnchor(itemId)}`;
}

export function milestoneHref(family: Family, milestone: string, part: number | null = null): string {
  return `${familyPath(family)}#${milestoneAnchor(family, milestone, part)}`;
}

// ---------- The index of codes that exist ----------

export interface CodeTarget {
  href: string;
  // Read out and shown on hover: a source's short citation ("Sandberg 2008").
  title?: string;
}

// Plain data (no Sets or Maps), so a server page can hand it to a client component.
export interface CodeIndex {
  // Codes with one target: entries, links, governance items, milestone rows, scenarios with a pathway.
  targets: Record<string, CodeTarget>;
  // A risk can sit on several family pages, so its link depends on the page.
  riskFamilies: Record<string, Family[]>;
  // "S13" -> its source.
  sources: Record<string, CodeTarget>;
}

// Which part of a split milestone row each (family, milestone) gets: null
// when the family has one row for it, 1, 2, ... when it has several.
export function milestoneParts(rows: { family: Family; milestone: string }[]): (number | null)[] {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.family} ${row.milestone}`;
    totals[key] = (totals[key] ?? 0) + 1;
  }
  const seen: Record<string, number> = {};
  const parts: (number | null)[] = [];
  for (const row of rows) {
    const key = `${row.family} ${row.milestone}`;
    seen[key] = (seen[key] ?? 0) + 1;
    parts.push(totals[key] > 1 ? seen[key] : null);
  }
  return parts;
}

const PREFIX_BY_FAMILY: Record<Family, string> = { wbe: "WBE", bci: "BCI", neuromorphic: "NM" };

// Everything the workbook defines, with where it links. sources are the
// site's sources (register id -> page), so "S17" links once S17 is added.
export function buildCodeIndex(scorecard: ScorecardData, sources: SourceRef[]): CodeIndex {
  const targets: Record<string, CodeTarget> = {};
  for (const entry of scorecard.entries ?? []) {
    targets[entry.id] = { href: entryHref(entry.id) };
  }
  for (const link of scorecard.links ?? []) {
    targets[link.id] = { href: `${familyPath(link.family)}#${linkAnchor(link.id)}` };
    // A scenario code links to its pathway once the scenario has links.
    if (targets[link.scenario_code] === undefined) {
      targets[link.scenario_code] = { href: `${familyPath(link.family)}#${pathwayAnchor(link.scenario_code)}` };
    }
  }
  for (const item of scorecard.governance ?? []) {
    targets[item.id] = { href: governanceHref(item.id, item.family) };
  }
  // "BCI-M1" goes to the first of BCI's M1 rows.
  const rows = scorecard.milestone_assessments ?? [];
  const parts = milestoneParts(rows);
  rows.forEach((row, index) => {
    const code = `${PREFIX_BY_FAMILY[row.family]}-${row.milestone}`;
    if (targets[code] === undefined) {
      targets[code] = { href: milestoneHref(row.family, row.milestone, parts[index]) };
    }
  });

  const riskFamilies: Record<string, Family[]> = {};
  for (const risk of scorecard.risks ?? []) {
    riskFamilies[risk.id] = [...risk.families];
  }

  const sourceTargets: Record<string, CodeTarget> = {};
  for (const source of sources) {
    if (source.register_id && !source.sample) {
      sourceTargets[source.register_id] = { href: sourceHref(source.id), title: shortCitation(source) };
    }
  }
  return { targets, riskFamilies, sources: sourceTargets };
}

// Where one found code links, or null when it names nothing that exists.
// `family` is the page the text sits on: a risk links to that page when it
// belongs there, otherwise to its first family.
export function resolveCode(found: FoundCode, index: CodeIndex, family: Family | null = null): CodeTarget | null {
  if (found.kind === "source") {
    return index.sources[found.code] ?? null;
  }
  if (found.kind === "risk") {
    const families = index.riskFamilies[found.code];
    if (!families || families.length === 0) {
      return null;
    }
    const page = family !== null && families.includes(family) ? family : families[0];
    return { href: riskHref(found.code, page) };
  }
  return index.targets[found.code] ?? null;
}

// ---------- Splitting text for rendering ----------

export interface TextPart {
  text: string;
  // Set when this part is a code that links somewhere.
  code?: FoundCode;
  target?: CodeTarget;
}

// The text cut into plain parts and linked codes. Joining every part's text
// gives back the text exactly: nothing is added, dropped or reworded.
export function splitCodes(text: string, index: CodeIndex, family: Family | null = null): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const found of findCodes(text)) {
    const target = resolveCode(found, index, family);
    if (target === null) {
      continue;
    }
    if (found.index > last) {
      parts.push({ text: text.slice(last, found.index) });
    }
    parts.push({ text: found.code, code: found, target });
    last = found.index + found.code.length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last) });
  }
  return parts;
}
