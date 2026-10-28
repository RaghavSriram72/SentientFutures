// Small pictures of the marks the 3D track draws on its floor, for the track's
// Key, the list view and any page that explains how to read the timeline.
// Plain SVG with no hooks, so server components can use them too.
//
// Without a stage they're drawn in neutral ink, which is how the Key shows
// them: color on the track means the stage, not the kind of mark. Pass a stage
// to draw one in that stage's color.
import type { Stage } from "@/lib/types";

import styles from "./TrackGlyphs.module.css";

interface GlyphProps {
  stage?: Stage;
  className?: string;
}

function toneClass(stage: Stage | undefined): string {
  if (stage === "possible") {
    return styles.stage_possible;
  }
  if (stage === "widely_available") {
    return styles.stage_widely;
  }
  if (stage === "actually_helping") {
    return styles.stage_helping;
  }
  return styles.neutral;
}

function glyphClass(stage: Stage | undefined, className: string | undefined): string {
  return [styles.glyph, toneClass(stage), className ?? ""].join(" ");
}

// Solid ribbon: a range the team set. `open` fades it out on the right, for a
// range with no end year.
export function RibbonSwatch({ stage, className, open = false }: GlyphProps & { open?: boolean }) {
  return (
    <svg className={glyphClass(stage, className)} viewBox="0 0 44 16" aria-hidden="true">
      {open ? (
        <>
          <rect x={2.5} y={3.5} width={29} height={9} rx={4.5} className={styles.solid} />
          <rect x={33} y={3.5} width={3.5} height={9} rx={1.5} className={styles.solid} opacity={0.55} />
          <rect x={38} y={3.5} width={3.5} height={9} rx={1.5} className={styles.solid} opacity={0.25} />
        </>
      ) : (
        <rect x={2.5} y={3.5} width={39} height={9} rx={4.5} className={styles.solid} />
      )}
    </svg>
  );
}

// Faint ribbon: the years the forecasts cover, when they roughly agree.
export function FaintRibbonSwatch({ stage, className }: GlyphProps) {
  return (
    <svg className={glyphClass(stage, className)} viewBox="0 0 44 16" aria-hidden="true">
      <rect x={2.5} y={3} width={39} height={10} rx={5} className={styles.faint} />
    </svg>
  );
}

// Thin line: one forecast, with a tick at each end. `disagrees` draws it red,
// as the track does for forecasts that disagree with another.
export function LineSwatch({ stage, className, disagrees = false }: GlyphProps & { disagrees?: boolean }) {
  const lineClass = disagrees ? `${styles.line} ${styles.lineFlagged}` : styles.line;
  return (
    <svg className={glyphClass(stage, className)} viewBox="0 0 44 16" aria-hidden="true">
      <g className={lineClass}>
        <line x1={5} y1={8} x2={39} y2={8} />
        <line x1={5} y1={3.5} x2={5} y2={12.5} />
        <line x1={39} y1={3.5} x2={39} y2={12.5} />
      </g>
    </svg>
  );
}

// A cross in the Never zone: someone said it will never happen.
export function NeverCross({ stage, className }: GlyphProps) {
  const crossClass = stage ? styles.crossStage : styles.cross;
  return (
    <svg className={glyphClass(stage, className)} viewBox="0 0 44 16" aria-hidden="true">
      <path d="M17.5 3.5 L26.5 12.5 M17.5 12.5 L26.5 3.5" className={crossClass} />
    </svg>
  );
}

// The hatched floor of the Timing unknown zone: no forecast and no team range.
// The hatching is drawn line by line, clipped to the box by hand, so the
// component needs no ids and can appear any number of times on a page.
const HATCH_BOX = { x1: 2.5, y1: 2.5, x2: 41.5, y2: 13.5 };

function hatchLines(): { x1: number; y1: number; x2: number; y2: number }[] {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const { x1, y1, x2, y2 } = HATCH_BOX;
  // Lines of the form x + y = c, from the bottom-left corner to the top-right one.
  for (let c = x1 + y1 + 4; c < x2 + y2; c += 5) {
    const startX = Math.max(x1, c - y2);
    const endX = Math.min(x2, c - y1);
    lines.push({ x1: startX, y1: c - startX, x2: endX, y2: c - endX });
  }
  return lines;
}

const HATCH = hatchLines();

export function UnknownZoneSwatch({ stage, className }: GlyphProps) {
  const { x1, y1, x2, y2 } = HATCH_BOX;
  return (
    <svg className={glyphClass(stage, className)} viewBox="0 0 44 16" aria-hidden="true">
      <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} className={styles.zoneFill} />
      <g className={styles.hatch}>
        {HATCH.map((line) => (
          <line key={line.x1 + line.y1} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
        ))}
      </g>
      <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} className={styles.zoneEdge} />
    </svg>
  );
}

// A dot on the floor: the year a milestone was reached.
export function AchievedDot({ stage, className }: GlyphProps) {
  return (
    <svg className={glyphClass(stage, className)} viewBox="0 0 44 16" aria-hidden="true">
      <circle cx={22} cy={8} r={5} className={styles.dot} />
    </svg>
  );
}

// A curved link from one milestone to another that depends on it. The arrow
// points at the one that needs the other first.
export function DependencySwatch({ stage, className }: GlyphProps) {
  return (
    <svg className={glyphClass(stage, className)} viewBox="0 0 44 16" aria-hidden="true">
      <path d="M4 6 C 14 14, 28 14, 38 6" className={styles.link} />
      <polygon points="40.3,4.1 37.5,10.1 33.7,5.5" className={styles.linkHead} />
    </svg>
  );
}
