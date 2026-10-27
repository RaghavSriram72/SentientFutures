"use client";

// The timeline as a printed chart. d3 (in chartLayout.ts) does the year math and
// React draws every SVG element. The viewBox is fixed and the SVG scales to its
// container, so the server HTML and the browser always match.
import { useId, useMemo, useRef, type KeyboardEvent } from "react";

import { enumLabel } from "@/lib/enums";
import { countLabel } from "@/lib/estimates";

import { BandHeaders, ChartBackdrop, NowMarker } from "./ChartAxes";
import {
  AchievedMarker,
  BarLabel,
  BarShape,
  ChartDefs,
  ForecastWhisker,
  NoEstimateChip,
  SampleChip,
  StampBadge,
  stageKey,
} from "./ChartMarks";
import marks from "./ChartMarks.module.css";
import {
  AXIS_END_YEAR,
  AXIS_START_YEAR,
  FULL_SIZES,
  layoutChart,
  monoTextWidth,
  type ChartLayout,
  type TrackLayout,
} from "./chartLayout";
import { trackAriaLabel, type TimelineGroup, type TimelineItem } from "./timelineModel";
import styles from "./TimelineChart.module.css";

interface TimelineChartProps {
  groups: TimelineGroup[];
  nowYear: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// Must match .code in TimelineChart.module.css, so the SAMPLE chip lands after the text.
const CODE_FONT_SIZE = 10;
const CODE_LETTER_SPACING = 0.08;

// "3 forecasts from 3 sources", plus the expired count when there is one.
function metaText(item: TimelineItem): string {
  const view = item.view;
  let text = countLabel(view);
  if (view.expiredCount > 0) {
    text += ` · ${view.expiredCount} expired`;
  }
  return text;
}

export function TimelineChart({ groups, nowYear, selectedId, onSelect }: TimelineChartProps) {
  const layout = useMemo(() => layoutChart(groups, nowYear, FULL_SIZES), [groups, nowYear]);
  // useId keeps gradient and pattern ids unique, and identical on server and client.
  const prefix = `tl${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const titleId = `${prefix}-title`;
  const descId = `${prefix}-desc`;
  const svgRef = useRef<SVGSVGElement>(null);

  // Up and Down move between tracks, Home and End jump to the ends.
  function moveFocus(from: SVGGElement, key: string) {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const tracks = Array.from(svg.querySelectorAll<SVGGElement>("[data-track-id]"));
    const index = tracks.indexOf(from);
    let next = index;
    if (key === "ArrowDown") {
      next = Math.min(index + 1, tracks.length - 1);
    } else if (key === "ArrowUp") {
      next = Math.max(index - 1, 0);
    } else if (key === "Home") {
      next = 0;
    } else if (key === "End") {
      next = tracks.length - 1;
    }
    if (next !== index && tracks[next]) {
      tracks[next].focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<SVGGElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveFocus(event.currentTarget, event.key);
    }
  }

  return (
    <div className={styles.scroller}>
      <svg
        ref={svgRef}
        className={styles.svg}
        viewBox={`0 0 ${layout.frame.width} ${layout.height}`}
        width={layout.frame.width}
        height={layout.height}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <title id={titleId}>{`Timeline of ${layout.tracks.length} milestones, ${AXIS_START_YEAR} to ${AXIS_END_YEAR}`}</title>
        <desc id={descId}>
          One row per milestone, grouped by technology. Use Tab or the arrow keys to move between milestones, and Enter
          to open one.
        </desc>
        <ChartDefs prefix={prefix} frame={layout.frame} />
        <ChartBackdrop layout={layout} />
        <BandHeaders layout={layout} />
        {/* Under the tracks, so labels and bars sit on top of the dashed line */}
        <NowMarker layout={layout} nowYear={nowYear} />

        {layout.bands.map((band) => (
          <g key={band.group.technology} role="group" aria-label={band.group.label}>
            {layout.tracks
              .filter((track) => track.item.milestone.technology === band.group.technology)
              .map((track) => (
                <Track
                  key={track.item.milestone.id}
                  track={track}
                  layout={layout}
                  prefix={prefix}
                  selected={track.item.milestone.id === selectedId}
                  onSelect={onSelect}
                  onKeyDown={handleKeyDown}
                />
              ))}
          </g>
        ))}

      </svg>
    </div>
  );
}

interface TrackProps {
  track: TrackLayout;
  layout: ChartLayout;
  prefix: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<SVGGElement>, id: string) => void;
}

function Track({ track, layout, prefix, selected, onSelect, onKeyDown }: TrackProps) {
  const { item, label } = track;
  const { milestone, view } = item;
  const { frame, sizes } = layout;
  const id = milestone.id;
  const stageText = enumLabel("Stage", milestone.stage);
  const codeWidth = monoTextWidth(`${item.code} · ${stageText}`, CODE_FONT_SIZE, CODE_LETTER_SPACING);
  const rowWidth = frame.neverEnd - 6;

  return (
    <g
      className={`${styles.track} ${selected ? styles.trackSelected : ""}`}
      transform={`translate(0 ${track.y})`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={trackAriaLabel(item)}
      data-track-id={id}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => onKeyDown(event, id)}
    >
      <rect x={6} y={3} width={rowWidth} height={track.height - 6} rx={14} className={styles.trackBg} />
      <rect x={6} y={3} width={rowWidth} height={track.height - 6} rx={14} className={styles.focusRing} />
      <rect x={6} y={14} width={3} height={Math.max(track.height - 28, 8)} rx={1.5} className={styles.selectedBar} />
      <line x1={sizes.labelPadX} y1={track.height} x2={frame.neverEnd} y2={track.height} className={styles.trackRule} />

      {/* Label column: code and stage, name, counts, stamp */}
      <text x={sizes.labelPadX} y={label.codeY} className={styles.code}>
        {item.code}
        <tspan className={marks[`ink_${stageKey(milestone.stage)}`]}>{` · ${stageText}`}</tspan>
      </text>
      {milestone.sample && <SampleChip x={sizes.labelPadX + codeWidth + 8} y={label.codeY - 11} />}
      {label.nameLines.map((line, index) => (
        <text key={index} x={sizes.labelPadX} y={label.nameYs[index]} className={styles.name}>
          {line}
        </text>
      ))}
      {label.metaY !== null && (
        <text x={sizes.labelPadX} y={label.metaY} className={styles.meta}>
          {metaText(item)}
        </text>
      )}
      {label.stampY !== null && <StampBadge x={sizes.labelPadX} y={label.stampY} height={sizes.stampHeight} size="full" />}

      {/* Plot: the bar or band first, then every forecast on top of it */}
      {track.bar && <BarShape bar={track.bar} stage={milestone.stage} prefix={prefix} />}
      {track.bar && <BarLabel bar={track.bar} stage={milestone.stage} />}
      {track.achievedX !== null && view.achievedIn !== null && (
        <AchievedMarker x={track.achievedX} y={track.barLaneY} year={view.achievedIn} stage={milestone.stage} showLabel />
      )}
      {track.forecastMarks.map((mark) => (
        <ForecastWhisker key={mark.forecast.id} mark={mark} />
      ))}
      {track.noEstimate && (
        <NoEstimateChip x={track.noEstimate.x} y={track.noEstimate.y} height={sizes.chipHeight} prefix={prefix} />
      )}
    </g>
  );
}
