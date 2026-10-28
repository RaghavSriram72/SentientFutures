// The pieces both 3D tracks draw: the full-screen timeline and the home page
// teaser. The floor marks (years, Now, zones), what each milestone casts on the
// floor (ribbons, forecast lines, crosses), and the cards that stand on it.
import type { FocusEvent, MouseEvent, ReactNode } from "react";

import { estimateSummary, stageKey } from "@/components/timeline/timelineModel";
import { enumLabel } from "@/lib/enums";
import type { Technology } from "@/lib/types";

import { AXIS_DEPTH, CARD_WIDTH, FLOOR_DEPTH, LAST_YEAR, ROW_COUNT, rowY, type Tick, type TrackItem, type TrackLayout } from "./trackLayout";
import styles from "./TrackParts.module.css";

// Long ribbons and forecast lines repeat their milestone's code along the
// floor, so a stretch far from the card still says whose it is.
const TRACE_LABEL_EVERY = 1100;

export const TECHNOLOGIES: { id: Technology; label: string; short: string }[] = [
  { id: "wbe", label: "Brain emulation", short: "WBE" },
  { id: "bci", label: "Brain interfaces", short: "BCI" },
  { id: "neuromorphic", label: "Neuromorphic AI", short: "Neuromorphic" },
  { id: "hybrid", label: "Hybrid", short: "Hybrid" },
];

export function techShort(technology: Technology): string {
  for (const tech of TECHNOLOGIES) {
    if (tech.id === technology) {
      return tech.short;
    }
  }
  return technology;
}

// A small shape per technology, so cards say what they are without color.
export function TechGlyph({ technology, className }: { technology: Technology; className?: string }) {
  const classes = `${styles.techGlyph} ${className ?? ""}`;
  if (technology === "bci") {
    return (
      <svg className={classes} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.2 10.8 6 6 10.8 1.2 6Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (technology === "neuromorphic") {
    return (
      <svg className={classes} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.5 10.8 10.3H1.2Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (technology === "hybrid") {
    return (
      <svg className={classes} viewBox="0 0 12 12" aria-hidden="true">
        <rect x="1.7" y="1.7" width="8.6" height="8.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg className={classes} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

// What a screen reader hears for a card.
export function cardLabel(trackItem: TrackItem, needs: number): string {
  const { item } = trackItem;
  const parts = [`${item.code}, ${item.milestone.name}`, enumLabel("Stage", item.milestone.stage), estimateSummary(item)];
  if (item.view.disagreement.flagged) {
    parts.push("Sources disagree");
  }
  if (needs > 0) {
    parts.push(`Depends on ${needs} other ${needs === 1 ? "milestone" : "milestones"}`);
  }
  return `${parts.join(". ")}.`;
}

// ---------- Floor ----------

// Something that stands up off the floor at (x, y), facing the reader.
export function Standing({ x, y, children, className }: { x: number; y: number; children: ReactNode; className?: string }) {
  return (
    <div className={styles.post} style={{ left: x, top: y }}>
      <div className={`${styles.standing} ${className ?? ""}`}>{children}</div>
    </div>
  );
}

// The ticks that get a year label: none on top of the Now pill, and none so
// close to the one before that the numbers would touch (squeezed decades).
const MIN_LABEL_GAP = 120;

function yearLabels(layout: TrackLayout): Tick[] {
  const labels: Tick[] = [];
  for (const tick of layout.ticks) {
    if (Math.abs(tick.x - layout.nowX) <= 90) {
      continue;
    }
    const previous = labels.length > 0 ? labels[labels.length - 1] : null;
    if (previous && tick.x - previous.x < MIN_LABEL_GAP) {
      continue;
    }
    labels.push(tick);
  }
  return labels;
}

interface FloorMarksProps {
  layout: TrackLayout;
  nowYear: number;
  // Shorter zone notes, for the teaser.
  compact?: boolean;
}

export function FloorMarks({ layout, nowYear, compact = false }: FloorMarksProps) {
  const axisY = FLOOR_DEPTH - AXIS_DEPTH;
  const labelY = axisY + 34;
  const { neverZone, unknownZone } = layout;
  const labels = yearLabels(layout);
  const labelledYears = new Set<number>();
  for (const tick of labels) {
    labelledYears.add(tick.year);
  }
  return (
    <>
      <div className={styles.pastZone} style={{ left: 0, width: layout.nowX }} />
      {neverZone && <div className={styles.neverZone} style={{ left: neverZone.start, width: neverZone.end - neverZone.start }} />}
      {unknownZone && (
        <div className={styles.unknownZone} style={{ left: unknownZone.start, width: unknownZone.end - unknownZone.start }} />
      )}

      {/* A decade whose label was dropped for space gets a minor line, so the
          floor never shows a strong decade line with no year under it. */}
      {layout.ticks.map((tick) => (
        <div
          key={tick.year}
          className={tick.major && labelledYears.has(tick.year) ? styles.gridMajor : styles.gridMinor}
          style={{ left: tick.x, height: axisY }}
        />
      ))}
      <div className={styles.axis} style={{ top: axisY, width: layout.yearToX(LAST_YEAR) }} />

      {labels.map((tick) => (
        <Standing key={`label-${tick.year}`} x={tick.x} y={labelY}>
          <span className={tick.major ? styles.yearMajor : styles.yearMinor}>{tick.year}</span>
        </Standing>
      ))}

      <div className={styles.nowFloor} style={{ left: layout.nowX, height: axisY }} />
      <Standing x={layout.nowX} y={axisY + 40}>
        <span className={styles.nowLabel}>Now &middot; {nowYear}</span>
      </Standing>

      {neverZone && (
        <Standing x={neverZone.start + 40} y={labelY} className={styles.zoneSignPost}>
          <span className={styles.zoneSign}>
            <span className={styles.zoneLabel}>Never</span>
            {!compact && <span className={styles.zoneNote}>Forecasts that say it will never happen.</span>}
          </span>
        </Standing>
      )}
      {unknownZone && (
        <Standing x={unknownZone.start + 40} y={labelY} className={styles.zoneSignPost}>
          <span className={styles.zoneSign}>
            <span className={styles.zoneLabel}>Timing unknown</span>
            <span className={styles.zoneNote}>
              {compact ? "No forecast or team range yet." : "No forecast and no team range yet, so these have no place on the dates."}
            </span>
          </span>
        </Standing>
      )}
    </>
  );
}

// Where to repeat a milestone's code along its marks: every so often past the card.
function traceLabelPositions(trackItem: TrackItem): number[] {
  let reach = trackItem.x;
  if (trackItem.band) {
    reach = Math.max(reach, trackItem.band.x2);
  }
  for (const line of trackItem.forecastLines) {
    reach = Math.max(reach, line.x2);
  }
  const positions: number[] = [];
  for (let x = trackItem.x + CARD_WIDTH + TRACE_LABEL_EVERY / 2; x < reach - 200; x += TRACE_LABEL_EVERY) {
    positions.push(x);
  }
  return positions;
}

// Marks run in lanes along a card's row. Lane 0 sits at the card's foot; the
// next lanes run toward the front of the floor, one per forecast line.
const LANE_GAP = 22;

function laneTop(rowLineY: number, lane: number): number {
  return lane === 0 ? rowLineY - 9 : rowLineY + 26 + (lane - 1) * LANE_GAP;
}

// The ribbon, dot, forecast lines and never crosses a milestone casts on the
// floor, plus a dashed leader when its card had to stand to the right of its year.
export function FloorTrace({ trackItem, layout, dimmed = false }: { trackItem: TrackItem; layout: TrackLayout; dimmed?: boolean }) {
  const { item, band, forecastLines, neverCount, placement, lane } = trackItem;
  const y = rowY(trackItem.row);
  const stage = styles[`stage_${stageKey(item.milestone.stage)}`];
  const flagged = item.view.disagreement.flagged;
  const dim = dimmed ? styles.traceDimmed : "";

  if (placement !== "dated") {
    return (
      <div
        className={`${placement === "never" ? styles.neverBase : styles.unknownBase} ${dim}`}
        style={{ left: trackItem.x - 10, top: y - 6, width: CARD_WIDTH + 20 }}
      />
    );
  }

  // The ribbon or dot: 18px tall, centered on its lane.
  const markTop = lane === 0 ? y - 9 : laneTop(y, lane) - 6;
  const nudged = trackItem.x - trackItem.anchorX > 30;

  return (
    <>
      {nudged && (
        <div
          className={`${styles.leader} ${dim}`}
          style={{ left: trackItem.anchorX, top: markTop + 8, width: trackItem.x + 24 - trackItem.anchorX }}
        />
      )}
      {band && (
        <div
          className={`${band.kind === "team" ? styles.bandTeam : styles.bandSpan} ${stage} ${band.openRight ? styles.openRight : ""} ${dim}`}
          style={{ left: band.x1, top: markTop, width: Math.max(10, band.x2 - band.x1) }}
        />
      )}
      {item.view.barMode === "achieved" && (
        <div className={`${styles.achievedDot} ${stage} ${dim}`} style={{ left: trackItem.anchorX - 9, top: markTop }} />
      )}
      {forecastLines.map((line, index) => (
        <div
          key={line.id}
          className={`${styles.forecastLine} ${line.expired ? styles.expired : ""} ${line.openRight ? styles.openRight : ""} ${flagged ? styles.flaggedLine : ""} ${dim}`}
          style={{ left: line.x1, top: laneTop(y, lane + 1 + index), width: Math.max(8, line.x2 - line.x1) }}
        />
      ))}
      {traceLabelPositions(trackItem).map((x) => (
        <span key={`code-${x}`} className={`${styles.traceLabel} ${dim}`} style={{ left: x, top: markTop - 31 }}>
          {item.code}
        </span>
      ))}
      {neverCount > 0 && layout.neverZone && (
        <div
          className={`${styles.neverMark} ${dim}`}
          style={{ left: layout.neverZone.start + 140 + Math.min(trackItem.row, ROW_COUNT - 1) * 40, top: y }}
        >
          <span aria-hidden="true">&times;</span>
        </div>
      )}
    </>
  );
}

// ---------- Cards ----------

export type CardTone = "related" | "dimmed" | null;

interface TrackCardProps {
  trackItem: TrackItem;
  up: boolean;
  delay: number;
  selected?: boolean;
  tone?: CardTone;
  // How many milestones this one depends on, for the "Needs 2" chip.
  needs?: number;
  // With href the card is a link (the teaser); without, a button (the full track).
  // It's a plain <a>, so the href needs the base path: pass it through withBase().
  href?: string;
  // "large" uses bigger type, for places that draw the world small (the
  // teaser and phones).
  variant?: "regular" | "large";
  onActivate: (id: string, event: MouseEvent<HTMLElement>) => void;
  onFocusCard?: (id: string, event: FocusEvent<HTMLElement>) => void;
  onBlurCard?: (id: string) => void;
  onHoverChange?: (id: string | null) => void;
}

export function TrackCard({
  trackItem,
  up,
  delay,
  selected = false,
  tone = null,
  needs = 0,
  href,
  variant = "regular",
  onActivate,
  onFocusCard,
  onBlurCard,
  onHoverChange,
}: TrackCardProps) {
  const { item, placement } = trackItem;
  const { milestone, view } = item;
  const key = stageKey(milestone.stage);
  const y = rowY(trackItem.row);

  const classes = [
    styles.card,
    variant === "large" ? styles.cardLarge : "",
    placement === "unknown" ? styles.cardUnknown : "",
    selected ? styles.cardSelected : "",
    tone === "related" ? styles.cardRelated : "",
    tone === "dimmed" ? styles.cardDimmed : "",
  ].join(" ");

  const content = (
    <>
      <span className={`${styles.stageStrip} ${styles[`stage_${key}`]}`} aria-hidden="true" />
      <span className={styles.cardTop}>
        <TechGlyph technology={milestone.technology} />
        {/* The code already names the technology (WBE-01), and the glyph shows it too */}
        <span className={styles.cardCode}>{item.code}</span>
        {(milestone.sample || needs > 0) && (
          <span className={styles.cardChips}>
            {milestone.sample && <span className={styles.cardChip}>Sample</span>}
            {needs > 0 && <span className={styles.cardChip}>Needs {needs}</span>}
          </span>
        )}
      </span>
      <span className={styles.cardName}>{milestone.name}</span>
      <span className={styles.cardMeta}>
        <span className={styles[`stageInk_${key}`]}>{enumLabel("Stage", milestone.stage)}</span>
        {" · "}
        {estimateSummary(item)}
      </span>
      {view.disagreement.flagged && <span className={styles.stamp}>Sources disagree</span>}
    </>
  );

  const shared = {
    "data-card-id": milestone.id,
    "data-row": trackItem.row,
    "data-up": up ? "true" : "false",
    className: classes,
    style: { width: CARD_WIDTH, transitionDelay: up ? `${delay}ms` : "0ms" },
    "aria-label": cardLabel(trackItem, needs),
    onClick: (event: MouseEvent<HTMLElement>) => onActivate(milestone.id, event),
    onFocus: onFocusCard ? (event: FocusEvent<HTMLElement>) => onFocusCard(milestone.id, event) : undefined,
    onBlur: onBlurCard ? () => onBlurCard(milestone.id) : undefined,
    onPointerEnter: onHoverChange ? () => onHoverChange(milestone.id) : undefined,
    onPointerLeave: onHoverChange ? () => onHoverChange(null) : undefined,
  };

  return (
    <div className={styles.post} style={{ left: trackItem.x, top: y }}>
      {href ? (
        <a href={href} {...shared} draggable={false}>
          {content}
        </a>
      ) : (
        <button type="button" {...shared}>
          {content}
        </button>
      )}
    </div>
  );
}
