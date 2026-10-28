// Small rules the milestone and post editors share. Pure functions, so the
// tests in tests/editorModel.test.ts can run them without a browser.
import type { ApiError } from "@/lib/api";

// Today in the reader's zone, as YYYY-MM-DD.
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const SLUG_MAX_LENGTH = 60;

// "Why we show every forecast!" -> "why-we-show-every-forecast"
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

// The site's ids and addresses: lowercase letters, numbers and single hyphens.
export function isSlug(text: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text);
}

export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

// The API refuses long (em) dashes in anything published, the site's house
// rule. Built from its code point, so this file passes the same check.
export const LONG_DASH = String.fromCharCode(0x2014);

export function hasLongDash(text: string): boolean {
  return text.includes(LONG_DASH);
}

export const LONG_DASH_FIX = "Use a comma, colon or full stop instead.";

// Who saved first, when a save is refused because the record changed since
// the editor opened it (409 version_conflict).
export interface SavedFirst {
  by: string | null;
  at: string | null;
}

export function savedFirstFrom(error: ApiError | null): SavedFirst | null {
  if (error === null || error.status !== 409 || error.code !== "version_conflict") {
    return null;
  }
  const details =
    error.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : {};
  return {
    by: typeof details.updated_by_name === "string" ? details.updated_by_name : null,
    at: typeof details.updated_at === "string" ? details.updated_at : null,
  };
}

// An API problem path like "milestone.forecasts.0.quote" without the body's
// own prefix, so it matches the editor's field paths ("forecasts.0.quote").
export function withoutPrefix(path: string, prefix: string): string {
  if (path === prefix) {
    return "";
  }
  if (path.startsWith(`${prefix}.`)) {
    return path.slice(prefix.length + 1);
  }
  return path;
}
