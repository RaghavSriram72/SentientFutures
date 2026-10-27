// Groups milestones into technology bands, gives each one its display code
// ("WBE-01") and sorts the tracks. Shared by the chart, the list, the panel and
// the home page preview, so all of them agree. Pure functions, no React.
import { enumLabel } from "@/lib/enums";
import {
  computeMilestoneView,
  countLabel,
  earliestRelevantYear,
  formatWindow,
  type ForecastView,
  type MilestoneView,
} from "@/lib/estimates";
import type { Milestone, Technology } from "@/lib/types";

// Band order on the timeline. Hybrid only shows up when there is a hybrid milestone.
export const TECHNOLOGY_ORDER: Technology[] = ["wbe", "bci", "neuromorphic", "hybrid"];

// Prefix for the display code. Codes are computed, never stored.
const CODE_PREFIX: Record<Technology, string> = {
  wbe: "WBE",
  bci: "BCI",
  neuromorphic: "NEURO",
  hybrid: "HYBRID",
};

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

// Forecasts in window order, earliest first and "never" last. The chart puts
// each on its own lane in this order, so the whiskers cascade down the track,
// and the list and the dossier ledger use the same order.
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

// A one-line description of the estimate, shared by the list, the panel and aria labels.
export function estimateSummary(item: TimelineItem): string {
  const { view, milestone } = item;
  if (view.barMode === "achieved") {
    return `Achieved in ${view.achievedIn}`;
  }
  if (view.barMode === "team" && milestone.estimate) {
    return `Our range: ${rangeText(milestone.estimate.earliest, milestone.estimate.latest)}`;
  }
  if (view.barMode === "span" && view.bar) {
    return `Forecasts span ${rangeText(view.bar.start, view.bar.end)}`;
  }
  if (view.barMode === "whiskers") {
    return "Individual forecasts only";
  }
  return "No estimate yet";
}

// "2 forecasts from 2 sources: Example Engineer gives 2028 to 2030; Example Skeptic says never"
export function forecastsSummary(view: MilestoneView): string {
  const windows: string[] = [];
  for (const forecast of sortForecastsByWindow(view.forecasts)) {
    const verb = forecast.never ? "says" : "gives";
    const expired = forecast.isExpired ? ", expired" : "";
    windows.push(`${forecast.forecaster} ${verb} ${formatWindow(forecast)}${expired}`);
  }
  return `${countLabel(view)}: ${windows.join("; ")}`;
}

// What a screen reader hears for one chart track. It covers everything the marks show.
export function trackAriaLabel(item: TimelineItem): string {
  const { milestone, view } = item;
  const parts: string[] = [];
  parts.push(`${item.code}, ${milestone.name}`);
  parts.push(`Stage: ${enumLabel("Stage", milestone.stage)}`);
  parts.push(estimateSummary(item));
  if (view.forecastCount >= 1) {
    parts.push(forecastsSummary(view));
  }
  if (view.disagreement.flagged) {
    const by = view.disagreement.decidedBy === "team" ? "flagged by the team" : "flagged by our rule";
    parts.push(`Sources disagree, ${by}`);
  }
  if (milestone.sample) {
    parts.push("Sample milestone");
  }
  return `${parts.join(". ")}.`;
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
