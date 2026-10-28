// What the timeline shows for each milestone, worked out from the stored data at
// render time. Nothing here is ever stored. The methodology page prints the same
// rule text, so if you change the logic, change DISAGREEMENT_RULE_TEXT too.
//
// Display rule, in the words of the track's Key:
//   achieved_in set          -> "achieved": a dot at that year
//   team estimate            -> "team": a solid ribbon (latest null = it fades out on the right)
//   2+ forecasts, no flag    -> "span": a faint ribbon over the forecasts' full span
//                               (no ribbon if the rule flags them, even when the team
//                               overrides the flag: a ribbon would merge them anyway;
//                               and no ribbon if the span is open on both sides)
//   1+ forecasts             -> "whiskers": thin lines only, one per forecast
//   nothing                  -> "none": the card stands in the Timing unknown zone
// Forecasts are always drawn one by one, whatever the mode. "Never" forecasts
// are crosses in the Never zone. Disagreement is worked out separately, so a
// team range never hides it. (The mode names are code only; readers never see them.)
import type { Claim, Forecast, Milestone } from "./types";

// v0.2: two forecasts count as the same forecaster only when the name and the
// source both match (v0.1 matched the name alone).
export const DISAGREEMENT_RULE_VERSION = "0.2";
export const DISAGREEMENT_GAP_YEARS = 10;

export const DISAGREEMENT_RULE_TEXT: string[] = [
  "We compare every pair of forecasts, except two from the same forecaster in the same source, like one report's optimistic and pessimistic cases.",
  "The same name in two different sources counts as two different forecasters. Two surveys can both report a “median respondent”, and those answers get compared.",
  "A pair disagrees if one forecaster says it will never happen and the other gives a year.",
  `A pair also disagrees if their windows are more than ${DISAGREEMENT_GAP_YEARS} years apart, measured from the end of the earlier window to the start of the later one.`,
  "An open end (“by 2045” or “not before 2045”) counts as unbounded, so it can never create a gap in that direction.",
  "If any pair disagrees, the milestone gets a SOURCES DISAGREE stamp and no faint ribbon. Even if the team decides the forecasts aren't really in conflict, we don't draw one, because it would blur them into one range.",
  "A faint ribbon needs at least two forecasts, no disagreeing pair and no team range. It runs from the earliest year any forecast allows to the latest. If any forecast is open on one side, the ribbon is open on that side too. If that leaves it open on both sides, we skip the ribbon and show the forecasts alone.",
  "The team can override the rule either way, but only with a published reason. The milestone then says whether the flag came from our rule or from the team, and what the rule alone would have said.",
  "A team range never hides a disagreement. The stamp and every individual forecast stay visible.",
];

export type BarMode = "team" | "span" | "whiskers" | "none" | "achieved";

// A ribbon's years. null means open-ended on that side: start null runs back
// to the start of the track ("by 2045"), end null fades out on the right
// ("not before 2035").
export interface BarRange {
  start: number | null;
  end: number | null;
}

export interface ForecastView extends Forecast {
  // The forecast window ended before this year and the milestone still isn't achieved.
  isExpired: boolean;
}

export interface DisagreementView {
  flagged: boolean;
  decidedBy: "rule" | "team" | null;
  // What the rule alone says, kept even when the team overrides it.
  ruleFlagged: boolean;
  // One sentence per disagreeing pair, e.g. "Example Skeptic says never, while Example Author gives 2045 to 2060"
  reasons: string[];
  overrideBasis: Claim | null;
}

export interface MilestoneView {
  barMode: BarMode;
  bar: BarRange | null;
  achievedIn: number | null;
  forecasts: ForecastView[];
  forecastCount: number;
  sourceCount: number;
  expiredCount: number;
  disagreement: DisagreementView;
}

// "2045 to 2060", "by 2045", "not before 2045", "in 2045" or "never".
export function formatWindow(forecast: Pick<Forecast, "earliest" | "latest" | "never">): string {
  if (forecast.never) {
    return "never";
  }
  return formatYears(forecast.earliest, forecast.latest);
}

export function formatYears(earliest: number | null, latest: number | null): string {
  if (earliest !== null && latest !== null) {
    if (earliest === latest) {
      return `in ${earliest}`;
    }
    return `${earliest} to ${latest}`;
  }
  if (earliest === null && latest !== null) {
    return `by ${latest}`;
  }
  if (earliest !== null && latest === null) {
    return `not before ${earliest}`;
  }
  return "no years given";
}

// "1 forecast" / "3 forecasts", and the same for sources.
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// "3 forecasts from 2 sources"
export function countLabel(view: MilestoneView): string {
  const forecasts = pluralize(view.forecastCount, "forecast", "forecasts");
  const sources = pluralize(view.sourceCount, "source", "sources");
  return `${forecasts} from ${sources}`;
}

function isForecastExpired(forecast: Forecast, nowYear: number, achieved: boolean): boolean {
  if (achieved || forecast.never || forecast.latest === null) {
    return false;
  }
  return forecast.latest < nowYear;
}

function sameName(a: Forecast, b: Forecast): boolean {
  return a.forecaster.trim().toLowerCase() === b.forecaster.trim().toLowerCase();
}

// The rule skips a pair only when both the name and the source match. A shared
// label like "Median survey respondent" across two surveys is two forecasters.
export function sameForecaster(a: Forecast, b: Forecast): boolean {
  return a.source_id === b.source_id && sameName(a, b);
}

function givesAYear(forecast: Forecast): boolean {
  return !forecast.never && (forecast.earliest !== null || forecast.latest !== null);
}

// The gap in years between two windows, using only defined bounds. A null bound
// is unbounded, so it can't produce a gap in that direction. Returns null when
// no pair of bounds can be compared.
export function windowGap(a: Forecast, b: Forecast): number | null {
  let gap: number | null = null;
  if (b.earliest !== null && a.latest !== null) {
    gap = b.earliest - a.latest;
  }
  if (a.earliest !== null && b.latest !== null) {
    const otherWay = a.earliest - b.latest;
    gap = gap === null ? otherWay : Math.max(gap, otherWay);
  }
  return gap;
}

// The name to use for `other` in a reason sentence. When both share a name but
// come from different sources, say so, or the sentence reads like one person.
function otherLabel(first: Forecast, other: Forecast): string {
  if (sameName(first, other)) {
    return `${other.forecaster} (another source)`;
  }
  return other.forecaster;
}

// Returns a human-readable reason when the pair disagrees under the current
// rule (DISAGREEMENT_RULE_VERSION), or null.
function pairDisagreement(a: Forecast, b: Forecast): string | null {
  if (sameForecaster(a, b)) {
    return null;
  }
  if (a.never && givesAYear(b)) {
    return `${a.forecaster} says never, while ${otherLabel(a, b)} gives ${formatWindow(b)}`;
  }
  if (b.never && givesAYear(a)) {
    return `${b.forecaster} says never, while ${otherLabel(b, a)} gives ${formatWindow(a)}`;
  }
  if (a.never || b.never) {
    return null;
  }
  const gap = windowGap(a, b);
  if (gap === null || gap <= DISAGREEMENT_GAP_YEARS) {
    return null;
  }
  // Name the earlier window first so the sentence reads in time order.
  const aFirst = (a.latest ?? a.earliest ?? 0) <= (b.latest ?? b.earliest ?? 0);
  const first = aFirst ? a : b;
  const second = aFirst ? b : a;
  return `${first.forecaster} gives ${formatWindow(first)} and ${otherLabel(first, second)} gives ${formatWindow(second)}, with ${gap} years between them`;
}

export function computeDisagreement(milestone: Milestone): DisagreementView {
  const reasons: string[] = [];
  const forecasts = milestone.forecasts;
  for (let i = 0; i < forecasts.length; i++) {
    for (let j = i + 1; j < forecasts.length; j++) {
      const reason = pairDisagreement(forecasts[i], forecasts[j]);
      if (reason !== null) {
        reasons.push(reason);
      }
    }
  }
  const ruleFlagged = reasons.length > 0;

  const override = milestone.disagreement_override;
  if (override) {
    return {
      flagged: override.flagged,
      decidedBy: "team",
      ruleFlagged,
      reasons,
      overrideBasis: override.basis,
    };
  }
  return {
    flagged: ruleFlagged,
    decidedBy: ruleFlagged ? "rule" : null,
    ruleFlagged,
    reasons,
    overrideBasis: null,
  };
}

// The faint ribbon: every year any dated forecast allows, from the smallest
// earliest to the largest latest. A null bound is unbounded, so if any forecast
// is open on a side ("by 2045" on the left), the ribbon is open on that side too.
// Open on both sides would run the whole length of the track and say nothing,
// so that gives no ribbon. "Never" forecasts have no years and are left out.
function forecastSpan(forecasts: Forecast[]): BarRange | null {
  let start: number | null = null;
  let end: number | null = null;
  let openLeft = false;
  let openRight = false;
  let hasDated = false;
  for (const forecast of forecasts) {
    if (forecast.never) {
      continue;
    }
    hasDated = true;
    if (forecast.earliest === null) {
      openLeft = true;
    } else {
      start = start === null ? forecast.earliest : Math.min(start, forecast.earliest);
    }
    if (forecast.latest === null) {
      openRight = true;
    } else {
      end = end === null ? forecast.latest : Math.max(end, forecast.latest);
    }
  }
  if (!hasDated) {
    return null;
  }
  if (openLeft) {
    start = null;
  }
  if (openRight) {
    end = null;
  }
  if (start === null && end === null) {
    return null;
  }
  return { start, end };
}

export function computeMilestoneView(milestone: Milestone, nowYear: number): MilestoneView {
  const achieved = milestone.achieved_in !== null;

  const forecasts: ForecastView[] = [];
  const sourceIds = new Set<string>();
  let expiredCount = 0;
  for (const forecast of milestone.forecasts) {
    const isExpired = isForecastExpired(forecast, nowYear, achieved);
    if (isExpired) {
      expiredCount += 1;
    }
    sourceIds.add(forecast.source_id);
    forecasts.push({ ...forecast, isExpired });
  }

  const disagreement = computeDisagreement(milestone);

  let barMode: BarMode = "none";
  let bar: BarRange | null = null;
  if (achieved) {
    barMode = "achieved";
  } else if (milestone.estimate) {
    barMode = "team";
    bar = { start: milestone.estimate.earliest, end: milestone.estimate.latest };
  } else if (forecasts.length >= 2 && !disagreement.flagged && !disagreement.ruleFlagged) {
    bar = forecastSpan(forecasts);
    // No span to draw (every forecast says never, or together they're open on
    // both sides), so fall back to thin lines alone.
    barMode = bar ? "span" : "whiskers";
  } else if (forecasts.length >= 1) {
    barMode = "whiskers";
  }

  return {
    barMode,
    bar,
    achievedIn: milestone.achieved_in,
    forecasts,
    forecastCount: forecasts.length,
    sourceCount: sourceIds.size,
    expiredCount,
    disagreement,
  };
}

// The year a milestone "starts" on the timeline, used to sort tracks within a
// technology. null (nothing dated) sorts last.
export function earliestRelevantYear(view: MilestoneView): number | null {
  if (view.achievedIn !== null) {
    return view.achievedIn;
  }
  if (view.bar && view.bar.start !== null) {
    return view.bar.start;
  }
  let earliest: number | null = null;
  for (const forecast of view.forecasts) {
    if (forecast.never) {
      continue;
    }
    const year = forecast.earliest ?? forecast.latest;
    if (year !== null && (earliest === null || year < earliest)) {
      earliest = year;
    }
  }
  if (earliest === null && view.bar && view.bar.end !== null) {
    return view.bar.end;
  }
  return earliest;
}
