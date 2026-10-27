// SVG pieces shared by the full chart and the home page preview. No hooks and
// no state, so these render the same on the server and in the browser. Colors
// come from CSS classes (tokens), never from hex values here.
import { formatWindow } from "@/lib/estimates";
import type { Stage } from "@/lib/types";

import { monoTextWidth, type BarMark, type ChartFrame, type ForecastMark } from "./chartLayout";
import styles from "./ChartMarks.module.css";

const STAMP_TEXT = "Sources disagree";
const STAMP_LETTER_SPACING = 0.12;
const STAMP_PAD_X = 7;

// CSS class suffix per stage, matching the --stage-* token names.
export function stageKey(stage: Stage): "possible" | "widely" | "helping" {
  if (stage === "widely_available") {
    return "widely";
  }
  if (stage === "actually_helping") {
    return "helping";
  }
  return "possible";
}

const STAGE_KEYS: Array<"possible" | "widely" | "helping"> = ["possible", "widely", "helping"];

// SVG ids must be unique on the page, so every chart passes its own prefix.
function fadeId(prefix: string, side: "left" | "right", key: string): string {
  return `${prefix}-fade-${side}-${key}`;
}

function hatchId(prefix: string): string {
  return `${prefix}-hatch`;
}

// Gradients that fade open-ended bars out at the chart edges, and the hatch
// pattern for "No estimate yet". userSpaceOnUse keeps one gradient per stage
// working for every bar, because open bars all end at the same edge.
export function ChartDefs({ prefix, frame }: { prefix: string; frame: ChartFrame }) {
  return (
    <defs>
      {STAGE_KEYS.map((key) => (
        <linearGradient
          key={`r-${key}`}
          id={fadeId(prefix, "right", key)}
          gradientUnits="userSpaceOnUse"
          x1={frame.afterStart - 36}
          x2={frame.afterEnd}
          y1={0}
          y2={0}
        >
          <stop offset="0" className={styles[`stop_${key}`]} stopOpacity={1} />
          <stop offset="1" className={styles[`stop_${key}`]} stopOpacity={0.08} />
        </linearGradient>
      ))}
      {STAGE_KEYS.map((key) => (
        <linearGradient
          key={`l-${key}`}
          id={fadeId(prefix, "left", key)}
          gradientUnits="userSpaceOnUse"
          x1={frame.beforeStart}
          x2={frame.beforeEnd + 24}
          y1={0}
          y2={0}
        >
          <stop offset="0" className={styles[`stop_${key}`]} stopOpacity={0.08} />
          <stop offset="1" className={styles[`stop_${key}`]} stopOpacity={1} />
        </linearGradient>
      ))}
      <pattern
        id={hatchId(prefix)}
        width={6}
        height={6}
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width={6} height={6} className={styles.hatchBg} />
        <line x1={0} y1={0} x2={0} y2={6} className={styles.hatchLine} />
      </pattern>
    </defs>
  );
}

function Chevron({ x, y, direction, className }: { x: number; y: number; direction: "left" | "right"; className: string }) {
  const d = direction === "right" ? `M ${x - 5} ${y - 4} L ${x} ${y} L ${x - 5} ${y + 4}` : `M ${x + 5} ${y - 4} L ${x} ${y} L ${x + 5} ${y + 4}`;
  return <path d={d} className={className} />;
}

// The team's solid bar, or the faint span band behind the forecasts.
export function BarShape({ bar, stage, prefix }: { bar: BarMark; stage: Stage; prefix: string }) {
  const key = stageKey(stage);
  const isTeam = bar.kind === "team";
  let fill: string | undefined;
  if (bar.openRight) {
    fill = `url(#${fadeId(prefix, "right", key)})`;
  } else if (bar.openLeft) {
    fill = `url(#${fadeId(prefix, "left", key)})`;
  }
  const shapeClass = isTeam ? styles[`bar_${key}`] : styles[`span_${key}`];
  const top = bar.y - bar.height / 2;
  return (
    <g>
      <rect
        x={bar.x1}
        y={top}
        width={bar.x2 - bar.x1}
        height={bar.height}
        rx={Math.min(bar.height / 2, isTeam ? 4 : 6)}
        className={shapeClass}
        // Inline, because the class sets a flat fill and CSS beats the fill attribute.
        // The outline is dropped so the open end can fade out cleanly.
        style={fill ? { fill, stroke: "none" } : undefined}
      />
      {bar.openRight && <Chevron x={bar.x2 + 6} y={bar.y} direction="right" className={styles[`chevron_${key}`]} />}
      {bar.openLeft && <Chevron x={bar.x1 - 6} y={bar.y} direction="left" className={styles[`chevron_${key}`]} />}
    </g>
  );
}

export function BarLabel({ bar, stage }: { bar: BarMark; stage: Stage }) {
  if (!bar.label) {
    return null;
  }
  return (
    <text x={Math.max(bar.x1, 0)} y={bar.y - bar.height / 2 - 5} className={`${styles.barLabel} ${styles[`ink_${stageKey(stage)}`]}`}>
      {bar.label}
    </text>
  );
}

export function AchievedMarker({ x, y, year, stage, showLabel }: { x: number; y: number; year: number; stage: Stage; showLabel: boolean }) {
  const key = stageKey(stage);
  return (
    <g>
      <circle cx={x} cy={y} r={7.5} className={`${styles.achievedDot} ${styles[`bar_${key}`]}`} />
      <path d={`M ${x - 3.4} ${y + 0.2} L ${x - 0.9} ${y + 2.7} L ${x + 3.6} ${y - 2.6}`} className={styles.achievedCheck} />
      {showLabel && (
        <text x={x + 13} y={y + 3.5} className={`${styles.barLabel} ${styles[`ink_${key}`]}`}>
          Achieved {year}
        </text>
      )}
    </g>
  );
}

function forecastTooltip(mark: ForecastMark): string {
  const f = mark.forecast;
  const expired = f.isExpired ? ". Expired: the window has passed" : "";
  return `${f.forecaster}: ${formatWindow(f)} (made in ${f.made_in})${expired}`;
}

// One forecast: a window with end caps, a dot for a single year, an arrow for
// an open end, or a cross in the Never column. Expired ones are grey and dashed.
export function ForecastWhisker({ mark, compact = false }: { mark: ForecastMark; compact?: boolean }) {
  const { shape, x1, x2, y } = mark;
  const cap = compact ? 3 : 4.5;
  const groupClass = `${mark.forecast.isExpired ? styles.expired : ""} ${compact ? styles.compactForecast : ""}`;

  if (shape === "empty") {
    return null;
  }

  return (
    <g className={groupClass}>
      <title>{forecastTooltip(mark)}</title>
      {shape === "never" && (
        <path
          d={`M ${x1 - cap} ${y - cap} L ${x1 + cap} ${y + cap} M ${x1 - cap} ${y + cap} L ${x1 + cap} ${y - cap}`}
          className={styles.whisker}
        />
      )}
      {shape === "point" && <circle cx={x1} cy={y} r={compact ? 3.5 : 4.5} className={styles.whiskerDot} />}
      {(shape === "range" || shape === "openRight" || shape === "openLeft") && (
        <line x1={x1} y1={y} x2={x2} y2={y} className={styles.whisker} />
      )}
      {(shape === "range" || shape === "openRight") && (
        <line x1={x1} y1={y - cap} x2={x1} y2={y + cap} className={styles.whisker} />
      )}
      {(shape === "range" || shape === "openLeft") && (
        <line x1={x2} y1={y - cap} x2={x2} y2={y + cap} className={styles.whisker} />
      )}
      {shape === "openRight" && <Chevron x={x2} y={y} direction="right" className={styles.whisker} />}
      {shape === "openLeft" && <Chevron x={x1} y={y} direction="left" className={styles.whisker} />}
    </g>
  );
}

export function NoEstimateChip({ x, y, height, prefix }: { x: number; y: number; height: number; prefix: string }) {
  const label = "No estimate yet";
  const width = monoTextWidth(label, 9, 0.1) + 20;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={height / 2} fill={`url(#${hatchId(prefix)})`} className={styles.noEstimate} />
      <text x={x + width / 2} y={y + height / 2 + 3.2} textAnchor="middle" className={styles.noEstimateText}>
        {label}
      </text>
    </g>
  );
}

export function stampWidth(size: "full" | "small"): number {
  const fontSize = size === "full" ? 9 : 8;
  return monoTextWidth(STAMP_TEXT, fontSize, STAMP_LETTER_SPACING) + 2 * STAMP_PAD_X;
}

// The red rubber stamp. Slightly rotated with a double border, like ink on paper.
export function StampBadge({ x, y, height, size }: { x: number; y: number; height: number; size: "full" | "small" }) {
  const width = stampWidth(size);
  const fontSize = size === "full" ? 9 : 8;
  return (
    <g className={styles.stamp} transform={`rotate(-3 ${x + width / 2} ${y + height / 2})`}>
      <rect x={x} y={y} width={width} height={height} rx={3} className={styles.stampOuter} />
      <rect x={x + 2.5} y={y + 2.5} width={width - 5} height={height - 5} rx={1.5} className={styles.stampInner} />
      <text
        x={x + width / 2}
        y={y + height / 2 + fontSize * 0.36}
        textAnchor="middle"
        className={size === "full" ? styles.stampText : `${styles.stampText} ${styles.stampTextSmall}`}
      >
        {STAMP_TEXT}
      </text>
    </g>
  );
}

function sampleChipWidth(): number {
  return monoTextWidth("Sample", 8.5, 0.1) + 12;
}

export function SampleChip({ x, y }: { x: number; y: number }) {
  const width = sampleChipWidth();
  const height = 15;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={height / 2} className={styles.sampleChip} />
      <text x={x + width / 2} y={y + height / 2 + 3} textAnchor="middle" className={styles.sampleText}>
        Sample
      </text>
    </g>
  );
}
