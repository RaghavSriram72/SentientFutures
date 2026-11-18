// Small text helpers shared by the technology page components.
import { enumDescription } from "@/lib/enums";
import type { ScorecardRow, UnclearReason } from "@/lib/types";

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

// What an Unclear rating still needs, by its reason. Only reasons that name a
// gap the team has found are here. "Search incomplete" means we haven't
// finished looking, so those ratings keep the older wording.
const STILL_NEEDS: Partial<Record<UnclearReason, { one: string; many: string }>> = {
  underspecified_proposal: {
    one: "needs a more specific proposal before it can be judged",
    many: "need a more specific proposal before they can be judged",
  },
  no_relevant_evidence: {
    one: "needs evidence we haven't found yet",
    many: "need evidence we haven't found yet",
  },
};

// What the ratings are missing, most common reason first: "four need a more
// specific proposal before they can be judged, and two need evidence we
// haven't found yet", or "all six need ..." when they share one reason.
// null unless every rating is Unclear for a reason in STILL_NEEDS.
export function stillNeedsClauses(rows: ScorecardRow[]): string | null {
  const counts = new Map<UnclearReason, number>();
  for (const row of rows) {
    if (row.rating !== "unclear" || !row.unclear_reason || !STILL_NEEDS[row.unclear_reason]) {
      return null;
    }
    counts.set(row.unclear_reason, (counts.get(row.unclear_reason) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return null;
  }
  const mostCommonFirst = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const clauses: string[] = [];
  for (const [reason, count] of mostCommonFirst) {
    const wording = STILL_NEEDS[reason];
    if (!wording) {
      return null;
    }
    const howMany = count === rows.length ? `all ${countWord(count)}` : countWord(count);
    clauses.push(`${howMany} ${count === 1 ? wording.one : wording.many}`);
  }
  return clauses.join(", and ");
}

// The reason given most often for an Unclear rating, as a sentence, or "" when
// nothing is Unclear or the reason is "Other" (which only makes sense with its note).
export function unclearReasonSentence(rows: ScorecardRow[]): string {
  const counts = new Map<UnclearReason, number>();
  let unclearTotal = 0;
  for (const row of rows) {
    if (row.rating === "unclear" && row.unclear_reason) {
      unclearTotal += 1;
      counts.set(row.unclear_reason, (counts.get(row.unclear_reason) ?? 0) + 1);
    }
  }
  let topReason: UnclearReason | null = null;
  let topCount = 0;
  for (const [reason, count] of counts) {
    if (count > topCount) {
      topReason = reason;
      topCount = count;
    }
  }
  if (topReason === null || topReason === "other") {
    return "";
  }
  // "The proposal isn't specific enough to assess." -> "the proposal isn't specific enough to assess"
  const why = lowerFirst(enumDescription("UnclearReason", topReason)).replace(/\.$/, "");
  if (topCount === unclearTotal) {
    return `In each case the reason is that ${why}.`;
  }
  return `For ${countWord(topCount)} of them, the reason is that ${why}.`;
}
