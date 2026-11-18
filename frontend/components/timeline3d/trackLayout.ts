// Where everything sits on the 3D track, in "world" pixels along the track.
// Pure functions, no React, so the full scene, the home page teaser and the
// mini map all share one layout.
//
// Time is compressed in two ways. Each era gets its own pixels per year: the
// recent past is a short lead-in, the next few decades get the most room, and
// the far future goes faster. On top of that, a decade with nothing in it
// shrinks to 30%, so empty stretches pass quickly. After 2100 come the Never
// zone and the "Timing unknown" zone, each drawn only when something is in it.
import { earliestRelevantYear } from "@/lib/estimates";
import type { Technology } from "@/lib/types";

import type { TimelineItem } from "../timeline/timelineModel";

// Pixels per year in each era, before the empty-decade compression.
const ERAS: { until: number; px: number }[] = [
  { until: 2014, px: 16 },
  { until: 2026, px: 34 },
  { until: 2050, px: 130 },
  { until: 2075, px: 62 },
  { until: 2100, px: 30 },
];

// The track starts here unless something happened earlier (an achievement in
// 1986, say), in which case it starts at that decade.
export const DEFAULT_FIRST_YEAR = 2014;
export const LAST_YEAR = 2100;
const EMPTY_DECADE_SHARE = 0.3;
const MIN_TICK_GAP = 64;
// Blank floor before the first year, so the camera can center Now (or an early
// card) without running out of track on the left.
const LEAD_IN = 560;

export const CARD_WIDTH = 250;
const CARD_GAP = 48;
export const ROW_COUNT = 3;

// ---------- The floor ----------
// Depths are distances from the floor's front edge, in world pixels. Row 2
// stands far enough behind row 0 that a front card's top stays below the
// back row's feet, so it never covers a back card's stage line. That depends
// on how tall the cards are: tests/trackLayout.test.ts checks the budget with
// the teaser's camera, the tightest one (see frontRowClearance). Row 1 sits
// between them and would cover the bottom of a row 2 card, so the layout
// never lets it share x with rows 0 or 2.
export const FLOOR_DEPTH = 1000;
export const AXIS_DEPTH = 70;
export const ROW_DEPTHS = [200, 510, 820];

// The y inside the floor element (0 is the back edge) where a row stands.
export function rowY(row: number): number {
  return FLOOR_DEPTH - ROW_DEPTHS[Math.min(row, ROW_DEPTHS.length - 1)];
}

// ---------- Zones after 2100 ----------
const ZONE_GAP = 220;
const ZONE_LEAD = 90; // the first card stands this far into a zone
const ZONE_COLUMN = CARD_WIDTH + 70;
const ZONE_TAIL = 160;
const NEVER_MIN_WIDTH = 460;
const WORLD_TAIL = 320; // empty floor after the last zone

export type Placement = "dated" | "never" | "unknown";

export interface TrackItem {
  item: TimelineItem;
  placement: Placement;
  x: number; // where the card stands
  row: number; // 0 is the front row, nearest the viewer
  anchorYear: number | null;
  // Where the anchor year is. The card stands here unless the rows are
  // crowded, in which case it moves right and a leader on the floor points
  // back to its year.
  anchorX: number;
  // When the card shares its row with another milestone's marks, its own
  // marks move down into the next free lane so the two never overlap.
  lane: number;
  // The solid or faint ribbon on the floor, in world x. null when the mode has none.
  band: { x1: number; x2: number; kind: "team" | "span"; openRight: boolean; openLeft: boolean } | null;
  // Each dated forecast as a thin line on the floor, plus "never" crosses.
  forecastLines: { id: string; x1: number; x2: number; openLeft: boolean; openRight: boolean; expired: boolean }[];
  neverCount: number;
}

export interface Zone {
  start: number;
  end: number;
}

export interface Tick {
  year: number;
  x: number;
  major: boolean;
}

export interface TrackLayout {
  firstYear: number;
  yearToX: (year: number) => number;
  // The year at a world x on the dated stretch (fractional).
  xToYear: (x: number) => number;
  datedEnd: number;
  nowX: number;
  neverZone: Zone | null;
  unknownZone: Zone | null;
  worldWidth: number;
  items: TrackItem[];
  ticks: Tick[];
  datedCount: number;
}

// ---------- The year scale ----------

function eraPx(year: number): number {
  for (const era of ERAS) {
    if (year < era.until) {
      return era.px;
    }
  }
  return ERAS[ERAS.length - 1].px;
}

function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

interface YearScale {
  firstYear: number;
  // starts[i] is the world x where year firstYear + i begins; the last entry is LAST_YEAR.
  starts: number[];
  markedDecades: Set<number>;
}

function makeScale(markYears: number[]): YearScale {
  let earliest = DEFAULT_FIRST_YEAR;
  const markedDecades = new Set<number>();
  for (const year of markYears) {
    if (year < earliest) {
      earliest = year;
    }
    markedDecades.add(decadeOf(Math.min(LAST_YEAR - 1, year)));
  }
  // Start one decade boundary before the earliest mark, so it has room to its left.
  const firstYear = earliest < DEFAULT_FIRST_YEAR ? decadeOf(earliest - 1) : DEFAULT_FIRST_YEAR;

  const starts: number[] = [LEAD_IN];
  for (let year = firstYear; year < LAST_YEAR; year++) {
    const share = markedDecades.has(decadeOf(year)) ? 1 : EMPTY_DECADE_SHARE;
    starts.push(starts[starts.length - 1] + eraPx(year) * share);
  }
  return { firstYear, starts, markedDecades };
}

function scaleYearToX(scale: YearScale, year: number): number {
  const clamped = Math.min(LAST_YEAR, Math.max(scale.firstYear, year));
  const index = Math.floor(clamped - scale.firstYear);
  if (index >= scale.starts.length - 1) {
    return scale.starts[scale.starts.length - 1];
  }
  const fraction = clamped - scale.firstYear - index;
  return scale.starts[index] + fraction * (scale.starts[index + 1] - scale.starts[index]);
}

function scaleXToYear(scale: YearScale, x: number): number {
  const starts = scale.starts;
  if (x <= starts[0]) {
    return scale.firstYear;
  }
  for (let i = 0; i < starts.length - 1; i++) {
    if (x < starts[i + 1]) {
      return scale.firstYear + i + (x - starts[i]) / (starts[i + 1] - starts[i]);
    }
  }
  return LAST_YEAR;
}

// Ticks every 2 years in the detailed stretch, then every 5, then every 10.
// A decade that was compressed only gets its decade tick, and a minor tick that
// would crowd its neighbour is dropped.
function makeTicks(scale: YearScale): Tick[] {
  const candidates: Tick[] = [];
  for (let year = scale.firstYear + 1; year <= LAST_YEAR; year++) {
    let step = 10;
    const compressed = !scale.markedDecades.has(decadeOf(Math.min(LAST_YEAR - 1, year)));
    if (!compressed && year >= 2026 && year < 2050) {
      step = 2;
    } else if (!compressed && year >= 2050 && year < 2075) {
      step = 5;
    }
    if (year % step === 0) {
      candidates.push({ year, x: scaleYearToX(scale, year), major: year % 10 === 0 });
    }
  }

  const ticks: Tick[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const tick = candidates[i];
    if (!tick.major) {
      const previous = ticks.length > 0 ? ticks[ticks.length - 1] : null;
      const next = i + 1 < candidates.length ? candidates[i + 1] : null;
      if (previous && tick.x - previous.x < MIN_TICK_GAP) {
        continue;
      }
      if (next && next.major && next.x - tick.x < MIN_TICK_GAP) {
        continue;
      }
    }
    ticks.push(tick);
  }
  return ticks;
}

// ---------- Items ----------

function hasOnlyNeverForecasts(item: TimelineItem): boolean {
  const forecasts = item.view.forecasts;
  if (forecasts.length === 0) {
    return false;
  }
  for (const forecast of forecasts) {
    if (!forecast.never) {
      return false;
    }
  }
  return true;
}

// The year a card stands at: the leftmost thing the milestone puts on the
// track (when it happened, where our range starts, or its earliest forecast),
// so its ribbon and forecast lines always run to the right of its card.
// null means it has no date at all.
function anchorYearFor(item: TimelineItem): number | null {
  const view = item.view;
  if (view.achievedIn !== null) {
    return view.achievedIn;
  }
  let anchor: number | null = null;
  if (view.bar && view.bar.start !== null) {
    anchor = view.bar.start;
  }
  for (const forecast of view.forecasts) {
    if (forecast.never) {
      continue;
    }
    const year = forecast.earliest ?? forecast.latest;
    if (year !== null && (anchor === null || year < anchor)) {
      anchor = year;
    }
  }
  if (anchor === null) {
    anchor = earliestRelevantYear(view);
  }
  return anchor;
}

// Every year a milestone puts a mark at: its anchor, its ribbon's ends and its
// forecasts' ends. A long ribbon's middle years don't count, so the empty
// decades it crosses still shrink.
function markYearsOf(item: TimelineItem): number[] {
  const years: number[] = [];
  const anchor = anchorYearFor(item);
  if (anchor !== null) {
    years.push(anchor);
  }
  const bar = item.view.bar;
  if (bar) {
    if (bar.start !== null) {
      years.push(bar.start);
    }
    if (bar.end !== null) {
      years.push(bar.end);
    }
  }
  for (const forecast of item.view.forecasts) {
    if (forecast.earliest !== null) {
      years.push(forecast.earliest);
    }
    if (forecast.latest !== null) {
      years.push(forecast.latest);
    }
  }
  return years;
}

// How far right a milestone's marks reach on its row. An open-ended ribbon
// would block the row forever, so it counts for a fixed stretch only.
const OPEN_END_RESERVE = 900;

function marksReach(trackItem: TrackItem): number {
  let reach = trackItem.anchorX + 40;
  if (trackItem.band) {
    const end = trackItem.band.openRight ? trackItem.anchorX + OPEN_END_RESERVE : trackItem.band.x2;
    reach = Math.max(reach, end);
  }
  for (const line of trackItem.forecastLines) {
    const end = line.openRight ? trackItem.anchorX + OPEN_END_RESERVE : line.x2;
    reach = Math.max(reach, end);
  }
  return reach;
}

// How many lanes a milestone's marks take: its ribbon or dot, plus one per forecast line.
function laneCount(trackItem: TrackItem): number {
  return 1 + trackItem.forecastLines.length;
}

function cardsOverlap(a: number, b: number): boolean {
  return Math.abs(a - b) < CARD_WIDTH + CARD_GAP;
}

// Front row first, then the back row (which a front card never covers), then
// the middle row.
const ROW_PREFERENCE = [0, 2, 1];
// How much a crowded row counts against a choice, in world pixels of nudging.
const SHARED_ROW_COST = 300;

interface RowState {
  cardEnd: number; // the right edge of the last card in the row
  marks: { end: number; laneEnd: number }[]; // each milestone's marks on this row
}

// The first x at or after `from` where a card fits in this row: clear of the
// row's last card and of every card in a neighbouring row.
function firstFreeX(row: number, from: number, state: RowState, placed: TrackItem[]): number {
  let x = Math.max(from, state.cardEnd + CARD_GAP);
  let moved = true;
  while (moved) {
    moved = false;
    for (const other of placed) {
      if (Math.abs(other.row - row) === 1 && cardsOverlap(other.x, x)) {
        x = other.x + CARD_WIDTH + CARD_GAP;
        moved = true;
      }
    }
  }
  return x;
}

// The lane a milestone's marks start in: below any marks on the row that are
// still running where this one's begin.
function freeLane(state: RowState, anchorX: number): number {
  let lane = 0;
  for (const mark of state.marks) {
    if (mark.end > anchorX) {
      lane = Math.max(lane, mark.laneEnd);
    }
  }
  return lane;
}

// Give each dated card a row and a standing x. A card stands at its year when
// it can. When every row is busy there, it takes the row where it has to move
// right the least, and a crowded row costs extra because its marks have to
// share lanes.
function assignRows(items: TrackItem[]): void {
  const rows: RowState[] = [];
  for (let row = 0; row < ROW_COUNT; row++) {
    rows.push({ cardEnd: -Infinity, marks: [] });
  }
  const placed: TrackItem[] = [];
  for (const trackItem of items) {
    let bestRow = ROW_PREFERENCE[0];
    let bestX = 0;
    let bestCost = Infinity;
    for (let rank = 0; rank < ROW_PREFERENCE.length; rank++) {
      const row = ROW_PREFERENCE[rank];
      const x = firstFreeX(row, trackItem.anchorX, rows[row], placed);
      const shared = freeLane(rows[row], trackItem.anchorX) > 0;
      const cost = x - trackItem.anchorX + (shared ? SHARED_ROW_COST : 0) + rank;
      if (cost < bestCost) {
        bestCost = cost;
        bestRow = row;
        bestX = x;
      }
    }
    const state = rows[bestRow];
    trackItem.row = bestRow;
    trackItem.x = bestX;
    trackItem.lane = freeLane(state, trackItem.anchorX);
    state.cardEnd = bestX + CARD_WIDTH;
    state.marks.push({ end: marksReach(trackItem), laneEnd: trackItem.lane + laneCount(trackItem) });
    placed.push(trackItem);
  }
}

// Cards in a zone after 2100 stand in a zigzag: front, back, front, back, with
// the back row shifted half a column so every card shows in full.
function placeInZone(cards: TrackItem[], zoneStart: number): number {
  for (let i = 0; i < cards.length; i++) {
    const column = Math.floor(i / 2);
    const back = i % 2 === 1;
    cards[i].x = zoneStart + ZONE_LEAD + column * ZONE_COLUMN + (back ? ZONE_COLUMN / 2 : 0);
    cards[i].anchorX = cards[i].x;
    cards[i].row = back ? 2 : 0;
  }
  const columns = Math.ceil(cards.length / 2);
  const halfColumn = cards.length > 1 ? ZONE_COLUMN / 2 : 0;
  return ZONE_LEAD + columns * ZONE_COLUMN + halfColumn + ZONE_TAIL;
}

export function layoutTrack(items: TimelineItem[], technologies: Set<Technology>, nowYear: number): TrackLayout {
  const visible: TimelineItem[] = [];
  for (const item of items) {
    if (technologies.has(item.milestone.technology)) {
      visible.push(item);
    }
  }

  const markYears: number[] = [nowYear];
  for (const item of visible) {
    for (const year of markYearsOf(item)) {
      markYears.push(year);
    }
  }
  const scale = makeScale(markYears);
  const yearToX = (year: number) => scaleYearToX(scale, year);
  const datedEnd = yearToX(LAST_YEAR);

  const dated: TrackItem[] = [];
  const never: TrackItem[] = [];
  const unknown: TrackItem[] = [];
  let anyNeverForecast = false;

  for (const item of visible) {
    const view = item.view;
    const anchorYear = anchorYearFor(item);

    const forecastLines: TrackItem["forecastLines"] = [];
    let neverCount = 0;
    for (const forecast of view.forecasts) {
      if (forecast.never) {
        neverCount += 1;
        continue;
      }
      const openLeft = forecast.earliest === null;
      const openRight = forecast.latest === null;
      const x1 =
        forecast.earliest !== null
          ? yearToX(forecast.earliest)
          : yearToX(Math.max(scale.firstYear, (forecast.latest ?? LAST_YEAR) - 8));
      const x2 = forecast.latest !== null ? yearToX(forecast.latest) : datedEnd;
      forecastLines.push({ id: forecast.id, x1, x2, openLeft, openRight, expired: forecast.isExpired });
    }
    if (neverCount > 0) {
      anyNeverForecast = true;
    }

    let band: TrackItem["band"] = null;
    if ((view.barMode === "team" || view.barMode === "span") && view.bar) {
      const start = view.bar.start;
      const end = view.bar.end;
      band = {
        x1: start !== null ? yearToX(start) : yearToX(scale.firstYear),
        x2: end !== null ? yearToX(end) : datedEnd,
        kind: view.barMode,
        openLeft: start === null,
        openRight: end === null,
      };
    }

    const trackItem: TrackItem = {
      item,
      placement: "dated",
      x: 0,
      row: 0,
      anchorYear,
      anchorX: 0,
      lane: 0,
      band,
      forecastLines,
      neverCount,
    };

    if (anchorYear !== null) {
      trackItem.anchorX = yearToX(anchorYear);
      trackItem.x = trackItem.anchorX;
      dated.push(trackItem);
    } else if (hasOnlyNeverForecasts(item)) {
      trackItem.placement = "never";
      never.push(trackItem);
    } else {
      trackItem.placement = "unknown";
      unknown.push(trackItem);
    }
  }

  dated.sort((a, b) => a.anchorX - b.anchorX);
  assignRows(dated);

  // The zones after 2100 exist only when something is in them.
  let cursor = datedEnd;
  let neverZone: Zone | null = null;
  if (never.length > 0 || anyNeverForecast) {
    const start = cursor + ZONE_GAP;
    const width = Math.max(NEVER_MIN_WIDTH, placeInZone(never, start));
    neverZone = { start, end: start + width };
    cursor = neverZone.end;
  }
  let unknownZone: Zone | null = null;
  if (unknown.length > 0) {
    const start = cursor + ZONE_GAP;
    unknownZone = { start, end: start + placeInZone(unknown, start) };
    cursor = unknownZone.end;
  }

  return {
    firstYear: scale.firstYear,
    yearToX,
    xToYear: (x: number) => scaleXToYear(scale, x),
    datedEnd,
    nowX: yearToX(nowYear),
    neverZone,
    unknownZone,
    worldWidth: cursor + WORLD_TAIL,
    items: [...dated, ...never, ...unknown],
    ticks: makeTicks(scale),
    datedCount: dated.length,
  };
}

// The world x of a card's middle, for centering the camera on it.
export function centerOf(trackItem: TrackItem): number {
  return trackItem.x + CARD_WIDTH / 2;
}

// The middle of the cards in a zone, for opening the camera on it.
export function zoneCenter(layout: TrackLayout, zone: Zone): number {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const trackItem of layout.items) {
    if (trackItem.x >= zone.start && trackItem.x <= zone.end) {
      left = Math.min(left, trackItem.x);
      right = Math.max(right, trackItem.x + CARD_WIDTH);
    }
  }
  if (left > right) {
    return (zone.start + zone.end) / 2;
  }
  return (left + right) / 2;
}

// ---------- Fitting the floor to the screen ----------

export interface FloorView {
  height: number; // the scene's height in screen pixels
  floorBottom: number; // the floor's front edge, measured up from the scene's bottom
  horizon: number; // perspective origin, as a fraction of the height
  perspective: number;
  tiltDeg: number;
}

// Where the top of a standing card of the given height lands on screen, for a
// card at the given depth and world scale. This is the same projection the
// browser does for the CSS: the floor is scaled, tilted back by tiltDeg around
// its front edge, and seen with the given perspective.
export function projectedCardTop(view: FloorView, scale: number, depth: number, cardHeight: number): number {
  const tilt = (view.tiltDeg * Math.PI) / 180;
  const originY = view.horizon * view.height;
  const frontY = view.height - view.floorBottom;
  const y = frontY - scale * depth * Math.cos(tilt) - scale * cardHeight;
  const z = -scale * depth * Math.sin(tilt);
  return originY + ((y - originY) * view.perspective) / (view.perspective - z);
}

// How far below the back row's feet the top of a front-row card of the given
// height lands on screen, in screen pixels. A negative value means the front
// card covers the bottom of the back cards, where their stage line is.
export function frontRowClearance(view: FloorView, scale: number, frontHeight: number): number {
  const frontTop = projectedCardTop(view, scale, ROW_DEPTHS[0], frontHeight);
  const backFeet = projectedCardTop(view, scale, ROW_DEPTHS[ROW_COUNT - 1], 0);
  return frontTop - backFeet;
}

// The home page teaser's camera: the floor tilted well back and seen from
// close up, so the track reads as deep. A close perspective draws the back
// row smaller, so the teaser is `height` tall: the least (with a few pixels
// to spare) at which the back row's small lines still draw at
// MIN_DRAWN_TEXT, every card stays under the top, and a front card's top
// stays below the back row's feet. At 420px this camera drew the back row's
// small lines at about 10px. The tests in tests/trackLayout.test.ts check all
// three. It lives here, not in TrackTeaser.tsx, so the tests can use it.
export const TEASER_CAMERA = {
  tiltDeg: 56,
  perspective: 1000,
  horizon: 0.04,
  floorBottom: 0, // the floor runs right to the teaser's bottom edge
  safeTop: 16,
  maxScale: 0.7,
  height: 480,
};

// The teaser's camera on a window too short for TEASER_CAMERA.height (the
// CSS caps the teaser under the site header): the gentler tilt and farther
// perspective the full track uses on a phone (TrackScene's geometryFor).
// The back row shrinks less from far away, so the cards fit in about 420px
// with every small line still at MIN_DRAWN_TEXT.
export const TEASER_SHORT_CAMERA = {
  ...TEASER_CAMERA,
  tiltDeg: 50,
  perspective: 2400,
};

// The smallest world scale fitScale tries, unless it's given another. Below
// it the cards can't be read.
const MIN_FIT_SCALE = 0.3;

// Whether every card stays below safeTop at this world scale. rowHeights[r]
// is the tallest card in row r, or 0 for an empty row.
export function cardsFit(view: FloorView, rowHeights: number[], safeTop: number, scale: number): boolean {
  for (let row = 0; row < rowHeights.length; row++) {
    if (rowHeights[row] > 0 && projectedCardTop(view, scale, ROW_DEPTHS[row], rowHeights[row]) < safeTop) {
      return false;
    }
  }
  return true;
}

// The largest world scale (up to maxScale) at which every card stays below
// safeTop. When nothing fits, it returns minScale anyway; cardsFit says
// whether that happened.
export function fitScale(
  view: FloorView,
  rowHeights: number[],
  safeTop: number,
  maxScale: number,
  minScale = MIN_FIT_SCALE,
): number {
  if (cardsFit(view, rowHeights, safeTop, maxScale)) {
    return maxScale;
  }
  let low = minScale;
  let high = maxScale;
  for (let i = 0; i < 20; i++) {
    const middle = (low + high) / 2;
    if (cardsFit(view, rowHeights, safeTop, middle)) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

// The highest the floor's front edge can sit (as a floorBottom, at most the
// view's own) with every card still below safeTop at this world scale.
// Lowering the floor by a pixel lowers a card's top by less than a pixel,
// because perspective draws the far rows smaller.
export function highestFloorBottom(view: FloorView, rowHeights: number[], safeTop: number, scale: number): number {
  const tilt = (view.tiltDeg * Math.PI) / 180;
  let highest = view.floorBottom;
  for (let row = 0; row < rowHeights.length; row++) {
    if (rowHeights[row] === 0) {
      continue;
    }
    const top = projectedCardTop(view, scale, ROW_DEPTHS[row], rowHeights[row]);
    const shrink = view.perspective / (view.perspective + scale * ROW_DEPTHS[row] * Math.sin(tilt));
    highest = Math.min(highest, view.floorBottom - (safeTop - top) / shrink);
  }
  return highest;
}

// How much a card in this row is drawn at, compared with its size in world
// pixels: the world scale times the perspective shrink at the row's depth.
// Cards stand facing the reader, so every part of one shrinks by the same amount.
export function rowDrawScale(view: FloorView, scale: number, row: number): number {
  const tilt = (view.tiltDeg * Math.PI) / 180;
  const depth = ROW_DEPTHS[Math.min(row, ROW_DEPTHS.length - 1)];
  const z = -scale * depth * Math.sin(tilt);
  return (scale * view.perspective) / (view.perspective - z);
}

// The small lines on a card (its code, its type and its stage) should draw at
// least this big on screen, whatever row the card stands in.
export const MIN_DRAWN_TEXT = 11;
// The largest those small lines may grow to get there, in CSS pixels. At
// 28px "Deployment" no longer fits beside its glyph on a 250px card, and
// "Welfare and governance" takes three lines, so this stays a little under.
const MAX_TEXT_FLOOR = 26;

// The smallest CSS size for a card's small lines in each row, so they draw at
// MIN_DRAWN_TEXT or more. Far rows draw smaller, so they get bigger minimums.
// The cards' CSS reads them as --text-floor-0 to --text-floor-2, with one
// decimal, so each is rounded up to a tenth of a pixel.
export function textFloors(view: FloorView, scale: number): number[] {
  const floors: number[] = [];
  for (let row = 0; row < ROW_COUNT; row++) {
    const floor = Math.min(MAX_TEXT_FLOOR, MIN_DRAWN_TEXT / rowDrawScale(view, scale, row));
    floors.push(Math.ceil(floor * 10) / 10);
  }
  return floors;
}

// At most this many rounds of setting the floors and fitting again.
const MAX_FIT_ROUNDS = 6;
// The scale counts as settled once a round moves it by less than this.
const SETTLED_SCALE_CHANGE = 0.001;

// The world scale once the text floors are in place. Bigger floors make the
// far rows' cards taller, which can lower the scale that fits, which raises
// the floors again, so this goes round until the scale stops moving (two or
// three rounds in practice). If it stopped after a fixed number of rounds,
// the last fit could leave the floors set for a slightly larger scale, and
// the small lines would draw a little under MIN_DRAWN_TEXT.
// fitCards measures the cards as they are now and returns the scale that
// fits them; applyFloors sets the floors (textFloors) for a scale.
export function settleScale(fitCards: () => number, applyFloors: (scale: number) => void): number {
  let scale = fitCards();
  for (let round = 0; round < MAX_FIT_ROUNDS; round++) {
    applyFloors(scale);
    const next = fitCards();
    const settled = Math.abs(next - scale) < SETTLED_SCALE_CHANGE;
    scale = next;
    if (settled) {
      break;
    }
  }
  return scale;
}
