// Small text helpers shared by the technology page components, and the
// lines the hero box builds from the scorecard rows. Pure: no React, so
// tests/techText.test.ts can load it. Every line states what the rows say
// (confidence, severity, likelihood) and adds no judgment.
import { enumLabel } from "@/lib/enums";
import type { ScorecardRow } from "@/lib/types";

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

// "six" for small counts, "12" for the rest
export function countWord(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// "a", "a and b", "a, b and c"
export function joinList(parts: string[]): string {
  if (parts.length <= 1) {
    return parts.join("");
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// "1 link", "7 links": a count with its noun, digits always.
export function countNoun(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------- The hero box ("Where we land") ----------

// A risk row the workbook marks "Not applicable" (BCI, artificial minds).
export function isNotApplicable(row: ScorecardRow): boolean {
  return row.scale === "risk" && row.applicable === false;
}

// The rows the shared confidence line speaks for: every row except one the
// workbook marks "Not applicable", whose confidence the hero doesn't show.
function confidenceRows(rows: ScorecardRow[]): ScorecardRow[] {
  return rows.filter((row) => !isNotApplicable(row));
}

// One line for a confidence every row shares, so the rows don't each repeat
// it. The patterns:
//   "Low confidence in all six."           (every row counted)
//   "Low confidence in both."
//   "Low confidence in all five that apply." (a Not applicable row left out)
// null when the rows differ (each row then says its own) or fewer than two count.
export function sharedConfidence(rows: ScorecardRow[]): string | null {
  const counted = confidenceRows(rows);
  if (counted.length < 2) {
    return null;
  }
  const first = counted[0].confidence;
  for (const row of counted) {
    if (row.confidence !== first) {
      return null;
    }
  }
  const scope = counted.length === 2 ? "both" : `all ${countWord(counted.length)}`;
  const apply = counted.length < rows.length ? " that apply" : "";
  return `${enumLabel("Confidence", first)} confidence in ${scope}${apply}.`;
}

// The small line under a hero row.
//   Case row: nothing when the confidence is shared, else "Low confidence".
//   Risk row: "Severity high · Likelihood not assessable", plus
//     " · Low confidence" when the confidence isn't shared. "Severity" and
//     "Likelihood" are the workbook's own headers; the values are its labels.
//   Not applicable risk row: "Not applicable", the workbook's own value.
// It comes as its separate parts, so a page can keep each part on one line
// when the whole line wraps (sections/MetaParts.tsx joins them with " · ").
// No parts means no line.
export function rowMetaParts(row: ScorecardRow, confidenceShared: boolean): string[] {
  if (isNotApplicable(row)) {
    return ["Not applicable"];
  }
  const parts: string[] = [];
  if (row.scale === "risk") {
    if (row.severity) {
      parts.push(`Severity ${enumLabel("Severity", row.severity).toLowerCase()}`);
    }
    if (row.likelihood) {
      parts.push(`Likelihood ${enumLabel("Likelihood", row.likelihood).toLowerCase()}`);
    }
  }
  if (!confidenceShared) {
    parts.push(`${enumLabel("Confidence", row.confidence)} confidence`);
  }
  return parts;
}
