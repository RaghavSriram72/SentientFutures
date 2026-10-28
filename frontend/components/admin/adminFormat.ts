// Formatting for the admin pages. These only run in the browser, so they use
// the reader's own time zone (unlike components/common/format.ts, which has to
// render the same on the server and the client).
import type { CandidateFlag, PipelineRun, QueueFilters, ReviewStatus } from "@/lib/adminTypes";
import { queueSearchParams } from "@/lib/api";
import type { SourceKind } from "@/lib/types";

import { DASHBOARD_STATUSES, FLAGS } from "./labels";

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
// The zone is named, so a time read next to another person's never confuses.
// Run logs arrive in UTC and are converted to this zone too (logLinesInLocalTime).
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "27 Oct 2026, 18:04 GMT-4" (the zone's short name, which varies by browser)
export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? DATE_TIME_FORMAT.format(date) : "Not recorded";
}

const LOG_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// The reader's zone as the date formats print it, e.g. "GMT-4".
export function timeZoneLabel(): string {
  for (const part of DATE_TIME_FORMAT.formatToParts(new Date())) {
    if (part.type === "timeZoneName") {
      return part.value;
    }
  }
  return "your time zone";
}

const LOG_TIME = /^(\d{2}):(\d{2}):(\d{2}) /;
const DAY_MS = 24 * 60 * 60 * 1000;

// Run log lines start with a UTC time ("01:06:30 Collecting..."). These turn
// that time into the reader's own zone, so the log matches the times around
// it. The date comes from the run's start; a time earlier than the line
// before means the run went past midnight UTC.
export function logLinesInLocalTime(lines: string[], startedAt: string | null | undefined): string[] {
  const start = parseDate(startedAt);
  if (!start) {
    return lines;
  }
  let dayStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  let previous = start.getUTCHours() * 3600 + start.getUTCMinutes() * 60 + start.getUTCSeconds();
  const converted: string[] = [];
  for (const line of lines) {
    const match = LOG_TIME.exec(line);
    if (!match) {
      converted.push(line);
      continue;
    }
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    // A minute of slack: the start time and the first line can be a moment apart.
    if (seconds < previous - 60) {
      dayStart += DAY_MS;
    }
    previous = seconds;
    const when = new Date(dayStart + seconds * 1000);
    converted.push(`${LOG_TIME_FORMAT.format(when)} ${line.slice(match[0].length)}`);
  }
  return converted;
}

// "27 Oct 2026"
export function formatDay(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? DAY_FORMAT.format(date) : "Not recorded";
}

// "2 min 14 s". Null when the run hasn't finished.
export function formatDuration(start: string | null | undefined, end: string | null | undefined): string | null {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${seconds} s`;
  }
  return `${seconds} s`;
}

// Triage costs fractions of a cent per paper, so small amounts keep more digits.
export function formatCost(usd: number): string {
  if (usd === 0) {
    return "$0.00";
  }
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  if (usd < 1) {
    return `$${usd.toFixed(3)}`;
  }
  return `$${usd.toFixed(2)}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function isRunActive(run: PipelineRun): boolean {
  return run.status === "queued" || run.status === "running";
}

// ---------- Admin URLs (always with trailing slashes, ids in the query) ----------

function asReviewStatus(value: string | null): ReviewStatus {
  for (const status of DASHBOARD_STATUSES) {
    if (status === value) {
      return status;
    }
  }
  return "pending_review";
}

function asFlag(value: string | null): CandidateFlag | "" {
  for (const flag of FLAGS) {
    if (flag === value) {
      return flag;
    }
  }
  return "";
}

function asKind(value: string | null): SourceKind | "" {
  if (value === "argument" || value === "milestone_evidence") {
    return value;
  }
  return "";
}

// Whether the kind filter means anything in this tab. It filters on the kind
// the AI gave, and papers in New haven't been triaged, so there it would
// always match nothing.
export function kindFilterApplies(status: ReviewStatus): boolean {
  return status !== "new";
}

// Queue filters from a query string. Anything unknown falls back to the
// default view: pending review, no filters.
export function readQueueFilters(params: { get(name: string): string | null }): QueueFilters {
  const status = asReviewStatus(params.get("status"));
  return {
    status,
    kind: kindFilterApplies(status) ? asKind(params.get("kind")) : "",
    flag: asFlag(params.get("flag")),
    q: params.get("q") ?? "",
  };
}

// Whether any filter narrows the tab (the tab itself isn't a filter).
export function hasQueueFilters(filters: QueueFilters): boolean {
  return filters.kind !== "" || filters.flag !== "" || filters.q.trim() !== "";
}

export function queueHref(filters: QueueFilters): string {
  return `/admin/queue/?${queueSearchParams(filters).toString()}`;
}

export function queueStatusHref(status: ReviewStatus): string {
  return queueHref({ status, kind: "", flag: "", q: "" });
}

// The queue filters ride along, so "next paper" after a decision stays in the
// same tab and filters.
export function reviewHref(id: string, filters: QueueFilters): string {
  const params = queueSearchParams(filters);
  params.set("id", id);
  return `/admin/review/?${params.toString()}`;
}

// The paper's page with the review form already open, to change its decision.
export function changeDecisionHref(id: string, filters: QueueFilters): string {
  return `${reviewHref(id, filters)}&again=1`;
}

export function runHref(id: string): string {
  return `/admin/runs/?id=${encodeURIComponent(id)}`;
}
