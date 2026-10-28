"use client";

import { useSyncExternalStore } from "react";

// Matches the editors' two-column layout in Editor.module.css (.split).
const WIDE_QUERY = "(min-width: 1180px)";

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(WIDE_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return true;
}

// True when the editor's preview fits beside the form. Below that it folds
// into a "See the preview" box near the top, instead of ending up below a
// long form.
export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
