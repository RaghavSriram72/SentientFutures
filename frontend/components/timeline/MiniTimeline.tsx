// One milestone on its own strip of the timeline, for the top of the dossier.
// The dossier can cover part of the main chart, so this keeps the milestone's
// bar and every one of its forecasts in view while you read the basis.
// Uses the same layout code and marks as the main chart, so the two always match.
import { ChartBackdrop, NowMarker } from "./ChartAxes";
import { AchievedMarker, BarShape, ChartDefs, ForecastWhisker, NoEstimateChip } from "./ChartMarks";
import { layoutChart, type ChartSizes } from "./chartLayout";
import { estimateSummary, forecastsSummary, type TimelineItem } from "./timelineModel";
import styles from "./MiniTimeline.module.css";

// No label column and no band header: just the axis and one track.
const WIDE_SIZES: ChartSizes = {
  width: 560,
  labelWidth: 6,
  labelPadX: 6,
  beforeWidth: 44,
  afterWidth: 38,
  neverGap: 6,
  neverWidth: 56,
  rightPad: 6,
  axisTopHeight: 60,
  axisBottomHeight: 0,
  axisLabelStep: 10,
  bandHeaderHeight: 0,
  bandGap: 0,
  trackPadY: 8,
  trackMinHeight: 44,
  barHeight: 10,
  spanHeight: 14,
  barLabelSpace: 0,
  laneGap: 11,
  chipHeight: 20,
  codeLineHeight: 0,
  nameLineHeight: 0,
  nameMaxChars: 80,
  nameMaxLines: 1,
  showMeta: false,
  metaLineHeight: 0,
  stampHeight: 0,
  stampOnCodeLine: true,
};

// Phones: the same strip drawn narrower, so it renders near full size without
// sideways scrolling. Labels every 20 years keep the axis from crowding.
const NARROW_SIZES: ChartSizes = {
  ...WIDE_SIZES,
  width: 300,
  beforeWidth: 34,
  afterWidth: 34,
  neverWidth: 44,
  axisLabelStep: 20,
};

// What a screen reader hears for the strip: where the bar sits and every forecast.
function stripAriaLabel(item: TimelineItem, nowYear: number): string {
  const parts: string[] = [];
  parts.push(`${item.code} on the timeline, where the current year is ${nowYear}`);
  parts.push(estimateSummary(item));
  if (item.view.forecastCount >= 1) {
    parts.push(forecastsSummary(item.view));
  }
  return `${parts.join(". ")}.`;
}

// Both drawings are in the HTML and CSS shows the one that fits the panel, so
// the server and browser always match. The figure carries the accessible name.
export function MiniTimeline({ item, nowYear }: { item: TimelineItem; nowYear: number }) {
  return (
    <figure className={styles.mini} role="img" aria-label={stripAriaLabel(item, nowYear)}>
      <MiniStrip item={item} nowYear={nowYear} sizes={WIDE_SIZES} prefix="tl-mini-wide" className={styles.wide} />
      <MiniStrip item={item} nowYear={nowYear} sizes={NARROW_SIZES} prefix="tl-mini-narrow" className={styles.narrow} />
    </figure>
  );
}

interface MiniStripProps {
  item: TimelineItem;
  nowYear: number;
  sizes: ChartSizes;
  // Only one dossier is open at a time, so a fixed id prefix per drawing is safe.
  prefix: string;
  className: string;
}

function MiniStrip({ item, nowYear, sizes, prefix, className }: MiniStripProps) {
  const group = { technology: item.milestone.technology, label: "", items: [item] };
  const layout = layoutChart([group], nowYear, sizes);
  const track = layout.tracks[0];
  const { milestone, view } = item;

  return (
    <svg
      className={`${styles.svg} ${className}`}
      viewBox={`0 0 ${layout.frame.width} ${layout.height}`}
      aria-hidden="true"
      focusable="false"
    >
      <ChartDefs prefix={prefix} frame={layout.frame} />
      <ChartBackdrop layout={layout} />
      <NowMarker layout={layout} nowYear={nowYear} />
      <g transform={`translate(0 ${track.y})`}>
        {track.bar && <BarShape bar={track.bar} stage={milestone.stage} prefix={prefix} />}
        {track.achievedX !== null && view.achievedIn !== null && (
          <AchievedMarker x={track.achievedX} y={track.barLaneY} year={view.achievedIn} stage={milestone.stage} showLabel />
        )}
        {track.forecastMarks.map((mark) => (
          <ForecastWhisker key={mark.forecast.id} mark={mark} compact />
        ))}
        {track.noEstimate && (
          <NoEstimateChip x={track.noEstimate.x} y={track.noEstimate.y} height={sizes.chipHeight} prefix={prefix} />
        )}
      </g>
    </svg>
  );
}
