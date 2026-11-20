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
// must stay below the measured top bar, so cards never rise behind it. On a
// small phone where three rows of cards would leave their small lines too
// small to read, the cards stand in two rows instead (see needsFewerRows).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";

import { TypeLegend } from "@/components/provenance/Legends";
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
import { enumLabel, enumValues } from "@/lib/enums";
import { DISAGREEMENT_GAP_YEARS } from "@/lib/estimates";
import { IS_DRAFT, PRIMARY_NAV, startsMenuOnlyEnd } from "@/lib/site";
import type { SourceRef } from "@/lib/sources";
import type { Milestone, Stage, Technology } from "@/lib/types";

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
import { FloorMarks, FloorTrace, TECHNOLOGIES, TechGlyph, TrackCard, yearLabels, type CardTone } from "./TrackParts";
import {
  CARD_WIDTH,
  FEWER_ROW_COUNT,
  FLOOR_DEPTH,
  LAST_YEAR,
  ROW_COUNT,
  cardsFit,
  centerOf,
  fitScale,
  highestFloorBottom,
  layoutTrack,
  needsFewerRows,
  rowY,
  settleScale,
  textFloors,
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
// Room between the bottom bar and the floor's front edge, so the year labels
// standing there never sit on the mini map.
const YEAR_LABEL_ROOM = 20;
// Below this height, such as a phone held sideways, the cards come out too
// small to read, so the timeline opens on the list.
const SHORT_SCREEN = "(max-height: 500px)";
// How small the world may draw when even the smallest readable scale can't
// fit the cards between the bars (trackLayout's MIN_FIT_SCALE is 0.3).
const SMALLEST_SCALE = 0.15;
// The mini map labels every free decade above this width, and only a few
// years below it.
const SPARSE_MAP_WIDTH = 600;
// Below this width (a phone, as in geometryFor) the cards stand in two rows
// instead of three when three can't keep their small lines readable.
const FEWER_ROWS_WIDTH = 600;

// ---------- Screen geometry ----------

interface SceneGeometry extends FloorView {
  scale: number;
  screenWidth: number;
}

// Where the camera goes just after the cards change rows (see the fit
// effect): back to the start (`restart`), or else to the card that was in
// the middle of the screen (`cardId`). An open dossier's card comes first
// either way. `instant` is false after a filter change, when it glides.
interface RowSwitch {
  restart: boolean;
  cardId: string | null;
  instant: boolean;
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
// floor less, sit it higher, and draw the world smaller. Phones also look
// from further away (a weaker perspective, like the home teaser's), so the
// back row shrinks less: with a closer one, its small lines drew under
// trackLayout's 11px minimum even at their largest size. The floor's front
// edge sits at least `bottomReserve` above the bottom of the screen (the
// bottom bar plus room for the year labels), which matters on short screens.
// The fit can bring it back down a little when the cards need the room.
function geometryFor(screenWidth: number, screenHeight: number, bottomReserve: number): SceneGeometry {
  const narrow = screenWidth <= 900;
  let scale = 1;
  let perspective = 1350;
  if (screenWidth < 600) {
    scale = 0.62;
    perspective = 2400;
  } else if (narrow) {
    scale = 0.8;
    perspective = 1100;
  }
  return {
    height: screenHeight,
    floorBottom: Math.max(Math.round(screenHeight * (narrow ? 0.17 : 0.13)), bottomReserve),
    horizon: 0.06,
    perspective,
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

// Far rows draw smaller, so each row gets its own minimum size for the small
// card lines, set on the floor as --text-floor-0 to --text-floor-2 (the cards'
// CSS picks theirs up). Set straight on the DOM, so the cards can be measured
// again right away.
function applyTextFloors(floor: HTMLElement | null, view: FloorView, scale: number) {
  if (!floor) {
    return;
  }
  const floors = textFloors(view, scale);
  for (let row = 0; row < floors.length; row++) {
    floor.style.setProperty(`--text-floor-${row}`, `${floors[row].toFixed(1)}px`);
  }
}

// The world scale that fits, and the tallest card in each row, if the cards
// stood in the rows `rows` gives them (the three-row or the two-row layout),
// with the text floors those rows settle at. needsFewerRows uses it to tell
// whether three rows can be read on this screen. It works whatever layout is
// showing: while it measures, each card gets the text floor of its row in
// `rows` straight on its own style (which wins over the one its data-row
// picks), and loses it again after.
function fitInRows(
  floor: HTMLElement | null,
  view: SceneGeometry,
  safeTop: number,
  rows: TrackLayout,
): { heights: number[]; scale: number } {
  let heights = [0, 0, 0];
  if (!floor) {
    return { heights, scale: view.scale };
  }
  const rowOf = new Map<string, number>();
  for (const trackItem of rows.items) {
    rowOf.set(trackItem.item.milestone.id, trackItem.row);
  }
  const cards = Array.from(floor.querySelectorAll<HTMLElement>("[data-card-id]"));
  let floors = [0, 0, 0];
  // Sets every card's floor first and only then reads the heights, so the
  // browser lays the cards out once per round, not once per card.
  function measure(): number[] {
    for (const card of cards) {
      const row = rowOf.get(card.dataset.cardId ?? "") ?? 0;
      card.style.setProperty("--text-floor", `${floors[row].toFixed(1)}px`);
    }
    heights = [0, 0, 0];
    for (const card of cards) {
      const row = rowOf.get(card.dataset.cardId ?? "") ?? 0;
      heights[row] = Math.max(heights[row], card.offsetHeight);
    }
    return heights;
  }
  const scale = settleScale(
    () => fitScale(view, measure(), safeTop, view.scale),
    (fitted) => {
      floors = textFloors(view, fitted);
    },
  );
  for (const card of cards) {
    card.style.removeProperty("--text-floor");
  }
  return { heights, scale };
}

// The id of the card whose middle is nearest a world x, or null with no cards.
function nearestCardId(layout: TrackLayout, worldX: number): string | null {
  let nearest: TrackItem | null = null;
  for (const trackItem of layout.items) {
    if (nearest === null || Math.abs(centerOf(trackItem) - worldX) < Math.abs(centerOf(nearest) - worldX)) {
      nearest = trackItem;
    }
  }
  return nearest ? nearest.item.milestone.id : null;
}

// The largest world scale (up to the view's own, down to minScale) at which
// the cards stay below safeTop. The far rows' bigger small text makes those
// cards a little taller, so settleScale fits again with the new heights
// until the scale stops moving. Every fit starts from the floors of the
// view's own scale, as a fresh load does. Starting from the floors a smaller
// screen left behind can settle on a lower scale, because wrapped text makes
// the card heights step and two scales can both settle.
function fitWorld(floor: HTMLElement | null, view: SceneGeometry, safeTop: number, minScale?: number): number {
  applyTextFloors(floor, view, view.scale);
  return settleScale(
    () => fitScale(view, measureRowHeights(floor), safeTop, view.scale, minScale),
    (scale) => applyTextFloors(floor, view, scale),
  );
}

// The camera fitted so every card stands below safeTop. `fits` is false when
// that takes a scale too small to read the cards.
function fitScene(
  floor: HTMLElement | null,
  camera: SceneGeometry,
  bottomReserve: number,
  safeTop: number,
): { view: SceneGeometry; fits: boolean } {
  let view = camera;
  let scale = fitWorld(floor, view, safeTop);
  let fits = cardsFit(view, measureRowHeights(floor), safeTop, scale);
  // On a short screen the floor stands clear of the bottom bar, with room
  // for the year labels. When that leaves the cards no room under the top
  // bar, even at the smallest readable scale, the floor comes down only as
  // far as they need. Never below the bar's own top: the labels stand a
  // little in from the floor's front edge, so they still clear it.
  if (!fits) {
    const usual = geometryFor(view.screenWidth, view.height, 0).floorBottom;
    const lowest = Math.max(usual, bottomReserve - YEAR_LABEL_ROOM);
    const floorBottom = Math.max(lowest, highestFloorBottom(view, measureRowHeights(floor), safeTop, scale));
    if (floorBottom < view.floorBottom) {
      view = { ...view, floorBottom };
      fits = cardsFit(view, measureRowHeights(floor), safeTop, scale);
    }
  }
  // Still no room. The cards can't be read on a screen this short anyway,
  // and the list is its first view, so they shrink further to keep clear of
  // both bars.
  if (!fits) {
    scale = fitWorld(floor, view, safeTop, SMALLEST_SCALE);
  }
  return { view: { ...view, scale }, fits };
}

// ---------- Small helpers ----------

// The milestone id in the address (/timeline/#wbe-legal), or "". The site's
// "Skip to content" link sets #main, which isn't a milestone, so it's ignored.
function readHash(): string {
  const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  return id === "main" ? "" : id;
}

// Opening a dossier from the track adds a history entry marked like this, so
// Back closes the dossier instead of leaving the page.
interface DossierHistoryState {
  sfDossier?: boolean;
}

function dossierEntryIsOurs(): boolean {
  const state = window.history.state as DossierHistoryState | null;
  return Boolean(state && state.sfDossier);
}

// Takes the dossier's #id off the address once it has closed. If opening it
// added the history entry, going back removes that entry, so a later Back
// doesn't land on this same page. Otherwise the address is just rewritten.
function clearDossierAddress() {
  if (dossierEntryIsOurs()) {
    window.history.back();
  } else {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
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

// The width of the "No dates yet" note on the floor, in world pixels (as in the CSS).
const EMPTY_NOTE_WIDTH = 300;
// Half the width of a big year label on the floor ("2020" in TrackParts'
// .yearMajor), and the floor kept clear to its left at the far left, in world pixels.
const YEAR_LABEL_HALF = 40;
const LABEL_EDGE_ROOM = 24;

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
    // The zone sign under the card says where they wait, so this keeps to
    // the main fact. On a phone the sheet covers that sign.
    second = total === 1 ? "It has no date yet." : "None has a date yet.";
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
  // Count the Tab stops before and after the focus. Focus can also sit on
  // something that isn't a Tab stop, such as the dossier's title.
  const active = document.activeElement;
  let before = 0;
  let after = 0;
  for (const element of focusable) {
    if (element === active) {
      continue;
    }
    if (active && active.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
      after += 1;
    } else {
      before += 1;
    }
  }
  if (event.shiftKey && before === 0) {
    event.preventDefault();
    focusable[focusable.length - 1].focus();
  } else if (!event.shiftKey && after === 0) {
    event.preventDefault();
    focusable[0].focus();
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

  // The usual three rows, or two on a small phone where three can't be read
  // (fewerRows, chosen in the fit effect). Both are worked out, since the fit
  // effect measures the cards as they'd stand in either.
  const threeRowLayout: TrackLayout = useMemo(() => layoutTrack(allItems, shown, nowYear, ROW_COUNT), [allItems, shown, nowYear]);
  const fewerRowLayout: TrackLayout = useMemo(
    () => layoutTrack(allItems, shown, nowYear, FEWER_ROW_COUNT),
    [allItems, shown, nowYear],
  );
  const [fewerRows, setFewerRows] = useState(false);
  const layout = fewerRows ? fewerRowLayout : threeRowLayout;
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
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const introTitleRef = useRef<HTMLHeadingElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const keyButtonRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const frameRef = useRef(0);
  const lastReportedRef = useRef(Number.NEGATIVE_INFINITY);
  const geometryRef = useRef<SceneGeometry>(DEFAULT_GEOMETRY);
  // Whether the dossier and the intro are open, kept in refs as well as state,
  // so the camera can center things the moment they open or close.
  const panelOpenRef = useRef(false);
  const introOpenRef = useRef(true);
  // Set when the reader asks for the intro again, so it takes focus that one time.
  const reopenedRef = useRef(false);
  const worldWidthRef = useRef(layout.worldWidth);
  // The world x of the leftmost thing on the track (Now, or an earlier card),
  // which is as far back as the camera goes.
  const leftmostRef = useRef(0);
  // How far left the first year label on the floor reaches, in world x.
  const firstLabelRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const placedRef = useRef(false);
  // Whether the list is the better view on this screen (see the fit effect).
  const listFirstRef = useRef(false);
  // fewerRows as the fit effect last chose it, whether it has chosen yet (it
  // waits for the fonts), and, just after it changes, where the camera goes
  // once the cards have moved.
  const fewerRowsRef = useRef(false);
  const rowsChosenRef = useRef(false);
  const rowSwitchRef = useRef<RowSwitch | null>(null);
  // Whether the camera has left the start (see startCenter) since it was put
  // there, by the first fit or by a change to the Show filter. The reader
  // moving it sets this (the wheel, keys, a drag, the mini map, opening a
  // card), and so does a link that opens the timeline on a milestone. When
  // the cards change rows, the camera goes back to the start only while
  // this is false; otherwise it stays with the card in the middle.
  const leftStartRef = useRef(false);
  // Set when the open dossier was picked from the list, so closing it on a
  // phone or tablet goes back to the list rather than the track.
  const fromListRef = useRef(false);
  // The list row to focus when the list comes back after a dossier.
  const listFocusRef = useRef<string | null>(null);
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
  // Whether the latest press on the track came while the site menu was open.
  const menuPressRef = useRef(false);
  // Whether the latest press on the list's dimmed backdrop started there.
  const backdropPressRef = useRef(false);

  const [geometry, setGeometry] = useState<SceneGeometry>(DEFAULT_GEOMETRY);
  // The window's size. A change to either side fits the world again.
  const [viewport, setViewport] = useState({ width: DEFAULT_GEOMETRY.screenWidth, height: DEFAULT_GEOMETRY.height });
  const screenWidth = viewport.width;
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
  const [showMenu, setShowMenu] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pathname = usePathname() ?? "";

  const selectedItem = selectedId ? (itemsById[selectedId] ?? null) : null;
  const cardVariant = screenWidth < 600 ? "large" : "regular";
  // At 900px and below the intro is a sheet over the bottom of the screen.
  // While it's up, the controls under it are inert, so Tab can't land on
  // something the reader can't see.
  const sheetCovers = introOpen && screenWidth <= 900;
  // The dossier is a sheet too at that size, over most of the screen. While
  // it's open, Tab stays inside it, the bottom bar under it is inert, and the
  // cards under it aren't Tab stops (so Tab from the track goes into it).
  const dossierCovers = selectedItem !== null && screenWidth <= 900;

  // The Show control appears once at least two technologies have milestones.
  // Until then every choice would show the same cards.
  let technologiesShown = 0;
  for (const tech of TECHNOLOGIES) {
    if (counts[tech.id] > 0) {
      technologiesShown += 1;
    }
  }
  const showFilterControl = technologiesShown >= 2;

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

  // Scrolled all the way back, the leftmost thing on the track sits about a
  // third of the way across the screen, so the view never shows only bare
  // floor from before the track starts. On a narrow screen that can cut the
  // first year label, so the camera goes back far enough to show it whole.
  const clampOffset = useCallback((value: number) => {
    const width = geometryRef.current.screenWidth / geometryRef.current.scale;
    const min = Math.min(leftmostRef.current - width * 0.35, firstLabelRef.current - LABEL_EDGE_ROOM);
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

  // moveTo and centerOn, for a move the reader asked for. The move is noted
  // (leftStartRef), so a later change to the rows keeps the reader's place
  // instead of sending the camera back to the start.
  const readerMoveTo = useCallback(
    (offset: number, instant = false) => {
      leftStartRef.current = true;
      moveTo(offset, instant);
    },
    [moveTo],
  );

  const readerCenterOn = useCallback(
    (worldX: number, instant = false) => {
      leftStartRef.current = true;
      centerOn(worldX, instant);
    },
    [centerOn],
  );

  // The world x currently at the focus point.
  function focusWorldX(): number {
    return targetRef.current + focusPoint() / geometryRef.current.scale;
  }

  // Where the camera goes once the cards stand in the rows of `target` (the
  // layout just switched to), in world x: the open dossier's card, or the
  // start, or the card that was in the middle before. `fallback` (or null)
  // when none of those applies. Read from `target`, not from the layout on
  // screen, so the camera can be placed before the cards have moved.
  function rowSwitchCenter(target: TrackLayout, rowSwitch: RowSwitch, fallback: number | null): number | null {
    const findCard = (id: string | null) => (id ? target.items.find((trackItem) => trackItem.item.milestone.id === id) : undefined);
    const selected = findCard(selectedId);
    if (selected) {
      return centerOf(selected);
    }
    if (rowSwitch.restart) {
      return startCenter(target, freeWorldWidth());
    }
    const middleCard = findCard(rowSwitch.cardId);
    return middleCard ? centerOf(middleCard) : fallback;
  }

  useEffect(() => {
    worldWidthRef.current = layout.worldWidth;
    let leftmost = layout.nowX;
    for (const trackItem of layout.items) {
      leftmost = Math.min(leftmost, trackItem.x);
    }
    leftmostRef.current = leftmost;
    const labels = yearLabels(layout);
    firstLabelRef.current = labels.length > 0 ? labels[0].x - YEAR_LABEL_HALF : leftmost;
  }, [layout]);

  // ---------- Selection ----------

  const open = useCallback(
    (id: string) => {
      const item = itemsById[id];
      if (!item) {
        setNotice(`There's no milestone called “${id}” on the timeline.`);
        return;
      }
      // Opening a dossier from a closed one adds a history entry, so Back
      // closes it. Switching to another dossier keeps the same entry. When
      // the address already names it (Forward, or a link), nothing is written.
      if (readHash() !== id) {
        const ours: DossierHistoryState = { sfDossier: true };
        if (!panelOpenRef.current) {
          window.history.pushState(ours, "", `#${id}`);
        } else {
          window.history.replaceState(dossierEntryIsOurs() ? ours : null, "", `#${id}`);
        }
      }
      setNotice(null);
      setSelectedId(id);
      setShowList(false);
      setIntroOpen(false);
      panelOpenRef.current = true;
      introOpenRef.current = false;
      leftStartRef.current = true;
      const trackItem = trackItemsById[id];
      if (trackItem) {
        centerOn(centerOf(trackItem));
      } else {
        // Its technology is filtered out: show everything, then center once laid out.
        pendingCenterRef.current = id;
        setFilter("all");
      }
      // Choosing the dossier that's already open (from the list, say) changes
      // nothing, so the focus effect won't run. Put focus on its title here.
      if (id === selectedId) {
        headingRef.current?.focus({ preventScroll: true });
      }
    },
    [itemsById, trackItemsById, centerOn, selectedId],
  );

  // Closes the dossier, keeps the camera where it is and puts focus back on
  // the card. `addressDone` is true when Back already took #id off the address.
  // Where the list is the first view, or when a phone or tablet reader picked
  // the dossier from the list, the list comes back instead, with focus on the row.
  const closeDossier = useCallback(
    (addressDone: boolean) => {
      const id = selectedId;
      const keep = focusWorldX();
      setSelectedId(null);
      panelOpenRef.current = false;
      if (!addressDone) {
        clearDossierAddress();
      }
      centerOn(keep);
      const backToList = listFirstRef.current || (fromListRef.current && geometryRef.current.screenWidth <= 900);
      fromListRef.current = false;
      if (backToList) {
        listFocusRef.current = id;
        setShowList(true);
        return;
      }
      const button = id ? document.querySelector<HTMLElement>(`[data-card-id="${id}"]`) : null;
      if (button) {
        button.focus({ preventScroll: true });
      } else {
        stageRef.current?.focus({ preventScroll: true });
      }
    },
    // focusWorldX reads refs only, so it doesn't need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, centerOn],
  );

  const close = useCallback(() => closeDossier(false), [closeDossier]);

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
    const keep = focusWorldX();
    setShowLegend(false);
    // Already showing, so nothing changes that would move focus. Move it to
    // the intro's title here, before the Key that holds the button goes.
    if (introOpenRef.current) {
      introTitleRef.current?.focus({ preventScroll: true });
      return;
    }
    // The intro and the dossier don't share the screen: opening a dossier
    // closes the intro, and bringing the intro back closes the dossier.
    if (panelOpenRef.current) {
      setSelectedId(null);
      panelOpenRef.current = false;
      clearDossierAddress();
    }
    setIntroOpen(true);
    introOpenRef.current = true;
    reopenedRef.current = true;
    centerOn(keep);
  }

  function chooseFilter(next: Filter) {
    filterChangedRef.current = true;
    setFilter(next);
    // A dossier for a milestone that's now hidden closes with it.
    if (selectedItem && next !== "all" && selectedItem.milestone.technology !== next) {
      setSelectedId(null);
      panelOpenRef.current = false;
      clearDossierAddress();
    }
  }

  // The site menu, the Show popover and the Key take turns: opening one closes the others.
  function toggleMenu() {
    setShowMenu(!showMenu);
    setShowFilter(false);
    setShowLegend(false);
  }

  // ---------- Mount: screen, motion preference, scroll lock, intro ----------

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(reducedMotionRef.current);

    // React skips the update when the size hasn't changed.
    function readViewport() {
      setViewport((current) => {
        if (current.width === window.innerWidth && current.height === window.innerHeight) {
          return current;
        }
        return { width: window.innerWidth, height: window.innerHeight };
      });
    }
    readViewport();

    geometryRef.current = { ...geometryFor(window.innerWidth, window.innerHeight, 0), scale: geometryRef.current.scale };

    // Lock the page behind the scene. The scene clips its own overflow, so
    // focusing a card near the edge can't scroll it sideways either.
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";

    window.addEventListener("resize", readViewport);
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) {
        setFontsReady(true);
      }
    });
    return () => {
      cancelled = true;
      html.style.overflow = previousOverflow;
      window.removeEventListener("resize", readViewport);
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
    const footer = footerRef.current;
    const bottomReserve = footer ? Math.ceil(window.innerHeight - footer.getBoundingClientRect().top) + YEAR_LABEL_ROOM : 0;
    const base = geometryFor(window.innerWidth, window.innerHeight, bottomReserve);
    const floor = floorRef.current;

    // On a phone, the cards stand in two rows instead of three when three
    // can't keep every row's small lines at 11px (see needsFewerRows). It's
    // chosen from the cards measured as they'd stand in three rows, so the
    // answer doesn't depend on the layout showing now, and only once the
    // fonts are in, since the fallback fonts set the text at other sizes.
    // When the answer changes, so does the layout, and this runs again.
    if (fontsReady) {
      const safeTop = topHeight + 12;
      // The first choice, and the one after the Show filter changes the
      // cards, start fresh. After that (the window resized, say), going back
      // to three rows takes a little margin, so it can't flip back and forth.
      const fresh = !rowsChosenRef.current || filterChangedRef.current;
      rowsChosenRef.current = true;
      const fewer =
        window.innerWidth < FEWER_ROWS_WIDTH &&
        needsFewerRows(
          base,
          fitInRows(floor, base, safeTop, threeRowLayout).heights,
          safeTop,
          base.scale,
          fresh ? false : fewerRowsRef.current,
        );
      if (fewer !== fewerRowsRef.current) {
        fewerRowsRef.current = fewer;
        const nextLayout = fewer ? fewerRowLayout : threeRowLayout;
        // The cards are about to move. If the camera is still at the start
        // (the reader hasn't moved it since the page loaded, or the filter
        // just changed, which puts it back there), it starts again on the
        // new layout. Otherwise it stays on the card in the middle. After a
        // filter change it glides, as it does anyway.
        const keepX = placedRef.current ? focusWorldX() : null;
        const rowSwitch: RowSwitch = {
          restart: filterChangedRef.current || !leftStartRef.current,
          cardId: keepX !== null ? nearestCardId(layout, keepX) : null,
          instant: !filterChangedRef.current,
        };
        rowSwitchRef.current = rowSwitch;
        // Fit the cards as they'll stand in the new rows now, so the new
        // layout first shows at its own scale, not the old one. The next run
        // fits it again in full (and places the camera again).
        const scale = fitInRows(floor, base, safeTop, nextLayout).scale;
        applyTextFloors(floor, base, scale);
        geometryRef.current = { ...base, scale };
        setGeometry(geometryRef.current);
        // The camera goes where it will stand in the new rows now too, so
        // their first frame already shows the cards it will settle on.
        const center = keepX !== null ? rowSwitchCenter(nextLayout, rowSwitch, keepX) : null;
        if (center !== null) {
          centerOn(center, rowSwitch.instant);
        }
        setFewerRows(fewer);
        return;
      }
    }

    let fitted = fitScene(floor, base, bottomReserve, topHeight + 12);
    // On a short screen, such as a phone held sideways, the cards come out
    // too small to read (or can't fit at all), so the list is the first view.
    const listFirst = !fitted.fits || window.matchMedia(SHORT_SCREEN).matches;
    const becameListFirst = listFirst && !listFirstRef.current;
    listFirstRef.current = listFirst;
    // The notice about a missing milestone sits just under the top bar.
    // While it shows, the cards stay below it too, unless that would make
    // readable cards too small to read. Then it covers them until it's dismissed.
    const noticeBottom = noticeRef.current ? Math.ceil(noticeRef.current.getBoundingClientRect().bottom) : 0;
    if (noticeBottom > topHeight) {
      const belowNotice = fitScene(floor, base, bottomReserve, noticeBottom + 12);
      fitted = belowNotice.fits || !fitted.fits ? belowNotice : fitScene(floor, base, bottomReserve, topHeight + 12);
    }
    const keep = placedRef.current ? focusWorldX() : null;
    const rowSwitch = rowSwitchRef.current;
    rowSwitchRef.current = null;
    const next = fitted.view;
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
        leftStartRef.current = true;
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
      if (listFirst) {
        setShowList(true);
      }
      leftStartRef.current = false;
      centerOn(startCenter(layout, freeWorldWidth()), true);
    } else {
      // Turning a phone sideways opens the list too, as a fresh load would.
      // An open dossier stays, and closing it brings the list back.
      if (becameListFirst && !panelOpenRef.current) {
        setShowList(true);
      }
      // Just after the rows change, the cards stand somewhere else. The open
      // dossier's card stays in view (a link to /timeline/#id opens on it),
      // or else the camera goes where rowSwitch says (see rowSwitchCenter),
      // now at the scale just fitted. Otherwise it keeps its place.
      const center = rowSwitch ? rowSwitchCenter(layout, rowSwitch, keep) : keep;
      if (center !== null) {
        centerOn(center, rowSwitch ? rowSwitch.instant : true);
      }
    }
    // Runs when the screen, the cards or the bar change size, and when the
    // notice comes or goes. Selection and intro changes move the camera themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height, layout, cardVariant, topHeight, fontsReady, notice]);

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
    leftStartRef.current = false;
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

  // After "Show the introduction again", focus moves to the intro's title, so
  // it isn't lost along with the Key that held the button. Not on first load.
  useEffect(() => {
    if (introOpen && reopenedRef.current) {
      reopenedRef.current = false;
      introTitleRef.current?.focus({ preventScroll: true });
    }
  }, [introOpen]);

  // When the list comes back after a dossier, focus goes to that milestone's
  // row instead of the list's Close button.
  useEffect(() => {
    const id = listFocusRef.current;
    if (showList && id) {
      listFocusRef.current = null;
      listRef.current?.querySelector<HTMLElement>(`[data-row-id="${id}"]`)?.focus();
    }
  }, [showList]);

  // Links that change only the hash (/timeline/#wbe-legal) open that milestone.
  // A hash that names no milestone shows the notice and closes the open
  // dossier, so the address and the panel never disagree. Moving to an
  // address with no milestone clears an old notice.
  useEffect(() => {
    function onHashChange() {
      const id = readHash();
      if (!id) {
        setNotice(null);
        return;
      }
      if (id === selectedId) {
        return;
      }
      fromListRef.current = false;
      if (!itemsById[id] && panelOpenRef.current) {
        closeDossier(true);
      }
      open(id);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [open, closeDossier, itemsById, selectedId]);

  // Back (or the Back swipe) to an address without a hash closes the open
  // dossier. The address has already changed, so nothing is written. The
  // site's "Skip to content" link (#main) also fires this, and leaves it open.
  useEffect(() => {
    function onPopState() {
      if (window.location.hash === "" && panelOpenRef.current) {
        closeDossier(true);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [closeDossier]);

  // While the site menu is open, a press anywhere outside it closes it.
  useEffect(() => {
    if (!showMenu) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const menu = menuRef.current;
      if (menu && !menu.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showMenu]);

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
      readerMoveTo(targetRef.current + (delta * lineScale * 1.1) / geometryRef.current.scale);
    }
    scene.addEventListener("wheel", onWheel, { passive: false });
    return () => scene.removeEventListener("wheel", onWheel);
  }, [readerMoveTo, showList]);

  // Keyboard: arrows and Page keys move through time, Home is Now, End is the
  // far end, Esc closes whatever is on top.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (showList) {
          setShowList(false);
          listButtonRef.current?.focus();
        } else if (showMenu) {
          setShowMenu(false);
          menuButtonRef.current?.focus();
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
        readerMoveTo(targetRef.current + width * (event.key === "PageDown" ? 0.8 : 0.3));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        readerMoveTo(targetRef.current - width * (event.key === "PageUp" ? 0.8 : 0.3));
      } else if (event.key === "Home") {
        event.preventDefault();
        readerCenterOn(layout.nowX);
      } else if (event.key === "End") {
        event.preventDefault();
        readerCenterOn(endCenter(layout));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, layout, readerMoveTo, readerCenterOn, selectedId, showLegend, showFilter, showList, showMenu, notice]);

  // Drags can start anywhere on the track, cards included. Pointer capture
  // starts only once the pointer has really moved, so a plain click still
  // reaches the card. On touch screens a vertical swipe moves through time too.
  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    // A press on the track while the site menu is open only closes the menu.
    menuPressRef.current = showMenu;
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
    readerMoveTo(drag.startOffset - (delta * 1.4) / geometryRef.current.scale, true);
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

  // The click that ends a press which closed the site menu opens nothing, so
  // tapping away from the menu doesn't open the card under the finger. A click
  // from the keyboard (detail 0) never follows such a press.
  function onStageClickCapture(event: MouseEvent<HTMLElement>) {
    if (menuPressRef.current && event.detail > 0) {
      menuPressRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onCardActivate(id: string, event: MouseEvent<HTMLElement>) {
    if (suppressClickRef.current) {
      event.preventDefault();
      return;
    }
    fromListRef.current = false;
    open(id);
  }

  function openFromList(id: string) {
    fromListRef.current = true;
    open(id);
  }

  // Keyboard focus slides the card into view; a mouse click doesn't, so a
  // press that turns into a drag doesn't jump the camera.
  function onCardFocus(id: string, event: FocusEvent<HTMLElement>) {
    setFocusedId(id);
    const trackItem = trackItemsById[id];
    if (trackItem && event.currentTarget.matches(":focus-visible")) {
      readerCenterOn(centerOf(trackItem));
    }
  }

  function onCardBlur(id: string) {
    setFocusedId((current) => (current === id ? null : current));
  }

  // A dossier opens with focus on its title, but its technology link and
  // Close button sit in the row above the title. Tab from the title goes to
  // them first and then on down the dossier. Otherwise they would come only
  // after the rest of the page. On a phone or tablet Tab also stays inside.
  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const panel = panelRef.current;
    if (event.key === "Tab" && !event.shiftKey && panel && event.target === headingRef.current) {
      const first = panel.querySelector<HTMLElement>("a[href], button:not([disabled])");
      if (first) {
        event.preventDefault();
        first.focus();
        return;
      }
    }
    if (dossierCovers) {
      trapTab(event, panel);
    }
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
  // The stretch of track the reader can see, in world x.
  const viewLeft = cameraX === null ? 0 : cameraX + insets.left / scale;
  const viewRight = cameraX === null ? 0 : cameraX + (geometry.screenWidth - insets.right) / scale;

  // The "No dates yet" note's button is a Tab stop only while the note is on
  // screen. Off screen, tabbing to it would swing the camera back to Now, and
  // the next Tab would swing it out to the cards again.
  const emptyNoteX = layout.nowX + 140;
  const emptyNoteOnScreen = cameraX !== null && emptyNoteX + EMPTY_NOTE_WIDTH > viewLeft && emptyNoteX < viewRight;

  // Related cards that are off screen get a chip at the screen's edge.
  const edgeSource = focusedId ?? selectedId;
  const edgeChips: { trackItem: TrackItem; side: "left" | "right"; relation: "prerequisite" | "dependent" }[] = [];
  if (edgeSource && edgeSource === activeId && cameraX !== null) {
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
        {/* The page covers the site header, so the site's pages are one menu away. */}
        <nav
          ref={menuRef}
          className={styles.siteMenu}
          aria-label="Main"
          onBlur={(event) => {
            // Tabbing past the last link closes the menu.
            const next = event.relatedTarget as Node | null;
            if (next && !event.currentTarget.contains(next)) {
              setShowMenu(false);
            }
          }}
        >
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.back}
            aria-expanded={showMenu}
            aria-controls={showMenu ? "track-site-menu" : undefined}
            onClick={toggleMenu}
          >
            <span className={styles.menuIcon} aria-hidden="true" />
            <span className={styles.backWide}>
              Minds <em>in the</em> Loop<span className="visually-hidden"> menu</span>
            </span>
            <span className={styles.backNarrow}>Menu</span>
          </button>
          {showMenu && (
            <ul id="track-site-menu" className={styles.menuList} data-scrollable>
              <li>
                <Link href="/" className={styles.menuLink} onClick={() => setShowMenu(false)}>
                  Home
                </Link>
              </li>
              {PRIMARY_NAV.map((item, index) => (
                <li key={item.href} className={startsMenuOnlyEnd(PRIMARY_NAV, index) ? styles.menuSecondary : undefined}>
                  <Link
                    href={item.href}
                    className={styles.menuLink}
                    aria-current={pathname.startsWith(item.href) ? "page" : undefined}
                    onClick={() => setShowMenu(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className={styles.titleBlock} data-title-block>
          <p className={styles.eyebrow}>
            Timeline
            {IS_DRAFT && <span className={styles.draft}>Draft</span>}
          </p>
          <p className={`${styles.readout} ${readout?.word ? styles.readoutWord : ""}`}>{readout ? readout.text : " "}</p>
        </div>

        <div className={styles.controls}>
          {showFilterControl && (
            <div className={styles.showInline}>
              <ShowControl name="track-show-inline" filter={filter} counts={counts} short onChange={chooseFilter} />
            </div>
          )}
          {showFilterControl && (
            <div className={styles.filterWrap}>
              <button
                ref={filterButtonRef}
                type="button"
                className={styles.toolButton}
                aria-expanded={showFilter}
                aria-controls={showFilter ? "track-filter" : undefined}
                onClick={() => {
                  setShowFilter(!showFilter);
                  setShowLegend(false);
                  setShowMenu(false);
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
          )}
          <button
            ref={keyButtonRef}
            type="button"
            className={styles.toolButton}
            aria-expanded={showLegend}
            aria-controls={showLegend ? "track-key" : undefined}
            onClick={() => {
              setShowLegend(!showLegend);
              setShowFilter(false);
              setShowMenu(false);
            }}
          >
            Key
          </button>
          <button
            ref={listButtonRef}
            type="button"
            className={styles.toolButton}
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
              onFocusLeave={(next) => {
                // Tabbing out of the Key closes it, as Tab past the site menu
                // does, so focus never lands on something the Key covers (on a
                // phone, the top of the dossier). The Key button is left out:
                // it opens and closes the Key itself.
                if (next !== keyButtonRef.current) {
                  setShowLegend(false);
                }
              }}
              onShowIntro={reopenIntro}
              layout={layout}
            />
          )}
        </div>
      </header>

      {/* ---------- The intro holds the page's h1 ---------- */}
      {introOpen ? (
        <section className={styles.intro} aria-labelledby="timeline-title">
          <h1 id="timeline-title" ref={introTitleRef} tabIndex={-1} className={styles.introTitle}>
            When might these milestones <em>happen</em>?
          </h1>
          <p className={styles.introText}>{introSummary(allItems)}</p>
          {includeSamples && (
            <p className={styles.introNote}>This internal copy includes the worked examples, which never appear on the public site.</p>
          )}
          <p className={styles.introHint}>
            <span className={styles.hintWide}>Scroll, drag or use the arrow keys to move through time.</span>
            <span className={styles.hintNarrow}>Swipe to move through time.</span> Select a card to open it.
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
        <div ref={noticeRef} className={styles.notice} role="status">
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
        onClickCapture={onStageClickCapture}
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
              x={emptyNoteX}
              covered={sheetCovers || dossierCovers}
              onScreen={emptyNoteOnScreen}
              hasUnknown={layout.unknownZone !== null}
              onGo={() => {
                readerCenterOn(endCenter(layout));
                // The button slides off screen with the note, so focus moves to
                // the track. The next Tab reaches the first card there.
                stageRef.current?.focus({ preventScroll: true });
              }}
              onFocus={() => readerCenterOn(layout.nowX + 290)}
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
                tabbable={!dossierCovers}
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
        <div className={styles.edgeChips} inert={dossierCovers}>
          {edgeChips.map(({ trackItem, side, relation }) => {
            const code = trackItem.item.code;
            const how = relation === "prerequisite" ? "needed first" : "depends on this one";
            return (
              <button
                key={`${side}-${trackItem.item.milestone.id}`}
                type="button"
                className={`${styles.edgeChip} ${side === "left" ? styles.edgeLeft : styles.edgeRight}`}
                aria-label={`Show ${code}, ${trackItem.item.milestone.name} (${how})`}
                onClick={() => readerCenterOn(centerOf(trackItem))}
              >
                {side === "left" && <span aria-hidden="true">&larr;</span>}
                {code}
                {side === "right" && <span aria-hidden="true">&rarr;</span>}
              </button>
            );
          })}
        </div>
      )}

      <footer ref={footerRef} className={styles.bottomBar} inert={sheetCovers || dossierCovers}>
        <MiniMap
          layout={layout}
          nowYear={nowYear}
          windowRef={windowRef}
          value={sliderValue}
          valueText={readout ? readout.text : ""}
          onScrub={(worldX, instant) => readerCenterOn(worldX, instant)}
          onStep={(direction) => readerMoveTo(targetRef.current + direction * viewWidth * 0.3)}
        />
        {/* The intro says the same thing, so this waits until it closes. It
            keeps its space meanwhile, so the mini map doesn't jump. */}
        <p className={`${styles.hint} ${introOpen ? styles.hintWaiting : ""}`}>
          <span className={styles.hintWide}>
            Scroll, drag or use the arrow keys to move through time. Select a card to open it.
          </span>
          <span className={styles.hintNarrow}>Swipe to move through time. Tap a card to open it.</span>
        </p>
      </footer>

      {/* A div, not an aside: an aside can't take the dialog role. */}
      {selectedItem && (
        <div
          ref={panelRef}
          className={styles.panel}
          data-scrollable
          role="dialog"
          aria-modal={dossierCovers ? "true" : "false"}
          aria-labelledby="track-dossier-title"
          onKeyDown={onPanelKeyDown}
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
            siteLinks
          />
        </div>
      )}

      {showList && (
        <div
          className={styles.listLayer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="track-list-title"
          onKeyDown={(event) => trapTab(event, listRef.current)}
          onPointerDown={(event) => {
            backdropPressRef.current = event.target === event.currentTarget;
            if (backdropPressRef.current) {
              // Without this the press goes on to move focus to the page itself.
              event.preventDefault();
            }
          }}
          onClick={(event) => {
            // Closing on the click, not the press, so a tap's click can't go
            // on to the card under the backdrop once the list has gone.
            if (backdropPressRef.current && event.target === event.currentTarget) {
              backdropPressRef.current = false;
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
            {showFilterControl && (
              <div className={styles.listFilter}>
                <ShowControl name="track-show-list" filter={filter} counts={counts} short onChange={chooseFilter} />
              </div>
            )}
            <TimelineList groups={listGroups} selectedId={selectedId} onSelect={openFromList} itemsById={itemsById} />
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
// timeline yet isn't offered, since picking it would show an empty track.
function ShowControl({ name, filter, counts, short = false, onChange }: ShowControlProps) {
  const options: { id: Filter; label: string; count: number; technology: Technology | null }[] = [
    { id: "all", label: "All", count: counts.all, technology: null },
  ];
  for (const tech of TECHNOLOGIES) {
    if (counts[tech.id] === 0) {
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

interface LegendProps {
  onClose: () => void;
  // Focus moved from inside the Key to `next`, outside it.
  onFocusLeave: (next: Node) => void;
  onShowIntro: () => void;
  // What the track draws right now, so the Key can lead with those marks.
  layout: TrackLayout;
}

// The kinds of mark the Key explains, one per row.
type KeyMark =
  | "solid-ribbon"
  | "faint-ribbon"
  | "thin-line"
  | "dot"
  | "never-cross"
  | "disagree-stamp"
  | "unknown-zone"
  | "curved-line";

interface KeyRow {
  mark: KeyMark;
  glyph: ReactNode;
  text: string;
}

// Which marks the track draws for the milestones it shows, worked out from
// the same layout the floor and cards use.
function marksOnTrack(layout: TrackLayout): Set<KeyMark> {
  const marks = new Set<KeyMark>();
  const shownIds = new Set<string>();
  for (const trackItem of layout.items) {
    shownIds.add(trackItem.item.milestone.id);
  }
  for (const trackItem of layout.items) {
    const { item, band } = trackItem;
    if (band && band.kind === "team") {
      marks.add("solid-ribbon");
    }
    if (band && band.kind === "span") {
      marks.add("faint-ribbon");
    }
    if (trackItem.placement === "dated" && trackItem.forecastLines.length > 0) {
      marks.add("thin-line");
    }
    if (item.view.barMode === "achieved") {
      marks.add("dot");
    }
    // FloorTrace draws the cross only for a dated milestone. One whose
    // forecasts all say never stands in the Never zone with no cross.
    if (trackItem.placement === "dated" && trackItem.neverCount > 0 && layout.neverZone) {
      marks.add("never-cross");
    }
    if (item.view.disagreement.flagged) {
      marks.add("disagree-stamp");
    }
    if (trackItem.placement === "unknown") {
      marks.add("unknown-zone");
    }
    // A curved line is drawn only between two milestones that are both shown.
    for (const id of item.milestone.depends_on) {
      if (shownIds.has(id)) {
        marks.add("curved-line");
      }
    }
  }
  return marks;
}

// The Key leads with the marks on the track now, then the stage colors. The
// rest wait, word for word, under "Not on the track yet", and move up on
// their own once dates, forecasts or dependencies arrive.
function Legend({ onClose, onFocusLeave, onShowIntro, layout }: LegendProps) {
  const rows: KeyRow[] = [
    {
      mark: "solid-ribbon",
      glyph: <RibbonSwatch />,
      text: "Solid ribbon: a range the team set, with the reasons written down",
    },
    {
      mark: "faint-ribbon",
      glyph: <FaintRibbonSwatch />,
      text: "Faint ribbon: the years the forecasts cover, when they roughly agree",
    },
    {
      mark: "thin-line",
      glyph: <LineSwatch />,
      text: "Thin line: one forecast. A red line disagrees with another forecast.",
    },
    { mark: "dot", glyph: <AchievedDot />, text: "Dot: the year it was reached" },
    {
      mark: "never-cross",
      glyph: <NeverCross />,
      text: "Cross in the Never zone: someone said it will never happen",
    },
    {
      mark: "disagree-stamp",
      glyph: <span className={styles.legendStamp}>Sources disagree</span>,
      text: `Forecasts more than ${DISAGREEMENT_GAP_YEARS} years apart, or one says never`,
    },
    {
      mark: "unknown-zone",
      glyph: <UnknownZoneSwatch />,
      text: "Timing unknown: no forecast and no team range yet",
    },
    {
      mark: "curved-line",
      glyph: <DependencySwatch />,
      text: "Curved line: one milestone needs another first. The arrow points at the one that waits.",
    },
  ];

  const onTrack = marksOnTrack(layout);
  const shownRows = rows.filter((row) => onTrack.has(row.mark));
  const otherRows = rows.filter((row) => !onTrack.has(row.mark));

  return (
    <div
      id="track-key"
      className={styles.legend}
      data-scrollable
      role="dialog"
      aria-label="How to read the timeline"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) {
          onFocusLeave(next);
        }
      }}
    >
      <div className={styles.legendHead}>
        <p className={styles.eyebrow}>Key</p>
        <button type="button" className={styles.toolButton} onClick={onClose}>
          Close
        </button>
      </div>
      {shownRows.length > 0 && <LegendRows rows={shownRows} />}
      <div className={`${styles.legendStages} ${shownRows.length === 0 ? styles.legendStagesFirst : ""}`}>
        <p className={styles.legendStagesLabel}>Colour shows the stage:</p>
        <ul className={styles.legendStageList}>
          {enumValues("Stage").map((info, index) => (
            <li key={info.value} className={styles.legendStage}>
              <span
                className={`${styles.legendDot} ${parts[`stage_${stageKey(info.value as Stage)}`]}`}
                aria-hidden="true"
              />
              <span>
                <span className={styles.legendStageName}>
                  {index + 1} {info.label}.
                </span>{" "}
                {info.description}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {/* Every card has a type, so all three are always shown */}
      <div className={styles.legendTypes}>
        <p className={styles.legendStagesLabel}>Milestone types:</p>
        <TypeLegend />
      </div>
      {otherRows.length > 0 && (
        <details className={styles.legendOther}>
          <summary className={styles.legendOtherSummary}>Not on the track yet ({otherRows.length})</summary>
          <LegendRows rows={otherRows} />
        </details>
      )}
      <p className={styles.legendMore}>
        <Link href="/methodology/#timeline">How we read forecasts</Link>
        <button type="button" className={styles.linkButton} onClick={onShowIntro}>
          Show the introduction again
        </button>
      </p>
    </div>
  );
}

function LegendRows({ rows }: { rows: KeyRow[] }) {
  return (
    <ul className={styles.legendList}>
      {rows.map((row) => (
        <li key={row.mark}>
          {row.glyph}
          <span>{row.text}</span>
        </li>
      ))}
    </ul>
  );
}

// A dashed placeholder standing just after Now when nothing shown has a date.
interface EmptyDatesNoteProps {
  x: number;
  // Under the intro sheet or the dossier sheet, so not focusable for now.
  covered: boolean;
  // Whether any of the note is on screen. Its button is a Tab stop only then.
  onScreen: boolean;
  hasUnknown: boolean;
  onGo: () => void;
  // Tabbing to its button brings the whole note into view.
  onFocus: () => void;
}

function EmptyDatesNote({ x, covered, onScreen, hasUnknown, onGo, onFocus }: EmptyDatesNoteProps) {
  return (
    <div className={parts.post} style={{ left: x, top: rowY(0) }} inert={covered}>
      <div className={styles.emptyNote}>
        <p className={styles.emptyTitle}>No dates yet</p>
        <p className={styles.emptyText}>None of these milestones has a team range, a forecast or a year it was reached.</p>
        {hasUnknown && (
          <button type="button" className={styles.emptyButton} tabIndex={onScreen ? 0 : -1} onClick={onGo} onFocus={onFocus}>
            Go to Timing{" "}
            <span className={styles.emptyButtonEnd}>
              unknown <span aria-hidden="true">&rarr;</span>
            </span>
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
}

// The whole track in one strip. It's a slider: click or drag to scrub, or
// focus it and use the arrow keys.
function MiniMap({ layout, nowYear, windowRef, value, valueText, onScrub, onStep }: MiniMapProps) {
  const total = layout.worldWidth;
  const pressedRef = useRef(false);
  const mapRef = useRef<HTMLDivElement>(null);
  // The strip's width on screen: narrower on a phone and beside the dossier.
  const [mapWidth, setMapWidth] = useState(940);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const observer = new ResizeObserver(() => setMapWidth(map.clientWidth));
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  // Decade labels, skipping any that would crowd the one before. A short
  // strip labels only the first decade, each half century and the last year,
  // so the labels it keeps are evenly spread instead of jumping. A longer
  // strip labels every decade until one would crowd the one before, and from
  // there on only the half centuries and the last year, for the same reason.
  const sparse = mapWidth < SPARSE_MAP_WIDTH;
  let thinned = sparse;
  const marks: { year: number; x: number }[] = [];
  for (const tick of layout.ticks) {
    if (!tick.major) {
      continue;
    }
    const previous = marks.length > 0 ? marks[marks.length - 1] : null;
    const kept = !thinned || !previous || tick.year % 50 === 0 || tick.year === LAST_YEAR;
    if (!kept) {
      continue;
    }
    if (!previous || (tick.x - previous.x) / total > (sparse ? 0.08 : 0.055)) {
      marks.push({ year: tick.year, x: tick.x });
    } else {
      thinned = true;
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
      ref={mapRef}
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
