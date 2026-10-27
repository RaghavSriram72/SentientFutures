// Geometry for the timeline chart and the home page preview. d3 does the year
// math; everything else is plain arithmetic so it's easy to follow. Pure
// functions: the React components only draw what these return.
import { range } from "d3-array";
import { scaleLinear } from "d3-scale";

import type { ForecastView } from "@/lib/estimates";

import { rangeText, sortForecastsByWindow, type TimelineGroup, type TimelineItem } from "./timelineModel";

export const AXIS_START_YEAR = 2020;
export const AXIS_END_YEAR = 2100;
export const GRID_STEP_YEARS = 10;

// Everything is in viewBox units. The SVG scales to its container, so these
// are chosen for a chart that renders roughly 900 to 1120 pixels wide.
export interface ChartSizes {
  width: number;
  labelWidth: number;
  labelPadX: number;
  beforeWidth: number;
  afterWidth: number;
  neverGap: number;
  neverWidth: number;
  rightPad: number;
  axisTopHeight: number;
  axisBottomHeight: number;
  axisLabelStep: number; // years between axis labels; grid lines stay every GRID_STEP_YEARS
  bandHeaderHeight: number;
  bandGap: number;
  trackPadY: number;
  trackMinHeight: number;
  barHeight: number;
  spanHeight: number;
  barLabelSpace: number; // room above the bar for "OUR RANGE 2030 TO 2038"; 0 hides it
  laneGap: number;
  chipHeight: number;
  // Label column
  codeLineHeight: number;
  nameLineHeight: number;
  nameMaxChars: number;
  nameMaxLines: number;
  showMeta: boolean;
  metaLineHeight: number;
  stampHeight: number;
  stampOnCodeLine: boolean; // the preview tucks the stamp at the end of the code line
}

export const FULL_SIZES: ChartSizes = {
  width: 1120,
  labelWidth: 288,
  labelPadX: 18,
  beforeWidth: 60,
  afterWidth: 46,
  neverGap: 8,
  neverWidth: 84,
  rightPad: 12,
  axisTopHeight: 64,
  axisBottomHeight: 40,
  axisLabelStep: 10,
  bandHeaderHeight: 48,
  bandGap: 10,
  trackPadY: 12,
  trackMinHeight: 76,
  barHeight: 12,
  spanHeight: 18,
  barLabelSpace: 15,
  laneGap: 12,
  chipHeight: 22,
  codeLineHeight: 19,
  nameLineHeight: 17,
  nameMaxChars: 34,
  nameMaxLines: 2,
  showMeta: true,
  metaLineHeight: 19,
  stampHeight: 21,
  stampOnCodeLine: false,
};

export const PREVIEW_SIZES: ChartSizes = {
  width: 1120,
  labelWidth: 300,
  labelPadX: 18,
  beforeWidth: 44,
  afterWidth: 40,
  neverGap: 8,
  neverWidth: 72,
  rightPad: 12,
  axisTopHeight: 56,
  axisBottomHeight: 8,
  axisLabelStep: 10,
  bandHeaderHeight: 36,
  bandGap: 4,
  trackPadY: 10,
  trackMinHeight: 52,
  barHeight: 10,
  spanHeight: 14,
  barLabelSpace: 0,
  laneGap: 8,
  chipHeight: 20,
  codeLineHeight: 18,
  nameLineHeight: 19,
  nameMaxChars: 33,
  nameMaxLines: 1,
  // "N forecasts from M sources" under the name, as on the full chart
  showMeta: true,
  metaLineHeight: 16,
  stampHeight: 16,
  stampOnCodeLine: true,
};

// Column edges, left to right: labels | before 2020 | 2020..2100 | after 2100 | never
export interface ChartFrame {
  width: number;
  labelEnd: number;
  beforeStart: number;
  beforeEnd: number;
  axisStart: number;
  axisEnd: number;
  afterStart: number;
  afterEnd: number;
  neverStart: number;
  neverEnd: number;
}

export function makeFrame(sizes: ChartSizes): ChartFrame {
  const labelEnd = sizes.labelWidth;
  const beforeStart = labelEnd;
  const beforeEnd = beforeStart + sizes.beforeWidth;
  const neverEnd = sizes.width - sizes.rightPad;
  const neverStart = neverEnd - sizes.neverWidth;
  const afterEnd = neverStart - sizes.neverGap;
  const afterStart = afterEnd - sizes.afterWidth;
  return {
    width: sizes.width,
    labelEnd,
    beforeStart,
    beforeEnd,
    axisStart: beforeEnd,
    axisEnd: afterStart,
    afterStart,
    afterEnd,
    neverStart,
    neverEnd,
  };
}

// Years before 2020 sit in the "Before 2020" gutter and years after 2100 in the
// "After 2100" clamp. The panel always shows the real years.
export function makeYearToX(frame: ChartFrame): (year: number) => number {
  const scale = scaleLinear()
    .domain([AXIS_START_YEAR, AXIS_END_YEAR])
    .range([frame.axisStart, frame.axisEnd]);
  return function yearToX(year: number): number {
    if (year < AXIS_START_YEAR) {
      return (frame.beforeStart + frame.beforeEnd) / 2;
    }
    if (year > AXIS_END_YEAR) {
      return (frame.afterStart + frame.afterEnd) / 2;
    }
    return scale(year);
  };
}

export function gridYears(): number[] {
  return range(AXIS_START_YEAR, AXIS_END_YEAR + 1, GRID_STEP_YEARS);
}

// IBM Plex Mono advances 0.6em per character, so mono text can be measured exactly.
export function monoTextWidth(text: string, fontSize: number, letterSpacingEm = 0): number {
  return text.length * fontSize * (0.6 + letterSpacingEm);
}

// Greedy word wrap by character count. SVG text doesn't wrap on its own, and the
// sans face averages about half an em per character, so a char budget is close enough.
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length <= maxChars || current === "") {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  if (lines.length <= maxLines) {
    return lines;
  }
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  if (last.length > maxChars - 1) {
    last = last.slice(0, maxChars - 1).trimEnd();
  }
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

// ---------- Tracks ----------

export type ForecastShape = "range" | "point" | "openRight" | "openLeft" | "never" | "empty";

export interface ForecastMark {
  forecast: ForecastView;
  shape: ForecastShape;
  y: number;
  x1: number;
  x2: number;
}

export interface BarMark {
  kind: "team" | "span";
  x1: number;
  x2: number;
  y: number; // center line
  height: number;
  openLeft: boolean;
  openRight: boolean;
  label: string | null;
}

export interface LabelLayout {
  codeY: number;
  nameLines: string[];
  nameYs: number[];
  metaY: number | null;
  stampY: number | null; // top edge of the stamp when it gets its own line
  height: number;
}

export interface TrackLayout {
  item: TimelineItem;
  y: number; // top edge, in chart coordinates
  height: number;
  label: LabelLayout;
  bar: BarMark | null;
  barLaneY: number;
  achievedX: number | null;
  forecastMarks: ForecastMark[];
  noEstimate: { x: number; y: number } | null;
}

export interface BandLayout {
  group: TimelineGroup;
  y: number;
  headerHeight: number;
}

export interface ChartLayout {
  sizes: ChartSizes;
  frame: ChartFrame;
  height: number;
  plotTop: number;
  plotBottom: number;
  nowX: number;
  bands: BandLayout[];
  tracks: TrackLayout[];
}

export function forecastShape(forecast: ForecastView): ForecastShape {
  if (forecast.never) {
    return "never";
  }
  if (forecast.earliest !== null && forecast.latest !== null) {
    return forecast.earliest === forecast.latest ? "point" : "range";
  }
  if (forecast.earliest !== null) {
    return "openRight";
  }
  if (forecast.latest !== null) {
    return "openLeft";
  }
  return "empty";
}

// The label column reads like an index card: code, name, counts, then the
// stamp on its own line so it's always in the same place when you scan down.
// All y values are baselines (the stamp's is its top edge), relative to the track.
function layoutLabel(item: TimelineItem, sizes: ChartSizes): LabelLayout {
  const codeY = sizes.trackPadY + 10;
  const nameLines = wrapText(item.milestone.name, sizes.nameMaxChars, sizes.nameMaxLines);
  const nameYs: number[] = [];
  let y = codeY + sizes.codeLineHeight;
  for (let i = 0; i < nameLines.length; i++) {
    nameYs.push(y);
    if (i < nameLines.length - 1) {
      y += sizes.nameLineHeight;
    }
  }
  let metaY: number | null = null;
  if (sizes.showMeta && item.view.forecastCount >= 1) {
    y += sizes.metaLineHeight;
    metaY = y;
  }
  let stampY: number | null = null;
  // Text after the last baseline needs a little room for descenders.
  let bottom = y + 4;
  if (!sizes.stampOnCodeLine && item.view.disagreement.flagged) {
    stampY = y + 10;
    bottom = stampY + sizes.stampHeight;
  }
  return { codeY, nameLines, nameYs, metaY, stampY, height: bottom + sizes.trackPadY };
}

function layoutTrack(
  item: TimelineItem,
  top: number,
  frame: ChartFrame,
  yearToX: (year: number) => number,
  nowX: number,
  sizes: ChartSizes,
): TrackLayout {
  const view = item.view;
  const label = layoutLabel(item, sizes);
  const forecasts = sortForecastsByWindow(view.forecasts);

  const hasBarLane = view.barMode === "team" || view.barMode === "span" || view.barMode === "achieved";
  const barLaneHeight = hasBarLane ? sizes.barLabelSpace + sizes.spanHeight : 0;
  let contentHeight = barLaneHeight + forecasts.length * sizes.laneGap;
  if (view.barMode === "none") {
    contentHeight = sizes.chipHeight;
  }

  const height = Math.max(sizes.trackMinHeight, label.height, contentHeight + 2 * sizes.trackPadY);
  // The marks sit in the middle of the track; the label column stays top-aligned.
  const contentTop = (height - contentHeight) / 2;
  const barLaneY = contentTop + sizes.barLabelSpace + sizes.spanHeight / 2;

  let bar: BarMark | null = null;
  if ((view.barMode === "team" || view.barMode === "span") && view.bar) {
    const { start, end } = view.bar;
    const openLeft = start === null;
    const openRight = end === null;
    let x1 = start === null ? frame.beforeStart : yearToX(start);
    let x2 = end === null ? frame.afterEnd : yearToX(end);
    // A single-year range still needs a visible bar.
    const minWidth = 8;
    if (x2 - x1 < minWidth) {
      const middle = (x1 + x2) / 2;
      x1 = middle - minWidth / 2;
      x2 = middle + minWidth / 2;
    }
    const years = rangeText(start, end);
    const kindLabel = view.barMode === "team" ? "Our range" : "Forecast span";
    bar = {
      kind: view.barMode,
      x1,
      x2,
      y: barLaneY,
      height: view.barMode === "team" ? sizes.barHeight : sizes.spanHeight,
      openLeft,
      openRight,
      label: sizes.barLabelSpace > 0 ? `${kindLabel} ${years}` : null,
    };
  }

  const achievedX = view.barMode === "achieved" && view.achievedIn !== null ? yearToX(view.achievedIn) : null;

  const forecastMarks: ForecastMark[] = [];
  const neverX = (frame.neverStart + frame.neverEnd) / 2;
  for (let i = 0; i < forecasts.length; i++) {
    const forecast = forecasts[i];
    const shape = forecastShape(forecast);
    const y = contentTop + barLaneHeight + sizes.laneGap * (i + 0.5);
    // An open end runs to the edge of the chart; "never" sits in its own column.
    let x1 = forecast.earliest === null ? frame.beforeStart + 4 : yearToX(forecast.earliest);
    let x2 = forecast.latest === null ? frame.afterEnd - 2 : yearToX(forecast.latest);
    if (shape === "never") {
      x1 = neverX;
      x2 = neverX;
    }
    forecastMarks.push({ forecast, shape, y, x1, x2 });
  }

  let noEstimate: { x: number; y: number } | null = null;
  if (view.barMode === "none") {
    noEstimate = { x: nowX + 12, y: (height - sizes.chipHeight) / 2 };
  }

  return { item, y: top, height, label, bar, barLaneY, achievedX, forecastMarks, noEstimate };
}

export function layoutChart(groups: TimelineGroup[], nowYear: number, sizes: ChartSizes): ChartLayout {
  const frame = makeFrame(sizes);
  const yearToX = makeYearToX(frame);
  const nowX = yearToX(nowYear);

  const bands: BandLayout[] = [];
  const tracks: TrackLayout[] = [];
  let y = sizes.axisTopHeight;
  const plotTop = y;
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    if (g > 0) {
      y += sizes.bandGap;
    }
    bands.push({ group, y, headerHeight: sizes.bandHeaderHeight });
    y += sizes.bandHeaderHeight;
    for (const item of group.items) {
      const track = layoutTrack(item, y, frame, yearToX, nowX, sizes);
      tracks.push(track);
      y += track.height;
    }
  }
  const plotBottom = y + 8;
  return {
    sizes,
    frame,
    height: plotBottom + sizes.axisBottomHeight,
    plotTop,
    plotBottom,
    nowX,
    bands,
    tracks,
  };
}
