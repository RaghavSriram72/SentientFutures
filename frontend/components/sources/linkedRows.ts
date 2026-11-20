// What the sources list and the evidence register share about their rows:
// ringing and opening the row a link points at, and remembering which rows
// were open on each history entry. Browser only (it reads window and
// document), so call these from effects and event handlers.
import { OPEN_ROWS_KEY } from "@/components/common/HashLinkHistory";

// The ring a linked row wears. :target gives it before the list's script
// runs; this gives the same ring after a link from another page, where
// :target stays false.
export const HIGHLIGHT = "data-highlight";

// Set on the list once its script runs, so :target no longer rings a row (see
// SourceRow.module.css): Next changes the address without updating :target,
// so it kept ringing a row the address no longer names.
export const LIVE = "data-rows-live";

// The row id a hash points at. The ids are lowercase, so "#S02" or "#E042"
// (the ids as the site prints them) find s02 and e042 too.
export function rowIdFromHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1)).toLowerCase();
  } catch {
    // A malformed hash such as "#%E0" can't point at a row.
    return "";
  }
}

export function clearHighlight() {
  for (const row of document.querySelectorAll(`[${HIGHLIGHT}]`)) {
    row.removeAttribute(HIGHLIGHT);
  }
}

// Rings the row a link points at, like /sources/#s02 or /evidence/#e042.
// Returns the row, or null when it isn't on the page.
export function ringRow(id: string): HTMLDetailsElement | null {
  const row = document.getElementById(id);
  if (!(row instanceof HTMLDetailsElement)) {
    return null;
  }
  clearHighlight();
  row.setAttribute(HIGHLIGHT, "");
  return row;
}

// Opens the row a link points at, rings it and scrolls it into view.
export function openRow(id: string) {
  const row = ringRow(id);
  if (row === null) {
    return;
  }
  row.open = true;
  row.scrollIntoView({ block: "start" });
}

export function listRows(list: HTMLUListElement | null): HTMLDetailsElement[] {
  const rows: HTMLDetailsElement[] = [];
  if (list === null) {
    return rows;
  }
  for (const row of list.querySelectorAll(":scope > li > details")) {
    if (row instanceof HTMLDetailsElement) {
      rows.push(row);
    }
  }
  return rows;
}

// The open rows stored on the current history entry, or null when none were.
export function rememberedRows(): string[] | null {
  const state: unknown = window.history.state;
  if (state === null || typeof state !== "object") {
    return null;
  }
  const stored: unknown = (state as Record<string, unknown>)[OPEN_ROWS_KEY];
  if (!Array.isArray(stored)) {
    return null;
  }
  const ids: string[] = [];
  for (const id of stored) {
    if (typeof id === "string") {
      ids.push(id);
    }
  }
  return ids;
}

// Stores the rows open in the list on the current history entry, by id, so
// Back, Forward or a reload opens the ones the reader had open. Only on an
// entry the router wrote, so its state is kept.
export function rememberOpenRows(list: HTMLUListElement | null) {
  const state: unknown = window.history.state;
  if (state === null || typeof state !== "object" || !("__NA" in state)) {
    return;
  }
  const open: string[] = [];
  for (const row of listRows(list)) {
    if (row.open) {
      open.push(row.id);
    }
  }
  const stored = rememberedRows();
  if (stored !== null && stored.join(" ") === open.join(" ")) {
    return;
  }
  try {
    window.history.replaceState({ ...state, [OPEN_ROWS_KEY]: open }, "");
  } catch {
    // Safari's limit on history writes. The next change tries again.
  }
}

// Opens the rows with these ids and closes the rest.
export function setOpenRows(list: HTMLUListElement | null, ids: string[]) {
  for (const row of listRows(list)) {
    row.open = ids.includes(row.id);
  }
}

// The parts of the address a list follows.
export interface ListAddress {
  search: string;
  hash: string;
}

export function currentAddress(): ListAddress {
  return { search: window.location.search, hash: window.location.hash };
}

// What to do with the rows once the list the address asks for has rendered.
export interface RowRequest {
  // The row the hash links to, or null.
  linkedId: string | null;
  // Coming back to this history entry (Back, Forward or a reload). The linked
  // row is ringed but not scrolled to, since HashLinkHistory puts the
  // reader's place back.
  returning: boolean;
  // The rows to have open, all others closed, before the linked row opens.
  // Null leaves them as they are.
  openIds: string[] | null;
}

// Carries out a RowRequest once its rows are on the page.
export function applyRowRequest(list: HTMLUListElement | null, request: RowRequest) {
  if (request.openIds !== null) {
    setOpenRows(list, request.openIds);
  }
  if (request.linkedId === null) {
    return;
  }
  if (request.returning) {
    ringRow(request.linkedId);
  } else {
    openRow(request.linkedId);
  }
}
