import type { ReactNode } from "react";

import { Stamp } from "@/components/common/Stamp";

import styles from "./RuleSpecimens.module.css";

// Small printed-chart drawings of what the timeline draws in each case. They are
// illustrations, not data, so the SVGs are hidden from screen readers and the
// caption carries the meaning.

function Whisker({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <g className={styles.whisker}>
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} />
      <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} />
    </g>
  );
}

function Grid() {
  const ticks: number[] = [];
  for (let x = 20; x <= 260; x += 40) {
    ticks.push(x);
  }
  return (
    <g className={styles.grid}>
      {ticks.map((x) => (
        <line key={x} x1={x} y1={4} x2={x} y2={52} />
      ))}
    </g>
  );
}

function TeamRange() {
  return (
    <svg viewBox="0 0 280 56" className={styles.svg} aria-hidden="true">
      <Grid />
      <rect x={78} y={22} width={124} height={12} rx={6} className={styles.bar} />
      <Whisker x1={52} x2={150} y={12} />
      <Whisker x1={120} x2={236} y={45} />
    </svg>
  );
}

function SpanBand() {
  return (
    <svg viewBox="0 0 280 56" className={styles.svg} aria-hidden="true">
      <Grid />
      <rect x={60} y={10} width={160} height={36} rx={10} className={styles.band} />
      <Whisker x1={60} x2={170} y={20} />
      <Whisker x1={96} x2={220} y={36} />
    </svg>
  );
}

function Disagree() {
  return (
    <svg viewBox="0 0 280 56" className={styles.svg} aria-hidden="true">
      <Grid />
      <Whisker x1={30} x2={92} y={18} />
      <Whisker x1={188} x2={250} y={38} />
      <line x1={92} y1={28} x2={188} y2={28} className={styles.gap} />
    </svg>
  );
}

function NoEstimate() {
  return (
    <svg viewBox="0 0 280 56" className={styles.svg} aria-hidden="true">
      <defs>
        <pattern id="method-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className={styles.hatchLine} />
        </pattern>
      </defs>
      <Grid />
      <rect x={70} y={16} width={140} height={24} rx={12} fill="url(#method-hatch)" className={styles.noEstimate} />
    </svg>
  );
}

interface Specimen {
  key: string;
  label: string;
  text: string;
  drawing: ReactNode;
  stamp?: boolean;
}

const SPECIMENS: Specimen[] = [
  {
    key: "team",
    label: "Team range",
    text: "The team has set a range with a written basis, so it's a solid bar. It wins over the forecasts, but every forecast is still drawn.",
    drawing: <TeamRange />,
  },
  {
    key: "span",
    label: "Forecasts agree",
    text: "No team range, two or more forecasts, and no disagreement: a faint band over their full span, next to the forecasts themselves.",
    drawing: <SpanBand />,
  },
  {
    key: "disagree",
    label: "Forecasts disagree",
    text: "No band at all. You see each forecast on its own and a stamp, so the split is impossible to miss.",
    drawing: <Disagree />,
    stamp: true,
  },
  {
    key: "none",
    label: "Nothing yet",
    text: "No range and no forecasts: a hatched \"No estimate yet\" label instead of a guess.",
    drawing: <NoEstimate />,
  },
];

export function RuleSpecimens() {
  return (
    <ul className={styles.list}>
      {SPECIMENS.map((specimen) => (
        <li key={specimen.key} className={`paper ${styles.item}`}>
          <figure className={styles.figure}>
            <div className={styles.plate}>{specimen.drawing}</div>
            <figcaption className={styles.caption}>
              <span className={styles.label}>
                {specimen.label}
                {specimen.stamp && <Stamp size="sm" />}
              </span>
              <span className={styles.text}>{specimen.text}</span>
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
