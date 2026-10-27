// Small pictures of the chart's marks, for the key above the chart, the list
// view and the "How to read this" section. Drawn with the same classes as the
// chart so they always match it.
import type { Stage } from "@/lib/types";

import { stageKey } from "./ChartMarks";
import marks from "./ChartMarks.module.css";
import styles from "./MarkLegend.module.css";

export type MarkKind =
  | "team"
  | "teamOpen"
  | "span"
  | "whisker"
  | "point"
  | "open"
  | "expired"
  | "never"
  | "achieved"
  | "stamp"
  | "none"
  | "now";

export function MarkGlyph({ kind, stage = "possible" }: { kind: MarkKind; stage?: Stage }) {
  const key = stageKey(stage);

  if (kind === "stamp") {
    return (
      <span className={styles.stampGlyph} aria-hidden="true">
        Disagree
      </span>
    );
  }
  if (kind === "none") {
    return <span className={styles.hatchGlyph} aria-hidden="true" />;
  }

  return (
    <svg className={styles.glyph} viewBox="0 0 44 16" aria-hidden="true">
      {kind === "team" && <rect x={3} y={3} width={38} height={10} rx={4} className={marks[`bar_${key}`]} />}
      {kind === "teamOpen" && (
        <>
          <rect x={3} y={3} width={30} height={10} rx={4} className={marks[`bar_${key}`]} />
          <path d="M36 4 L41 8 L36 12" className={marks[`chevron_${key}`]} />
        </>
      )}
      {kind === "span" && <rect x={3} y={2} width={38} height={12} rx={6} className={marks[`span_${key}`]} />}
      {kind === "whisker" && (
        <g className={marks.forecast}>
          <line x1={6} y1={8} x2={38} y2={8} className={marks.whisker} />
          <line x1={6} y1={3.5} x2={6} y2={12.5} className={marks.whisker} />
          <line x1={38} y1={3.5} x2={38} y2={12.5} className={marks.whisker} />
        </g>
      )}
      {kind === "point" && <circle cx={22} cy={8} r={4.5} className={marks.whiskerDot} />}
      {kind === "open" && (
        <g className={marks.forecast}>
          <line x1={6} y1={8} x2={39} y2={8} className={marks.whisker} />
          <line x1={6} y1={3.5} x2={6} y2={12.5} className={marks.whisker} />
          <path d="M34 4 L39 8 L34 12" className={marks.whisker} />
        </g>
      )}
      {kind === "expired" && (
        <g className={marks.expired}>
          <line x1={6} y1={8} x2={38} y2={8} className={marks.whisker} />
          <line x1={6} y1={3.5} x2={6} y2={12.5} className={marks.whisker} />
          <line x1={38} y1={3.5} x2={38} y2={12.5} className={marks.whisker} />
        </g>
      )}
      {kind === "never" && <path d="M17.5 3.5 L26.5 12.5 M17.5 12.5 L26.5 3.5" className={marks.whisker} />}
      {kind === "achieved" && (
        <>
          <circle cx={22} cy={8} r={6.5} className={`${marks.achievedDot} ${marks[`bar_${key}`]}`} />
          <path d="M19 8.2 L21.2 10.4 L25.2 5.8" className={marks.achievedCheck} />
        </>
      )}
      {kind === "now" && <line x1={22} y1={1} x2={22} y2={15} className={styles.nowLine} />}
    </svg>
  );
}

const KEY_ITEMS: Array<{ kind: MarkKind; label: string }> = [
  { kind: "team", label: "Our range" },
  { kind: "span", label: "Forecast span" },
  { kind: "whisker", label: "One forecast" },
  { kind: "never", label: "Says never" },
  { kind: "stamp", label: "Sources disagree" },
  { kind: "none", label: "No estimate yet" },
];

// The one-line key that sits above the chart.
export function MarkLegend() {
  return (
    <ul className={styles.legend} aria-label="Chart marks">
      {KEY_ITEMS.map((entry) => (
        <li key={entry.kind} className={styles.item}>
          <MarkGlyph kind={entry.kind} />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
