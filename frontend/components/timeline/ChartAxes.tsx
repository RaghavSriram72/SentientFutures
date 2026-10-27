// The chart's frame: column backgrounds, the year grid, axis labels, band
// headers and the Now line. Shared by the full chart and the home page preview.
// No hooks, so it renders the same on the server and in the browser.
import { pluralize } from "@/lib/estimates";

import {
  AXIS_END_YEAR,
  AXIS_START_YEAR,
  gridYears,
  makeYearToX,
  monoTextWidth,
  type ChartLayout,
} from "./chartLayout";
import styles from "./ChartAxes.module.css";

// Grid, column backgrounds and axis labels, drawn under the tracks.
export function ChartBackdrop({ layout }: { layout: ChartLayout }) {
  const { frame, plotTop, plotBottom, sizes } = layout;
  const years = gridYears();
  const yearToX = makeYearToX(frame);
  const topLabelY = sizes.axisTopHeight - 14;
  const bottomLabelY = plotBottom + 24;
  const showBottomAxis = sizes.axisBottomHeight >= 24;
  const beforeX = (frame.beforeStart + frame.beforeEnd) / 2;
  const neverX = (frame.neverStart + frame.neverEnd) / 2;
  const plotHeight = plotBottom - plotTop;

  return (
    <g aria-hidden="true">
      <rect x={frame.beforeStart} y={plotTop} width={frame.beforeEnd - frame.beforeStart} height={plotHeight} className={styles.gutterBg} />
      <rect x={frame.afterStart} y={plotTop} width={frame.afterEnd - frame.afterStart} height={plotHeight} className={styles.gutterBg} />
      <rect
        x={frame.neverStart}
        y={plotTop - 4}
        width={frame.neverEnd - frame.neverStart}
        height={plotHeight + 8}
        rx={12}
        className={styles.neverBg}
      />

      {years.map((year) => {
        const x = yearToX(year);
        const isEdge = year === AXIS_START_YEAR || year === AXIS_END_YEAR;
        // Narrow charts label fewer years so the labels don't run into each other.
        const showLabel = (year - AXIS_START_YEAR) % sizes.axisLabelStep === 0;
        // Labels sit just right of their line. "2100" lands under "After", so it reads "After 2100".
        const labelX = x + 5;
        return (
          <g key={year}>
            <line x1={x} y1={plotTop} x2={x} y2={plotBottom} className={isEdge ? styles.gridEdge : styles.grid} />
            {showLabel && (
              <text x={labelX} y={topLabelY} className={styles.axisLabel}>
                {year}
              </text>
            )}
            {showLabel && showBottomAxis && (
              <text x={labelX} y={bottomLabelY} className={styles.axisLabel}>
                {year}
              </text>
            )}
          </g>
        );
      })}

      <text x={beforeX} y={topLabelY - 12} textAnchor="middle" className={styles.columnLabel}>
        Before
      </text>
      <text x={beforeX} y={topLabelY} textAnchor="middle" className={styles.columnLabel}>
        {AXIS_START_YEAR}
      </text>
      <text x={frame.afterStart + 5} y={topLabelY - 13} className={styles.columnLabel}>
        After
      </text>
      <text x={neverX} y={topLabelY} textAnchor="middle" className={`${styles.columnLabel} ${styles.neverLabel}`}>
        Never
      </text>
      {showBottomAxis && (
        <text x={neverX} y={bottomLabelY} textAnchor="middle" className={`${styles.columnLabel} ${styles.neverLabel}`}>
          Never
        </text>
      )}
    </g>
  );
}

// One printed section header per technology.
export function BandHeaders({ layout }: { layout: ChartLayout }) {
  const { frame, sizes } = layout;
  return (
    <g aria-hidden="true">
      {layout.bands.map((band) => (
        <g key={band.group.technology}>
          <rect
            x={6}
            y={band.y + 4}
            width={frame.neverEnd - 6}
            height={band.headerHeight - 12}
            rx={10}
            className={styles.bandStrip}
          />
          <text x={sizes.labelPadX} y={band.y + band.headerHeight / 2 + 2} className={styles.bandLabel}>
            {band.group.label}
            <tspan className={styles.bandCount}>
              {`  ·  ${pluralize(band.group.items.length, "milestone", "milestones")}`}
            </tspan>
          </text>
        </g>
      ))}
    </g>
  );
}

// The grape dashed "Now" rule, with its year in a pill at the top.
export function NowMarker({ layout, nowYear }: { layout: ChartLayout; nowYear: number }) {
  const x = layout.nowX;
  const text = `Now · ${nowYear}`;
  const width = monoTextWidth(text, 9.5, 0.08) + 16;
  return (
    <g aria-hidden="true" className={styles.now}>
      <line x1={x} y1={27} x2={x} y2={layout.plotBottom} className={styles.nowLine} />
      <rect x={x - width / 2} y={8} width={width} height={19} rx={9.5} className={styles.nowPill} />
      <text x={x} y={21} textAnchor="middle" className={styles.nowText}>
        {text}
      </text>
    </g>
  );
}
