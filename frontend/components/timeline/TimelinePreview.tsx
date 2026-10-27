// A compact timeline for the home page. Not interactive on its own: the whole
// thing is one link to /timeline/. No hooks or state, so it works in a server
// component. Usage: <TimelinePreview milestones={getMilestones()} nowYear={getSiteData().nowYear} />
import Link from "next/link";

import { countLabel, type MilestoneView } from "@/lib/estimates";
import type { Milestone } from "@/lib/types";

import { BandHeaders, ChartBackdrop, NowMarker } from "./ChartAxes";
import {
  AchievedMarker,
  BarShape,
  ChartDefs,
  ForecastWhisker,
  NoEstimateChip,
  StampBadge,
  stampWidth,
} from "./ChartMarks";
import { layoutChart, PREVIEW_SIZES, type ChartLayout, type TrackLayout } from "./chartLayout";
import { buildTimeline } from "./timelineModel";
import styles from "./TimelinePreview.module.css";

interface TimelinePreviewProps {
  milestones: Milestone[];
  nowYear: number;
}

// Only one preview is ever on a page, so a fixed id prefix is safe here.
const PREFIX = "tl-preview";

// The line under each name. The preview has no bar labels, so it also says
// whether the bar is our range or just the span of the forecasts.
function metaText(view: MilestoneView): string {
  if (view.barMode === "team") {
    return `Our range · ${countLabel(view)}`;
  }
  if (view.barMode === "span") {
    return `Span of ${countLabel(view)}`;
  }
  return countLabel(view);
}

export function TimelinePreview({ milestones, nowYear }: TimelinePreviewProps) {
  const groups = buildTimeline(milestones, nowYear);
  const layout = layoutChart(groups, nowYear, PREVIEW_SIZES);

  let flaggedCount = 0;
  let sampleCount = 0;
  for (const track of layout.tracks) {
    if (track.item.view.disagreement.flagged) {
      flaggedCount += 1;
    }
    if (track.item.milestone.sample) {
      sampleCount += 1;
    }
  }
  let summary = `${layout.tracks.length} milestones, ${flaggedCount} where sources disagree`;
  // The preview has no room for SAMPLE chips, so say it once up top.
  if (sampleCount === layout.tracks.length) {
    summary += " · sample data";
  } else if (sampleCount > 0) {
    summary += ` · ${sampleCount} samples`;
  }

  // No aria-label: the visible summary and "Open the timeline" already name the
  // link, and the drawing is hidden from screen readers.
  return (
    <Link href="/timeline/" className={styles.preview}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>{summary}</span>
        <span className={styles.open}>
          Open the timeline <span aria-hidden="true">&rarr;</span>
        </span>
      </div>
      <div className={styles.scroller}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${layout.frame.width} ${layout.height}`}
          width={layout.frame.width}
          height={layout.height}
          aria-hidden="true"
          focusable="false"
        >
          <ChartDefs prefix={PREFIX} frame={layout.frame} />
          <ChartBackdrop layout={layout} />
          <BandHeaders layout={layout} />
          <NowMarker layout={layout} nowYear={nowYear} />
          {layout.tracks.map((track) => (
            <PreviewTrack key={track.item.milestone.id} track={track} layout={layout} />
          ))}
        </svg>
      </div>
    </Link>
  );
}

function PreviewTrack({ track, layout }: { track: TrackLayout; layout: ChartLayout }) {
  const { item, label } = track;
  const { milestone, view } = item;
  const { frame, sizes } = layout;
  const stampX = frame.labelEnd - 14 - stampWidth("small");

  return (
    <g transform={`translate(0 ${track.y})`}>
      <line x1={sizes.labelPadX} y1={track.height} x2={frame.neverEnd} y2={track.height} className={styles.trackRule} />
      <text x={sizes.labelPadX} y={label.codeY} className={styles.code}>
        {item.code}
      </text>
      {view.disagreement.flagged && (
        <StampBadge x={stampX} y={label.codeY - 13} height={sizes.stampHeight} size="small" />
      )}
      {label.nameLines.map((line, index) => (
        <text key={index} x={sizes.labelPadX} y={label.nameYs[index]} className={styles.name}>
          {line}
        </text>
      ))}
      {label.metaY !== null && (
        <text x={sizes.labelPadX} y={label.metaY} className={styles.meta}>
          {metaText(view)}
        </text>
      )}

      {track.bar && <BarShape bar={track.bar} stage={milestone.stage} prefix={PREFIX} />}
      {track.achievedX !== null && view.achievedIn !== null && (
        <AchievedMarker x={track.achievedX} y={track.barLaneY} year={view.achievedIn} stage={milestone.stage} showLabel />
      )}
      {track.forecastMarks.map((mark) => (
        <ForecastWhisker key={mark.forecast.id} mark={mark} compact />
      ))}
      {track.noEstimate && (
        <NoEstimateChip x={track.noEstimate.x} y={track.noEstimate.y} height={sizes.chipHeight} prefix={PREFIX} />
      )}
    </g>
  );
}
