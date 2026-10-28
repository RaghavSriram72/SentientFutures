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

// The opening sentences of a text, stopping once they reach `minLength`
// characters, so a terse first sentence ("Alignment.") brings its follow-up.
export function leadSentences(text: string, minLength: number): string {
  const sentences = text.match(/[^.?!]+[.?!]+(?=\s|$)/g);
  if (!sentences) {
    return text;
  }
  let lead = "";
  for (const sentence of sentences) {
    lead += sentence;
    if (lead.trim().length >= minLength) {
      break;
    }
  }
  return lead.trim();
}

// "a", "a and b", "a, b and c"
export function joinList(parts: string[]): string {
  if (parts.length <= 1) {
    return parts.join("");
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
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
