"use client";

// The full-screen timeline: one track laid on a floor tilted away from the
// reader, with milestones standing up off it as cards. Scrolling (wheel,
// trackpad, drag, swipe, arrow keys or the mini map) slides time sideways.
// Everything is CSS 3D, so text stays sharp and every card is an ordinary button.
//
// The camera position ("offset", the world x at the left edge of the screen)
// lives in refs and is applied straight to the DOM each animation frame, so
// scrolling never re-renders React. Only coarse state (which cards are in view,
// the year readout, the mini map value) goes through React, a few times a
// second at most.
//
// The world scale is fitted to the screen: the tallest card in the back row
// must stay below the measured top bar, so cards never rise behind it.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import { MilestonePanel } from "@/components/timeline/MilestonePanel";
import { TimelineList } from "@/components/timeline/TimelineList";
import {
  buildTimeline,
  dependents,
  flattenItems,
  hasEstimate,
  indexItems,
  stageKey,
  type TimelineItem,
} from "@/components/timeline/timelineModel";
import { enumLabel } from "@/lib/enums";
import { DISAGREEMENT_GAP_YEARS } from "@/lib/estimates";
import { IS_DRAFT } from "@/lib/site";
import type { SourceRef } from "@/lib/sources";
import type { Milestone, Technology } from "@/lib/types";

import { DependencyLinks } from "./DependencyLinks";
import {
  AchievedDot,
  DependencySwatch,
  FaintRibbonSwatch,
  LineSwatch,
  NeverCross,
  RibbonSwatch,
  UnknownZoneSwatch,
} from "./TrackGlyphs";
import { FloorMarks, FloorTrace, TECHNOLOGIES, TechGlyph, TrackCard, type CardTone } from "./TrackParts";
import {
  CARD_WIDTH,
  FLOOR_DEPTH,
  centerOf,
  fitScale,
  layoutTrack,
  rowY,
  zoneCenter,
  type FloorView,
  type TrackItem,
  type TrackLayout,
  type Zone,
} from "./trackLayout";
import parts from "./TrackParts.module.css";
import styles from "./TrackScene.module.css";

interface TrackSceneProps {
  milestones: Milestone[];
  sources: Record<string, SourceRef>;
  nowYear: number;
  // The internal style tile shows the worked examples. The public timeline never does.
  includeSamples?: boolean;
}

type Filter = "all" | Technology;

const PANEL_WIDTH = 520;
const PANEL_GAP = 16;
const INTRO_WIDTH = 380;
const SIDE_GAP = 24;
const EASE = 0.14;
const DRAG_THRESHOLD = 3;
const INTRO_KEY = "sf-timeline-intro-dismissed";
const TITLE = "When might these milestones happen?";

// ---------- Screen geometry ----------

interface SceneGeometry extends FloorView {
  scale: number;
  screenWidth: number;
}

// What the CSS uses before the first measurement (a 1440x900 desktop).
const DEFAULT_GEOMETRY: SceneGeometry = {
  height: 900,
  floorBottom: 117,
  horizon: 0.06,
  perspective: 1350,
  tiltDeg: 58,
  scale: 1,
  screenWidth: 1440,
};

// The camera for a screen size, before fitting: phones and tablets tilt the
// floor less, sit it higher, and draw the world smaller.
function geometryFor(screenWidth: number, screenHeight: number): SceneGeometry {
  const narrow = screenWidth <= 900;
  let scale = 1;
  if (screenWidth < 600) {
    scale = 0.62;
  } else if (narrow) {
    scale = 0.8;
  }
  return {
    height: screenHeight,
    floorBottom: Math.round(screenHeight * (narrow ? 0.17 : 0.13)),
    horizon: 0.06,
    perspective: narrow ? 1100 : 1350,
    tiltDeg: narrow ? 50 : 58,
    scale,
    screenWidth,
  };
}

// How much of the screen the intro (left) and the dossier (right) cover, in
// screen pixels. On narrow screens both sit at the bottom instead, so nothing.
function insetsForWidth(screenWidth: number, panelOpen: boolean, intro: boolean): { left: number; right: number } {
  const wide = screenWidth > 900;
  return {
    left: intro && wide ? INTRO_WIDTH + SIDE_GAP * 2 : 0,
    right: panelOpen && wide ? PANEL_WIDTH + PANEL_GAP * 2 : 0,
  };
}

// The tallest card in each row, from the DOM. offsetHeight ignores 3D
// transforms, so it's the card's real height in world pixels.
function measureRowHeights(floor: HTMLElement | null): number[] {
  const heights = [0, 0, 0];
  if (!floor) {
    return heights;
  }
  for (const card of floor.querySelectorAll<HTMLElement>("[data-card-id]")) {
    const row = Number(card.dataset.row ?? 0);
    heights[row] = Math.max(heights[row], card.offsetHeight);
  }
  return heights;
}

// ---------- Small helpers ----------

// The milestone id in the address (/timeline/#wbe-legal), or "". The site's
// "Skip to content" link sets #main, which isn't a milestone, so it's ignored.
function readHash(): string {
  const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  return id === "main" ? "" : id;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// "a", "a and b", "a, b and c"
function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function technologyName(technology: Technology): string {
  // "Neuromorphic AI" keeps its capital letters; the others read as plain words.
  const label = enumLabel("Technology", technology);
  return technology === "neuromorphic" ? "neuromorphic AI" : lowerFirst(label);
}

// The intro's counts, worked out from what's on the track.
function introSummary(items: TimelineItem[]): string {
  const total = items.length;
  if (total === 0) {
    return "Nothing is on the timeline yet.";
  }
  const technologies: Technology[] = [];
  let dated = 0;
  for (const item of items) {
    if (!technologies.includes(item.milestone.technology)) {
      technologies.push(item.milestone.technology);
    }
    if (hasEstimate(item)) {
      dated += 1;
    }
  }
  const names = technologies.map(technologyName);
  const noun = total === 1 ? "milestone" : "milestones";
  let first = `${total} ${noun} so far, across ${joinNames(names)}.`;
  if (technologies.length === 1) {
    first = total === 1 ? `1 milestone so far, for ${names[0]}.` : `${total} ${noun} so far, all for ${names[0]}.`;
  }

  const undated = total - dated;
  let second = "";
  if (dated === 0) {
    second =
      total === 1
        ? "It has no defensible date yet, so it waits under Timing unknown at the end of the track."
        : `None has a defensible date yet, so all ${total} wait under Timing unknown at the end of the track.`;
  } else if (undated === 0) {
    second = "Each one has a team range, a forecast or the year it was reached.";
  } else {
    const verb = dated === 1 ? "has" : "have";
    second = `${dated} ${verb} a team range, a forecast or the year it was reached. The other ${undated} wait under Timing unknown at the end of the track.`;
  }
  return `${first} ${second}`;
}

// Room kept between a zone's first card and whatever covers the screen to its
// left, in world pixels. Generous, because perspective draws the front row
// a little wider than its world size.
const ZONE_EDGE_ROOM = 72;

// Where the camera opens: the first dated card, or failing that the cards
// waiting in the Never or Timing unknown zone, or failing that Now.
// `freeWidth` is how much of the track the intro and the dossier leave
// uncovered, in world pixels.
function startCenter(layout: TrackLayout, freeWidth: number): number {
  for (const trackItem of layout.items) {
    if (trackItem.placement === "dated") {
      return centerOf(trackItem);
    }
  }
  if (layout.unknownZone) {
    return zoneOpening(layout, layout.unknownZone, freeWidth);
  }
  if (layout.neverZone) {
    return zoneOpening(layout, layout.neverZone, freeWidth);
  }
  return layout.nowX;
}

// A zone's middle when all its cards fit in the free space. Otherwise its
// first cards, so none of them starts out under the intro; the rest are a
// scroll away.
function zoneOpening(layout: TrackLayout, zone: Zone, freeWidth: number): number {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const trackItem of layout.items) {
    if (trackItem.x >= zone.start && trackItem.x <= zone.end) {
      left = Math.min(left, trackItem.x);
      right = Math.max(right, trackItem.x + CARD_WIDTH);
    }
  }
  if (left > right || right - left + ZONE_EDGE_ROOM * 2 <= freeWidth) {
    return zoneCenter(layout, zone);
  }
  return left - ZONE_EDGE_ROOM + freeWidth / 2;
}

// The far end of the track, for the End key.
function endCenter(layout: TrackLayout): number {
  if (layout.unknownZone) {
    return zoneCenter(layout, layout.unknownZone);
  }
  if (layout.neverZone) {
    return zoneCenter(layout, layout.neverZone);
  }
  return layout.datedEnd;
}

// What the big readout says for a world x.
function readoutFor(layout: TrackLayout, worldX: number): { text: string; word: boolean } {
  if (layout.unknownZone && worldX >= layout.unknownZone.start - 110) {
    return { text: "Timing unknown", word: true };
  }
  if (layout.neverZone && worldX >= layout.neverZone.start - 110) {
    return { text: "Never", word: true };
  }
  return { text: String(Math.round(layout.xToYear(worldX))), word: false };
}

// Whether the reader closed the intro on an earlier visit. Storage can be
// blocked, in which case the intro just shows again.
function introWasDismissed(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

// Keep Tab inside an open dialog.
function trapTab(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) {
    return;
  }
  const focusable: HTMLElement[] = [];
  const candidates = container.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), [tabindex]");
  for (const element of candidates) {
    if (element.tabIndex < 0) {
      continue;
    }
    if (element instanceof HTMLInputElement && element.type === "radio" && !element.checked) {
      continue; // only the chosen radio is a Tab stop
    }
    focusable.push(element);
  }
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ---------- The scene ----------

export function TrackScene({ milestones, sources, nowYear, includeSamples = false }: TrackSceneProps) {
  const shownMilestones = useMemo(() => {
    const kept: Milestone[] = [];
    for (const milestone of milestones) {
      if (includeSamples || !milestone.sample) {
        kept.push(milestone);
      }
    }
    return kept;
  }, [milestones, includeSamples]);

  const groups = useMemo(() => buildTimeline(shownMilestones, nowYear), [shownMilestones, nowYear]);
  const allItems = useMemo(() => flattenItems(groups), [groups]);
  const itemsById = useMemo(() => indexItems(groups), [groups]);

  // How many milestones each technology has, for the Show control.
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: allItems.length };
    for (const tech of TECHNOLOGIES) {
      result[tech.id] = 0;
    }
    for (const item of allItems) {
      result[item.milestone.technology] += 1;
    }
    return result;
  }, [allItems]);

  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => {
    const set = new Set<Technology>();
    for (const tech of TECHNOLOGIES) {
      if (filter === "all" || filter === tech.id) {
        set.add(tech.id);
      }
    }
    return set;
  }, [filter]);

  const layout: TrackLayout = useMemo(() => layoutTrack(allItems, shown, nowYear), [allItems, shown, nowYear]);
  const trackItemsById = useMemo(() => {
    const map: Record<string, TrackItem> = {};
    for (const trackItem of layout.items) {
      map[trackItem.item.milestone.id] = trackItem;
    }
    return map;
  }, [layout.items]);

  // ---------- Refs and state ----------

  const sceneRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const keyButtonRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const frameRef = useRef(0);
  const lastReportedRef = useRef(Number.NEGATIVE_INFINITY);
  const geometryRef = useRef<SceneGeometry>(DEFAULT_GEOMETRY);
  // Whether the dossier and the intro are open, kept in refs as well as state,
  // so the camera can center things the moment they open or close.
  const panelOpenRef = useRef(false);
  const introOpenRef = useRef(true);
  const worldWidthRef = useRef(layout.worldWidth);
  const reducedMotionRef = useRef(false);
  const placedRef = useRef(false);
  const pendingCenterRef = useRef<string | null>(null);
  const filterChangedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: number;
    touch: boolean;
    moved: boolean;
    captured: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const [geometry, setGeometry] = useState<SceneGeometry>(DEFAULT_GEOMETRY);
  const [screenWidth, setScreenWidth] = useState(DEFAULT_GEOMETRY.screenWidth);
  // The bottom of the top bar's buttons, and of everything at the top
  // including the readout (which is positioned on its own, in the middle).
  const [barHeight, setBarHeight] = useState(80);
  const [topHeight, setTopHeight] = useState(96);
  const [fontsReady, setFontsReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [cameraX, setCameraX] = useState<number | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [introOpen, setIntroOpen] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showList, setShowList] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedItem = selectedId ? (itemsById[selectedId] ?? null) : null;
  const cardVariant = screenWidth < 600 ? "large" : "regular";
  // At 900px and below the intro is a sheet over the bottom of the screen.
  // While it's up, the controls under it are inert, so Tab can't land on
  // something the reader can't see.
  const sheetCovers = introOpen && screenWidth <= 900;

  // ---------- Camera ----------

  // The screen x where things get centered and where the readout reads: the
  // middle of whatever the intro and the dossier leave uncovered.
  function focusPoint(): number {
    const width = geometryRef.current.screenWidth;
    const { left, right } = insetsForWidth(width, panelOpenRef.current, introOpenRef.current);
    return left + (width - left - right) / 2;
  }

  // The width of track the intro and the dossier leave uncovered, in world pixels.
  function freeWorldWidth(): number {
    const { scale, screenWidth: width } = geometryRef.current;
    const { left, right } = insetsForWidth(width, panelOpenRef.current, introOpenRef.current);
    return (width - left - right) / scale;
  }


  const applyCamera = useCallback((offset: number) => {
    const { scale, screenWidth: width } = geometryRef.current;
    if (floorRef.current) {
      floorRef.current.style.setProperty("--offset", `${-offset * scale}px`);
    }
    if (windowRef.current) {
      const world = worldWidthRef.current;
      windowRef.current.style.left = `${Math.max(0, offset / world) * 100}%`;
      windowRef.current.style.width = `${Math.min(1, width / scale / world) * 100}%`;
    }
  }, []);

  // One camera step per animation frame, until the camera reaches its target.
  const paint = useCallback(() => {
    function frame() {
      const current = offsetRef.current;
      const target = targetRef.current;
      const next = Math.abs(target - current) < 0.5 ? target : current + (target - current) * EASE;
      offsetRef.current = next;
      applyCamera(next);
      const settled = next === target;
      // Tell React where the camera is only when it has moved a bit, or stopped.
      if (settled || Math.abs(next - lastReportedRef.current) > 60) {
        lastReportedRef.current = next;
        setCameraX(next);
      }
      frameRef.current = settled ? 0 : requestAnimationFrame(frame);
    }
    frame();
  }, [applyCamera]);

  const clampOffset = useCallback((value: number) => {
    const width = geometryRef.current.screenWidth / geometryRef.current.scale;
    const min = -width * 0.12;
    const max = Math.max(min, worldWidthRef.current - width * 0.82);
    return Math.min(max, Math.max(min, value));
  }, []);

  const moveTo = useCallback(
    (offset: number, instant = false) => {
      targetRef.current = clampOffset(offset);
      if (instant || reducedMotionRef.current) {
        offsetRef.current = targetRef.current;
      }
      if (frameRef.current === 0) {
        frameRef.current = requestAnimationFrame(paint);
      }
    },
    [clampOffset, paint],
  );

  const centerOn = useCallback(
    (worldX: number, instant = false) => {
      moveTo(worldX - focusPoint() / geometryRef.current.scale, instant);
    },
    [moveTo],
  );

  // The world x currently at the focus point.
  function focusWorldX(): number {
    return targetRef.current + focusPoint() / geometryRef.current.scale;
  }

  useEffect(() => {
    worldWidthRef.current = layout.worldWidth;
  }, [layout.worldWidth]);

  // ---------- Selection ----------

  const open = useCallback(
    (id: string) => {
      const item = itemsById[id];
      if (!item) {
        setNotice(`There's no milestone called “${id}” on the timeline.`);
        return;
      }
      setNotice(null);
      setSelectedId(id);
      setShowList(false);
      setIntroOpen(false);
      panelOpenRef.current = true;
      introOpenRef.current = false;
      const trackItem = trackItemsById[id];
      if (trackItem) {
        centerOn(centerOf(trackItem));
      } else {
        // Its technology is filtered out: show everything, then center once laid out.
        pendingCenterRef.current = id;
        setFilter("all");
      }
      window.history.replaceState(null, "", `#${id}`);
    },
    [itemsById, trackItemsById, centerOn],
  );

  const close = useCallback(() => {
    const id = selectedId;
    const keep = focusWorldX();
    setSelectedId(null);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    panelOpenRef.current = false;
    centerOn(keep);
    const button = id ? document.querySelector<HTMLElement>(`[data-card-id="${id}"]`) : null;
    if (button) {
      button.focus({ preventScroll: true });
    } else {
      stageRef.current?.focus({ preventScroll: true });
    }
    // focusWorldX reads refs only, so it doesn't need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, centerOn]);

  function dismissIntro() {
    const keep = focusWorldX();
    setIntroOpen(false);
    try {
      window.localStorage.setItem(INTRO_KEY, "1");
    } catch {
      // Storage can be blocked; the intro then just comes back next visit.
    }
    introOpenRef.current = false;
    centerOn(keep);
    stageRef.current?.focus({ preventScroll: true });
  }

  function reopenIntro() {
    setShowLegend(false);
    setIntroOpen(true);
    introOpenRef.current = true;
  }

  function chooseFilter(next: Filter) {
    filterChangedRef.current = true;
    setFilter(next);
    // A dossier for a milestone that's now hidden closes with it.
    if (selectedItem && next !== "all" && selectedItem.milestone.technology !== next) {
      setSelectedId(null);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      panelOpenRef.current = false;
    }
  }

  // ---------- Mount: screen, motion preference, scroll lock, intro ----------

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(reducedMotionRef.current);
    setScreenWidth(window.innerWidth);

    geometryRef.current = { ...geometryFor(window.innerWidth, window.innerHeight), scale: geometryRef.current.scale };

    // Lock the page behind the scene. The scene clips its own overflow, so
    // focusing a card near the edge can't scroll it sideways either.
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";

    function onResize() {
      setScreenWidth(window.innerWidth);
    }
    window.addEventListener("resize", onResize);
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) {
        setFontsReady(true);
      }
    });
    return () => {
      cancelled = true;
      html.style.overflow = previousOverflow;
      window.removeEventListener("resize", onResize);
      if (frameRef.current !== 0) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, []);

  // The top bar's height, so the panel, the Key and the cards stay below it.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    const title = bar.querySelector<HTMLElement>("[data-title-block]");
    const observer = new ResizeObserver(() => {
      const barBottom = Math.ceil(bar.getBoundingClientRect().bottom);
      const titleBottom = title ? Math.ceil(title.getBoundingClientRect().bottom) : 0;
      setBarHeight(barBottom);
      setTopHeight(Math.max(barBottom, titleBottom));
    });
    observer.observe(bar);
    if (title) {
      observer.observe(title);
    }
    return () => observer.disconnect();
  }, []);

  // Fit the world to the screen, then place the camera the first time.
  useEffect(() => {
    const base = geometryFor(window.innerWidth, window.innerHeight);
    const rowHeights = measureRowHeights(floorRef.current);
    const scale = fitScale(base, rowHeights, topHeight + 12, base.scale);
    const keep = placedRef.current ? focusWorldX() : null;
    const next: SceneGeometry = { ...base, scale };
    geometryRef.current = next;
    setGeometry(next);

    // The first time only: open the milestone named in the link, or else show
    // the intro unless the reader has dismissed it before.
    if (!placedRef.current) {
      placedRef.current = true;
      const id = readHash();
      if (id && itemsById[id] && trackItemsById[id]) {
        setSelectedId(id);
        setIntroOpen(false);
        panelOpenRef.current = true;
        introOpenRef.current = false;
        centerOn(centerOf(trackItemsById[id]), true);
        return;
      }
      if (introWasDismissed()) {
        setIntroOpen(false);
        introOpenRef.current = false;
      }
      if (id && !itemsById[id]) {
        setNotice(`There's no milestone called “${id}” on the timeline.`);
      }
      centerOn(startCenter(layout, freeWorldWidth()), true);
    } else if (keep !== null) {
      centerOn(keep, true);
    }
    // Runs when the screen, the cards or the bar change size. Selection and
    // intro changes move the camera themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenWidth, layout, cardVariant, topHeight, fontsReady]);

  // After a filter change, glide to the first card still showing (or to the
  // milestone a dependency link asked for).
  useEffect(() => {
    if (!filterChangedRef.current && pendingCenterRef.current === null) {
      return;
    }
    filterChangedRef.current = false;
    const pending = pendingCenterRef.current;
    pendingCenterRef.current = null;
    if (pending && trackItemsById[pending]) {
      centerOn(centerOf(trackItemsById[pending]));
      return;
    }
    centerOn(startCenter(layout, freeWorldWidth()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // A new dossier starts at its top, with focus on its title.
  useEffect(() => {
    if (selectedId) {
      if (panelRef.current) {
        panelRef.current.scrollTop = 0;
      }
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [selectedId]);

  // Links that change only the hash (/timeline/#wbe-legal) open that milestone.
  useEffect(() => {
    function onHashChange() {
      const id = readHash();
      if (id && id !== selectedId) {
        open(id);
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [open, selectedId]);

  // ---------- Wheel, keys, drag ----------

  // Wheel and trackpad: both directions move through time.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    function onWheel(event: WheelEvent) {
      if (showList) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && target.closest("[data-scrollable]")) {
        return; // let the dossier and the popovers scroll normally
      }
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const lineScale = event.deltaMode === 1 ? 32 : 1;
      moveTo(targetRef.current + (delta * lineScale * 1.1) / geometryRef.current.scale);
    }
    scene.addEventListener("wheel", onWheel, { passive: false });
    return () => scene.removeEventListener("wheel", onWheel);
  }, [moveTo, showList]);

  // Keyboard: arrows and Page keys move through time, Home is Now, End is the
  // far end, Esc closes whatever is on top.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (showList) {
          setShowList(false);
          listButtonRef.current?.focus();
        } else if (showFilter) {
          setShowFilter(false);
          filterButtonRef.current?.focus();
        } else if (showLegend) {
          setShowLegend(false);
          keyButtonRef.current?.focus();
        } else if (selectedId) {
          close();
        } else if (notice) {
          setNotice(null);
        }
        return;
      }
      if (showList || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("[data-scrollable]") || target.tagName === "INPUT")) {
        return;
      }
      const width = geometryRef.current.screenWidth / geometryRef.current.scale;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        moveTo(targetRef.current + width * (event.key === "PageDown" ? 0.8 : 0.3));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        moveTo(targetRef.current - width * (event.key === "PageUp" ? 0.8 : 0.3));
      } else if (event.key === "Home") {
        event.preventDefault();
        centerOn(layout.nowX);
      } else if (event.key === "End") {
        event.preventDefault();
        centerOn(endCenter(layout));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, layout, moveTo, centerOn, selectedId, showLegend, showFilter, showList, notice]);

  // Drags can start anywhere on the track, cards included. Pointer capture
  // starts only once the pointer has really moved, so a plain click still
  // reaches the card. On touch screens a vertical swipe moves through time too.
  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: targetRef.current,
      touch: event.pointerType === "touch",
      moved: false,
      captured: false,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const delta = drag.touch && Math.abs(dy) > Math.abs(dx) ? dy : dx;
    if (!drag.moved && Math.abs(delta) > DRAG_THRESHOLD) {
      drag.moved = true;
    }
    if (!drag.moved) {
      return;
    }
    if (!drag.captured) {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.captured = true;
    }
    moveTo(drag.startOffset - (delta * 1.4) / geometryRef.current.scale, true);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      if (drag.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      dragRef.current = null;
    }
  }

  function onCardActivate(id: string, event: MouseEvent<HTMLElement>) {
    if (suppressClickRef.current) {
      event.preventDefault();
      return;
    }
    open(id);
  }

  // Keyboard focus slides the card into view; a mouse click doesn't, so a
  // press that turns into a drag doesn't jump the camera.
  function onCardFocus(id: string, event: FocusEvent<HTMLElement>) {
    setFocusedId(id);
    const trackItem = trackItemsById[id];
    if (trackItem && event.currentTarget.matches(":focus-visible")) {
      centerOn(centerOf(trackItem));
    }
  }

  function onCardBlur(id: string) {
    setFocusedId((current) => (current === id ? null : current));
  }

  // ---------- Dependencies ----------

  const activeId = hoveredId ?? focusedId ?? selectedId;
  const relations = useMemo(() => {
    const prerequisites: TrackItem[] = [];
    const neededBy: TrackItem[] = [];
    if (!activeId || !itemsById[activeId]) {
      return { prerequisites, neededBy, ids: new Set<string>() };
    }
    for (const id of itemsById[activeId].milestone.depends_on) {
      if (trackItemsById[id]) {
        prerequisites.push(trackItemsById[id]);
      }
    }
    for (const item of dependents(activeId, groups)) {
      const trackItem = trackItemsById[item.milestone.id];
      if (trackItem) {
        neededBy.push(trackItem);
      }
    }
    const ids = new Set<string>();
    for (const trackItem of [...prerequisites, ...neededBy]) {
      ids.add(trackItem.item.milestone.id);
    }
    return { prerequisites, neededBy, ids };
  }, [activeId, itemsById, trackItemsById, groups]);

  function toneFor(id: string): CardTone {
    if (!activeId || relations.ids.size === 0 || id === activeId) {
      return null;
    }
    return relations.ids.has(id) ? "related" : "dimmed";
  }

  // ---------- Render ----------

  const scale = geometry.scale;
  const viewWidth = geometry.screenWidth / scale;
  const insets = insetsForWidth(geometry.screenWidth, Boolean(selectedItem), introOpen);
  const inView: [number, number] | null = cameraX === null ? null : [cameraX - 200, cameraX + viewWidth + 80];
  const focusX =
    cameraX === null ? null : cameraX + (insets.left + (geometry.screenWidth - insets.left - insets.right) / 2) / scale;
  const readout = focusX === null ? null : readoutFor(layout, focusX);
  const sliderValue = focusX === null ? 0 : Math.max(0, Math.min(100, Math.round((focusX / layout.worldWidth) * 100)));

  // Related cards that are off screen get a chip at the screen's edge.
  const edgeSource = focusedId ?? selectedId;
  const edgeChips: { trackItem: TrackItem; side: "left" | "right"; relation: "prerequisite" | "dependent" }[] = [];
  if (edgeSource && edgeSource === activeId && cameraX !== null) {
    const viewLeft = cameraX + insets.left / scale;
    const viewRight = cameraX + (geometry.screenWidth - insets.right) / scale;
    const candidates = [
      ...relations.prerequisites.map((trackItem) => ({ trackItem, relation: "prerequisite" as const })),
      ...relations.neededBy.map((trackItem) => ({ trackItem, relation: "dependent" as const })),
    ];
    for (const candidate of candidates) {
      const { x } = candidate.trackItem;
      if (x + CARD_WIDTH < viewLeft) {
        edgeChips.push({ ...candidate, side: "left" });
      } else if (x > viewRight) {
        edgeChips.push({ ...candidate, side: "right" });
      }
    }
  }

  const listGroups = groups.filter((group) => shown.has(group.technology));
  const visibleCount = flattenItems(listGroups).length;
  const sceneStyle = {
    "--tilt": `${geometry.tiltDeg}deg`,
    "--world-scale": String(scale),
    "--bar-h": `${barHeight}px`,
    "--top-h": `${topHeight}px`,
    "--inset-left": `${insets.left}px`,
    "--inset-right": `${insets.right}px`,
  } as CSSProperties;

  return (
    <div
      ref={sceneRef}
      className={`${styles.scene} ${selectedItem ? styles.panelOpen : ""}`}
      style={sceneStyle}
      onScroll={(event) => {
        // Nothing inside should scroll the scene itself; undo it if a browser tries.
        event.currentTarget.scrollLeft = 0;
        event.currentTarget.scrollTop = 0;
      }}
    >
      <div className={styles.sky} aria-hidden="true" />

      {/* ---------- Top bar: first in the DOM, so Tab reaches it before the cards ---------- */}
      <header ref={barRef} className={styles.topBar}>
        <Link href="/" className={styles.back} aria-label="Minds in the Loop, home">
          <span aria-hidden="true">&larr;</span>
          <span className={styles.backWide}>
            Minds <em>in the</em> Loop
          </span>
          <span className={styles.backNarrow}>Home</span>
        </Link>

        <div className={styles.titleBlock} data-title-block>
          <p className={styles.eyebrow}>
            Timeline
            {IS_DRAFT && <span className={styles.draft}>Draft</span>}
          </p>
          <p className={`${styles.readout} ${readout?.word ? styles.readoutWord : ""}`}>{readout ? readout.text : " "}</p>
        </div>

        <div className={styles.controls}>
          <div className={styles.showInline}>
            <ShowControl name="track-show-inline" filter={filter} counts={counts} short onChange={chooseFilter} />
          </div>
          <div className={styles.filterWrap}>
            <button
              ref={filterButtonRef}
              type="button"
              className={styles.toolButton}
              aria-expanded={showFilter}
              aria-controls="track-filter"
              onClick={() => {
                setShowFilter(!showFilter);
                setShowLegend(false);
              }}
            >
              <FilterIcon />
              <span>
                Show
                <span className={styles.filterValue}>
                  : {filter === "all" ? "All" : TECHNOLOGIES.find((tech) => tech.id === filter)?.short}
                </span>
              </span>
            </button>
            {showFilter && (
              <div id="track-filter" className={styles.popover} data-scrollable>
                <ShowControl name="track-show-popover" filter={filter} counts={counts} onChange={chooseFilter} />
              </div>
            )}
          </div>
          <button
            ref={keyButtonRef}
            type="button"
            className={styles.toolButton}
            aria-expanded={showLegend}
            aria-controls="track-key"
            onClick={() => {
              setShowLegend(!showLegend);
              setShowFilter(false);
            }}
          >
            Key
          </button>
          <button
            ref={listButtonRef}
            type="button"
            className={`${styles.toolButton} ${styles.listButton}`}
            onClick={() => setShowList(true)}
          >
            List<span className={styles.listWord}> view</span>
          </button>
          {showLegend && (
            <Legend
              onClose={() => {
                setShowLegend(false);
                keyButtonRef.current?.focus();
              }}
              onShowIntro={reopenIntro}
            />
          )}
        </div>
      </header>

      {/* ---------- The intro holds the page's h1 ---------- */}
      {introOpen ? (
        <section className={styles.intro} aria-labelledby="timeline-title">
          <h1 id="timeline-title" className={styles.introTitle}>
            When might these milestones <em>happen</em>?
          </h1>
          <p className={styles.introText}>{introSummary(allItems)}</p>
          {includeSamples && (
            <p className={styles.introNote}>This internal copy includes the worked examples, which never appear on the public site.</p>
          )}
          <p className={styles.introHint}>
            <span className={styles.hintWide}>Scroll, drag or use the arrow keys to move through time.</span>
            <span className={styles.hintNarrow}>Swipe to move through time.</span> Select a card to see what it&rsquo;s based on.
          </p>
          <div className={styles.introActions}>
            <button type="button" className={styles.introPrimary} onClick={dismissIntro}>
              Got it
            </button>
            <button type="button" className={styles.introSecondary} onClick={() => setShowList(true)}>
              See them as a list
            </button>
          </div>
        </section>
      ) : (
        <h1 className="visually-hidden">{TITLE}</h1>
      )}

      {notice && (
        <div className={styles.notice} role="status">
          <p>{notice}</p>
          <button type="button" className={styles.toolButton} onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* ---------- The track ---------- */}
      <section
        ref={stageRef}
        className={styles.stage}
        tabIndex={-1}
        aria-label="Timeline. Scroll, swipe or use the arrow keys to move through time."
        style={{ perspective: `${geometry.perspective}px`, perspectiveOrigin: `50% ${geometry.horizon * 100}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={floorRef}
          className={parts.floor}
          style={{ width: layout.worldWidth, height: FLOOR_DEPTH, bottom: geometry.floorBottom }}
        >
          <FloorMarks layout={layout} nowYear={nowYear} />
          {layout.items.map((trackItem) => (
            <FloorTrace
              key={`trace-${trackItem.item.milestone.id}`}
              trackItem={trackItem}
              layout={layout}
              dimmed={toneFor(trackItem.item.milestone.id) === "dimmed"}
            />
          ))}
          <DependencyLinks
            worldWidth={layout.worldWidth}
            active={activeId ? (trackItemsById[activeId] ?? null) : null}
            prerequisites={relations.prerequisites}
            dependents={relations.neededBy}
          />
          {layout.datedCount === 0 && layout.items.length > 0 && (
            <EmptyDatesNote
              x={layout.nowX + 140}
              covered={sheetCovers}
              hasUnknown={layout.unknownZone !== null}
              onGo={() => centerOn(endCenter(layout))}
              onFocus={() => centerOn(layout.nowX + 290)}
            />
          )}
          {layout.items.map((trackItem, index) => {
            const id = trackItem.item.milestone.id;
            const up = reducedMotion || (inView !== null && trackItem.x + CARD_WIDTH > inView[0] && trackItem.x < inView[1]);
            return (
              <TrackCard
                key={id}
                trackItem={trackItem}
                up={up}
                delay={(index % 4) * 70}
                selected={id === selectedId}
                tone={toneFor(id)}
                needs={trackItem.item.milestone.depends_on.length}
                variant={cardVariant}
                onActivate={onCardActivate}
                onFocusCard={onCardFocus}
                onBlurCard={onCardBlur}
                onHoverChange={setHoveredId}
              />
            );
          })}
        </div>
      </section>

      <div className={styles.horizonFade} aria-hidden="true" />

      {edgeChips.length > 0 && (
        <div className={styles.edgeChips}>
          {edgeChips.map(({ trackItem, side, relation }) => {
            const code = trackItem.item.code;
            const how = relation === "prerequisite" ? "needed first" : "depends on this one";
            return (
              <button
                key={`${side}-${trackItem.item.milestone.id}`}
                type="button"
                className={`${styles.edgeChip} ${side === "left" ? styles.edgeLeft : styles.edgeRight}`}
                aria-label={`Show ${code}, ${trackItem.item.milestone.name} (${how})`}
                onClick={() => centerOn(centerOf(trackItem))}
              >
                {side === "left" && <span aria-hidden="true">&larr;</span>}
                {code}
                {side === "right" && <span aria-hidden="true">&rarr;</span>}
              </button>
            );
          })}
        </div>
      )}

      <footer className={styles.bottomBar} inert={sheetCovers}>
        <MiniMap
          layout={layout}
          nowYear={nowYear}
          windowRef={windowRef}
          value={sliderValue}
          valueText={readout ? readout.text : ""}
          narrow={screenWidth < 600}
          onScrub={(worldX, instant) => centerOn(worldX, instant)}
          onStep={(direction) => moveTo(targetRef.current + direction * viewWidth * 0.3)}
        />
        <p className={styles.hint}>
          <span className={styles.hintWide}>
            Scroll, drag or use the arrow keys to move through time. Select a card to see what it&rsquo;s based on.
          </span>
          <span className={styles.hintNarrow}>Swipe to move through time. Tap a card to open it.</span>
        </p>
      </footer>

      {selectedItem && (
        <aside
          ref={panelRef}
          className={styles.panel}
          data-scrollable
          role="dialog"
          aria-modal="false"
          aria-labelledby="track-dossier-title"
        >
          <MilestonePanel
            key={selectedItem.milestone.id}
            item={selectedItem}
            itemsById={itemsById}
            neededFor={dependents(selectedItem.milestone.id, groups)}
            sources={sources}
            headingId="track-dossier-title"
            headingRef={headingRef}
            onClose={close}
            onSelectMilestone={open}
          />
        </aside>
      )}

      {showList && (
        <div
          className={styles.listLayer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="track-list-title"
          onKeyDown={(event) => trapTab(event, listRef.current)}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowList(false);
              listButtonRef.current?.focus();
            }
          }}
        >
          <div ref={listRef} className={styles.listSheet} data-scrollable>
            <div className={styles.listHead}>
              <h2 id="track-list-title">
                Every milestone as a <em>list</em>
              </h2>
              <button
                type="button"
                className={styles.toolButton}
                onClick={() => {
                  setShowList(false);
                  listButtonRef.current?.focus();
                }}
                autoFocus
              >
                Close
              </button>
            </div>
            <div className={styles.listFilter}>
              <ShowControl name="track-show-list" filter={filter} counts={counts} short onChange={chooseFilter} />
            </div>
            <TimelineList groups={listGroups} selectedId={selectedId} onSelect={open} itemsById={itemsById} />
            {visibleCount === 0 && <p className={styles.listEmpty}>Nothing to show for this technology yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Overlay pieces ----------

function FilterIcon() {
  return (
    <svg className={styles.filterIcon} viewBox="0 0 14 14" aria-hidden="true">
      <path d="M1.5 3h11M3.5 7h7M5.5 11h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface ShowControlProps {
  name: string;
  filter: Filter;
  counts: Record<string, number>;
  short?: boolean;
  onChange: (filter: Filter) => void;
}

// One choice: everything, or one technology. A technology with nothing on the
// timeline yet stays listed, with its zero, but can't be picked.
function ShowControl({ name, filter, counts, short = false, onChange }: ShowControlProps) {
  const options: { id: Filter; label: string; count: number; technology: Technology | null }[] = [
    { id: "all", label: "All", count: counts.all, technology: null },
  ];
  for (const tech of TECHNOLOGIES) {
    if (tech.id === "hybrid" && counts.hybrid === 0) {
      continue;
    }
    options.push({ id: tech.id, label: short ? tech.short : tech.label, count: counts[tech.id], technology: tech.id });
  }
  return (
    <fieldset className={`${styles.show} ${short ? styles.showShort : ""}`}>
      <legend className={styles.showLegend}>Show</legend>
      <div className={styles.showOptions}>
        {options.map((option) => (
          <label key={option.id} className={styles.showOption} data-disabled={option.count === 0 ? "true" : "false"}>
            <input
              type="radio"
              className={styles.showInput}
              name={name}
              value={option.id}
              checked={filter === option.id}
              disabled={option.count === 0}
              onChange={() => onChange(option.id)}
            />
            <span className={styles.showText}>
              {option.technology && <TechGlyph technology={option.technology} />}
              {option.label}
              <span className={styles.showCount}>{option.count}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Legend({ onClose, onShowIntro }: { onClose: () => void; onShowIntro: () => void }) {
  return (
    <div id="track-key" className={styles.legend} data-scrollable role="dialog" aria-label="How to read the timeline">
      <div className={styles.legendHead}>
        <p className={styles.eyebrow}>Key</p>
        <button type="button" className={styles.toolButton} onClick={onClose}>
          Close
        </button>
      </div>
      <ul className={styles.legendList}>
        <li>
          <RibbonSwatch />
          <span>Solid ribbon: a range the team set, with the reasons written down</span>
        </li>
        <li>
          <FaintRibbonSwatch />
          <span>Faint ribbon: the years the forecasts cover, when they roughly agree</span>
        </li>
        <li>
          <LineSwatch />
          <span>Thin line: one forecast. A red line disagrees with another forecast.</span>
        </li>
        <li>
          <AchievedDot />
          <span>Dot: the year it was reached</span>
        </li>
        <li>
          <NeverCross />
          <span>Cross in the Never zone: someone said it will never happen</span>
        </li>
        <li>
          <span className={styles.legendStamp}>Sources disagree</span>
          <span>Forecasts more than {DISAGREEMENT_GAP_YEARS} years apart, or one says never</span>
        </li>
        <li>
          <UnknownZoneSwatch />
          <span>Timing unknown: no forecast and no team range yet</span>
        </li>
        <li>
          <DependencySwatch />
          <span>Curved line: one milestone needs another first. The arrow points at the one that waits.</span>
        </li>
      </ul>
      <p className={styles.legendStages}>
        <span className={styles.legendStagesLabel}>Color shows the stage:</span>
        <span className={styles.legendStage}>
          <span className={`${styles.legendDot} ${parts.stage_possible}`} aria-hidden="true" />
          {enumLabel("Stage", "possible")}
        </span>
        <span className={styles.legendStage}>
          <span className={`${styles.legendDot} ${parts.stage_widely}`} aria-hidden="true" />
          {enumLabel("Stage", "widely_available")}
        </span>
        <span className={styles.legendStage}>
          <span className={`${styles.legendDot} ${parts.stage_helping}`} aria-hidden="true" />
          {enumLabel("Stage", "actually_helping")}
        </span>
      </p>
      <p className={styles.legendMore}>
        <Link href="/methodology/">How we read forecasts</Link>
        <button type="button" className={styles.linkButton} onClick={onShowIntro}>
          Show the introduction again
        </button>
      </p>
    </div>
  );
}

// A dashed placeholder standing just after Now when nothing shown has a date.
interface EmptyDatesNoteProps {
  x: number;
  // Under the intro sheet, so not focusable for now.
  covered: boolean;
  hasUnknown: boolean;
  onGo: () => void;
  // Tabbing to its button brings the note into view.
  onFocus: () => void;
}

function EmptyDatesNote({ x, covered, hasUnknown, onGo, onFocus }: EmptyDatesNoteProps) {
  return (
    <div className={parts.post} style={{ left: x, top: rowY(0) }} inert={covered}>
      <div className={styles.emptyNote}>
        <p className={styles.emptyTitle}>No dates yet</p>
        <p className={styles.emptyText}>None of these milestones has a team range, a forecast or a year it was reached.</p>
        {hasUnknown && (
          <button type="button" className={styles.emptyButton} onClick={onGo} onFocus={onFocus}>
            Go to Timing unknown <span aria-hidden="true">&rarr;</span>
          </button>
        )}
      </div>
    </div>
  );
}

interface MiniMapProps {
  layout: TrackLayout;
  nowYear: number;
  windowRef: RefObject<HTMLDivElement | null>;
  value: number;
  valueText: string;
  onScrub: (worldX: number, instant: boolean) => void;
  onStep: (direction: number) => void;
  // On a phone the strip is short, so it labels fewer decades.
  narrow?: boolean;
}

// The whole track in one strip. It's a slider: click or drag to scrub, or
// focus it and use the arrow keys.
function MiniMap({ layout, nowYear, windowRef, value, valueText, onScrub, onStep, narrow = false }: MiniMapProps) {
  const total = layout.worldWidth;
  const pressedRef = useRef(false);

  // Decade labels, skipping any that would crowd the one before.
  const marks: { year: number; x: number }[] = [];
  for (const tick of layout.ticks) {
    if (!tick.major) {
      continue;
    }
    const previous = marks.length > 0 ? marks[marks.length - 1] : null;
    if (!previous || (tick.x - previous.x) / total > (narrow ? 0.13 : 0.055)) {
      marks.push({ year: tick.year, x: tick.x });
    }
  }

  function percent(worldX: number): string {
    return `${(worldX / total) * 100}%`;
  }

  function worldAt(event: ReactPointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, fraction)) * total;
  }

  return (
    <div
      className={styles.miniMap}
      role="slider"
      tabIndex={0}
      aria-label="Position on the timeline"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={valueText}
      onPointerDown={(event) => {
        pressedRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        onScrub(worldAt(event), false);
      }}
      onPointerMove={(event) => {
        if (pressedRef.current) {
          onScrub(worldAt(event), true);
        }
      }}
      onPointerUp={() => {
        pressedRef.current = false;
      }}
      onPointerCancel={() => {
        pressedRef.current = false;
      }}
      onKeyDown={(event) => {
        // Left, right, Page, Home and End are handled for the whole scene.
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onStep(1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          onStep(-1);
        }
      }}
    >
      {layout.neverZone && (
        <div
          className={styles.miniNever}
          style={{ left: percent(layout.neverZone.start), width: percent(layout.neverZone.end - layout.neverZone.start) }}
        />
      )}
      {layout.unknownZone && (
        <div
          className={styles.miniUnknown}
          style={{ left: percent(layout.unknownZone.start), width: percent(layout.unknownZone.end - layout.unknownZone.start) }}
        >
          <span className={styles.miniZoneLabel}>Unknown</span>
        </div>
      )}
      {marks.map((mark) => (
        <span key={mark.year} className={styles.miniMark} style={{ left: percent(mark.x) }}>
          {mark.year}
        </span>
      ))}
      <span className={styles.miniNow} style={{ left: percent(layout.yearToX(nowYear)) }} />
      {layout.items.map((trackItem) => (
        <span
          key={trackItem.item.milestone.id}
          className={`${styles.miniDot} ${parts[`stage_${stageKey(trackItem.item.milestone.stage)}`]}`}
          style={{ left: percent(centerOf(trackItem)), top: trackItem.row === 2 ? 6 : 15 }}
        />
      ))}
      <div ref={windowRef} className={styles.miniWindow} />
    </div>
  );
}
