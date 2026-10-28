// Groups milestones by technology, gives each one its display code ("WBE-01")
// and sorts them. Shared by the 3D track, the home page teaser, the list, the
// dossier and the technology pages, so all of them agree. Pure functions, no React.
import { enumLabel } from "@/lib/enums";
import {
  computeMilestoneView,
  earliestRelevantYear,
  type ForecastView,
  type MilestoneView,
} from "@/lib/estimates";
import type { Milestone, Stage, Technology } from "@/lib/types";

// Group order on the timeline. Hybrid only shows up when there is a hybrid milestone.
export const TECHNOLOGY_ORDER: Technology[] = ["wbe", "bci", "neuromorphic", "hybrid"];

// Prefix for the display code. Codes are computed, never stored.
const CODE_PREFIX: Record<Technology, string> = {
  wbe: "WBE",
  bci: "BCI",
  neuromorphic: "NEURO",
  hybrid: "HYBRID",
};

// The short key the CSS uses for each stage's colors (stage_possible and so on).
export type StageKey = "possible" | "widely" | "helping";

export function stageKey(stage: Stage): StageKey {
  if (stage === "widely_available") {
    return "widely";
  }
  if (stage === "actually_helping") {
    return "helping";
  }
  return "possible";
}

export interface TimelineItem {
  milestone: Milestone;
  view: MilestoneView;
  code: string;
}

export interface TimelineGroup {
  technology: Technology;
  label: string;
  items: TimelineItem[];
}

function twoDigits(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Sort by the earliest relevant year; undated milestones go last. Ties keep
// file order (Array.prototype.sort is stable).
function compareItems(a: TimelineItem, b: TimelineItem): number {
  const yearA = earliestRelevantYear(a.view);
  const yearB = earliestRelevantYear(b.view);
  if (yearA === null && yearB === null) {
    return 0;
  }
  if (yearA === null) {
    return 1;
  }
  if (yearB === null) {
    return -1;
  }
  return yearA - yearB;
}

export function buildTimeline(milestones: Milestone[], nowYear: number): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const technology of TECHNOLOGY_ORDER) {
    const items: TimelineItem[] = [];
    // The code number follows file order within a technology, so it stays put
    // when estimates change and the track moves.
    let index = 0;
    for (const milestone of milestones) {
      if (milestone.technology !== technology) {
        continue;
      }
      index += 1;
      items.push({
        milestone,
        view: computeMilestoneView(milestone, nowYear),
        code: `${CODE_PREFIX[technology]}-${twoDigits(index)}`,
      });
    }
    if (items.length === 0) {
      continue;
    }
    items.sort(compareItems);
    groups.push({ technology, label: enumLabel("Technology", technology), items });
  }
  return groups;
}

export function indexItems(groups: TimelineGroup[]): Record<string, TimelineItem> {
  const byId: Record<string, TimelineItem> = {};
  for (const group of groups) {
    for (const item of group.items) {
      byId[item.milestone.id] = item;
    }
  }
  return byId;
}

export function flattenItems(groups: TimelineGroup[]): TimelineItem[] {
  const all: TimelineItem[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      all.push(item);
    }
  }
  return all;
}

// Milestones that list this one in depends_on.
export function dependents(milestoneId: string, groups: TimelineGroup[]): TimelineItem[] {
  const found: TimelineItem[] = [];
  for (const item of flattenItems(groups)) {
    if (item.milestone.depends_on.includes(milestoneId)) {
      found.push(item);
    }
  }
  return found;
}

// Forecasts in window order, earliest first and "never" last. The track draws
// each forecast's thin line in this order, and the list and the dossier ledger
// use the same order.
export function sortForecastsByWindow(forecasts: ForecastView[]): ForecastView[] {
  const sorted = forecasts.slice();
  sorted.sort((a, b) => windowStart(a) - windowStart(b));
  return sorted;
}

function windowStart(forecast: ForecastView): number {
  if (forecast.never) {
    return Number.POSITIVE_INFINITY;
  }
  return forecast.earliest ?? forecast.latest ?? Number.POSITIVE_INFINITY;
}

// True when a milestone has something the track can put on the dates: the
// year it was reached, a team range or at least one forecast.
export function hasEstimate(item: TimelineItem): boolean {
  return item.view.barMode !== "none";
}

// All the years the forecasts allow, as one phrase: "2028 to 2032",
// "2032 to never", "2035 onward", "by 2045" or "never". Nothing is averaged;
// this is the outer edge of every window, for a one-line summary only.
export function forecastRangeText(view: MilestoneView): string {
  let earliest: number | null = null;
  let latest: number | null = null;
  let openLeft = false;
  let openRight = false;
  let anyNever = false;
  let anyDated = false;
  for (const forecast of view.forecasts) {
    if (forecast.never) {
      anyNever = true;
      continue;
    }
    anyDated = true;
    if (forecast.earliest === null) {
      openLeft = true;
    }
    if (forecast.latest === null) {
      openRight = true;
    }
    const low = forecast.earliest ?? forecast.latest;
    const high = forecast.latest ?? forecast.earliest;
    if (low !== null && (earliest === null || low < earliest)) {
      earliest = low;
    }
    if (high !== null && (latest === null || high > latest)) {
      latest = high;
    }
  }
  if (!anyDated) {
    return anyNever ? "never" : "no years given";
  }
  if (anyNever) {
    return openLeft ? `by ${latest} to never` : `${earliest} to never`;
  }
  if (openRight) {
    return openLeft ? "open at both ends" : `${earliest} onward`;
  }
  if (openLeft) {
    return `by ${latest}`;
  }
  return rangeText(earliest, latest);
}

// A one-line description of the estimate, shared by the cards, the list, the
// technology pages and aria labels.
export function estimateSummary(item: TimelineItem): string {
  const { view, milestone } = item;
  if (view.barMode === "achieved") {
    return `Achieved in ${view.achievedIn}`;
  }
  if (view.barMode === "team" && milestone.estimate) {
    return `Team range ${rangeText(milestone.estimate.earliest, milestone.estimate.latest)}`;
  }
  if (view.barMode === "span" && view.bar) {
    return `Forecasts span ${rangeText(view.bar.start, view.bar.end)}`;
  }
  if (view.barMode === "whiskers") {
    const count = view.forecastCount === 1 ? "1 forecast" : `${view.forecastCount} forecasts`;
    return `${count}, ${forecastRangeText(view)}`;
  }
  return "No estimate yet";
}

// "2030 to 2038", "2035 onward", "until 2045"
export function rangeText(start: number | null, end: number | null): string {
  if (start !== null && end !== null) {
    return start === end ? `${start}` : `${start} to ${end}`;
  }
  if (start !== null) {
    return `${start} onward`;
  }
  if (end !== null) {
    return `until ${end}`;
  }
  return "open";
}
