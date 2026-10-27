"use client";

// The interactive timeline: the key, a Chart / List toggle, and the dossier
// sheet for the selected milestone. It owns the selection state. Data arrives
// as props from the server page; nothing here reads the clock.
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ProvenanceLegend, StageLegend } from "@/components/provenance/Legends";
import type { SourceRef } from "@/lib/sources";
import type { Milestone } from "@/lib/types";

import { MarkLegend } from "./MarkLegend";
import { MilestonePanel } from "./MilestonePanel";
import { TimelineChart } from "./TimelineChart";
import { buildTimeline, dependents, indexItems } from "./timelineModel";
import { TimelineList } from "./TimelineList";
import styles from "./TimelineExplorer.module.css";

interface TimelineExplorerProps {
  milestones: Milestone[];
  sources: Record<string, SourceRef>;
  nowYear: number;
}

type ViewChoice = "chart" | "list";

// Below this width the list is the default view. Keep in sync with the 720px
// rules in TimelineExplorer.module.css (key rows, toggle and views).
const NARROW_QUERY = "(max-width: 719px)";

// Below this width the dossier is a bottom sheet over a dimmed page, so it is a
// modal dialog. Keep in sync with the @media (min-width: 900px) sheet block in
// TimelineExplorer.module.css.
const MODAL_QUERY = "(max-width: 899px)";

function subscribeToQuery(query: string, onChange: () => void): () => void {
  const list = window.matchMedia(query);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function subscribeToNarrow(onChange: () => void): () => void {
  return subscribeToQuery(NARROW_QUERY, onChange);
}

function isNarrowNow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

function subscribeToModal(onChange: () => void): () => void {
  return subscribeToQuery(MODAL_QUERY, onChange);
}

function isModalNow(): boolean {
  return window.matchMedia(MODAL_QUERY).matches;
}

// The server can't know the screen width. CSS picks the right default view
// before hydration, so this only affects which toggle button looks pressed.
// The sheet is never open on first render, so the modal flag doesn't matter there.
function noMatchOnServer(): boolean {
  return false;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Everything inside `container` that Tab can reach, in page order. Skips
// anything that isn't rendered.
function focusableIn(container: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const element of container.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (element.getClientRects().length > 0) {
      found.push(element);
    }
  }
  return found;
}

// The chart track or list row for a milestone, whichever is on screen. Until
// someone picks a view, both are in the page and CSS hides one of them.
function findTrigger(root: HTMLElement | null, id: string): HTMLElement | SVGElement | null {
  if (!root) {
    return null;
  }
  const escaped = CSS.escape(id);
  const selector = `[data-track-id="${escaped}"], [data-row-id="${escaped}"]`;
  for (const element of root.querySelectorAll<HTMLElement | SVGElement>(selector)) {
    if (element.getClientRects().length > 0) {
      return element;
    }
  }
  return null;
}

export function TimelineExplorer({ milestones, sources, nowYear }: TimelineExplorerProps) {
  const groups = useMemo(() => buildTimeline(milestones, nowYear), [milestones, nowYear]);
  const itemsById = useMemo(() => indexItems(groups), [groups]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // null means "not chosen yet": chart on wide screens, list on narrow ones.
  const [viewChoice, setViewChoice] = useState<ViewChoice | null>(null);
  const isNarrow = useSyncExternalStore(subscribeToNarrow, isNarrowNow, noMatchOnServer);
  const isModal = useSyncExternalStore(subscribeToModal, isModalNow, noMatchOnServer);

  const explorerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | SVGElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const selectedItem = selectedId ? (itemsById[selectedId] ?? null) : null;
  const activeView: ViewChoice = viewChoice ?? (isNarrow ? "list" : "chart");

  // Remember what opened the sheet, as a fallback for putting focus back.
  function rememberOpener() {
    const active = document.activeElement;
    if (active instanceof HTMLElement || active instanceof SVGElement) {
      openerRef.current = active;
    }
  }

  // Focus goes back to the track or row of the milestone that is open now, not
  // the first one opened: on wide screens people move from track to track while
  // the sheet stays open. The remembered opener is only a fallback.
  const closeSheet = useCallback(() => {
    const trigger = selectedId ? findTrigger(explorerRef.current, selectedId) : null;
    const opener = openerRef.current;
    openerRef.current = null;
    setSelectedId(null);
    if (trigger) {
      trigger.focus();
    } else if (opener && opener.isConnected) {
      opener.focus();
    }
  }, [selectedId]);

  // Chart and list: selecting the open milestone again closes it.
  function toggleMilestone(id: string) {
    if (id === selectedId) {
      closeSheet();
      return;
    }
    if (selectedId === null) {
      rememberOpener();
    }
    setSelectedId(id);
  }

  // From inside the dossier (dependencies): always open the other milestone.
  function openMilestone(id: string) {
    setSelectedId(id);
  }

  // A new milestone in the sheet: start at the top and move focus to its name.
  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    if (sheetRef.current) {
      sheetRef.current.scrollTop = 0;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [selectedId]);

  // Esc closes the sheet. While the sheet is modal (the bottom sheet over a
  // dimmed page), Tab and Shift+Tab wrap around inside it instead of walking
  // into the page behind the scrim.
  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    function keepTabInSheet(event: KeyboardEvent) {
      const sheet = sheetRef.current;
      if (!sheet) {
        return;
      }
      const focusables = focusableIn(sheet);
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active !== null && sheet.contains(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeSheet();
      } else if (event.key === "Tab" && isModal) {
        keepTabInSheet(event);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, closeSheet, isModal]);

  const showChart = viewChoice === null || viewChoice === "chart";
  const showList = viewChoice === null || viewChoice === "list";

  return (
    <div ref={explorerRef} className={styles.explorer}>
      <div className={styles.key}>
        <div className={styles.keyRow}>
          <span className={styles.keyLabel}>Stage</span>
          <StageLegend />
        </div>
        <div className={styles.keyRow}>
          <span className={styles.keyLabel}>Marks</span>
          <MarkLegend />
        </div>
        <div className={styles.keyRow}>
          <span className={styles.keyLabel}>In the dossier</span>
          <ProvenanceLegend compact />
        </div>
      </div>

      <div className={styles.controls}>
        <p className={styles.hint}>
          <svg className={styles.hintIcon} viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <circle cx="8" cy="8" r="2.25" className={styles.hintDot} />
          </svg>
          {selectedItem
            ? `Showing ${selectedItem.code}. Press Esc or the close button to put it away.`
            : "Select a milestone to see everything we have on it."}
        </p>
        <div
          className={`${styles.toggle} ${viewChoice === null ? styles.autoToggle : ""}`}
          role="group"
          aria-label="Show the timeline as"
        >
          <button
            type="button"
            className={styles.toggleButton}
            data-view="chart"
            aria-pressed={activeView === "chart"}
            onClick={() => setViewChoice("chart")}
          >
            Chart
          </button>
          <button
            type="button"
            className={styles.toggleButton}
            data-view="list"
            aria-pressed={activeView === "list"}
            onClick={() => setViewChoice("list")}
          >
            List
          </button>
        </div>
      </div>

      <div className={viewChoice === null ? styles.autoViews : undefined}>
        {showChart && (
          <div className={styles.chartView}>
            <div className={styles.chartCard}>
              <TimelineChart groups={groups} nowYear={nowYear} selectedId={selectedId} onSelect={toggleMilestone} />
            </div>
            <p className={styles.scrollHint}>Scroll sideways for the later years and the Never column.</p>
          </div>
        )}
        {showList && (
          <div className={styles.listView}>
            <TimelineList groups={groups} selectedId={selectedId} onSelect={toggleMilestone} />
          </div>
        )}
      </div>

      {selectedItem && (
        <div className={styles.sheetLayer}>
          <div className={styles.scrim} onClick={closeSheet} aria-hidden="true" />
          <div
            ref={sheetRef}
            className={styles.sheet}
            role="dialog"
            aria-modal={isModal ? true : undefined}
            aria-labelledby={headingId}
          >
            <MilestonePanel
              key={selectedItem.milestone.id}
              item={selectedItem}
              itemsById={itemsById}
              neededFor={dependents(selectedItem.milestone.id, groups)}
              sources={sources}
              headingId={headingId}
              headingRef={headingRef}
              onClose={closeSheet}
              onSelectMilestone={openMilestone}
              nowYear={nowYear}
            />
          </div>
        </div>
      )}
    </div>
  );
}
