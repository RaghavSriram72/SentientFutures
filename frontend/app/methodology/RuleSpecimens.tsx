import type { ReactNode } from "react";

import { Stamp } from "@/components/common/Stamp";
import {
  AchievedDot,
  FaintRibbonSwatch,
  LineSwatch,
  NeverCross,
  RibbonSwatch,
  UnknownZoneSwatch,
} from "@/components/timeline3d/TrackGlyphs";

import styles from "./RuleSpecimens.module.css";

// What the timeline track draws in each case, using the track's own glyphs and
// the words from its Key. The glyphs are decoration; the caption carries the meaning.

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
    label: "Solid ribbon",
    text: "The team has set a range and written down why. The solid ribbon takes priority, and any forecasts still show next to it as thin lines.",
    drawing: <RibbonSwatch />,
  },
  {
    key: "span",
    label: "Faint ribbon",
    text: "There's no team range, and at least two forecasts roughly agree. A faint ribbon covers the years they span, with each forecast as a thin line over it.",
    drawing: (
      <span className={styles.stack}>
        <FaintRibbonSwatch />
        <LineSwatch />
      </span>
    ),
  },
  {
    key: "line",
    label: "Thin line",
    text: "One forecast. The milestone's panel says who made it and when, the window they gave, and the exact quote.",
    drawing: <LineSwatch />,
  },
  {
    key: "disagree",
    label: "Red thin lines",
    text: "Forecasts that disagree. There's no ribbon at all, just each forecast on its own and the stamp.",
    drawing: (
      <span className={styles.stack}>
        <LineSwatch disagrees />
        <LineSwatch disagrees />
      </span>
    ),
    stamp: true,
  },
  {
    key: "achieved",
    label: "Dot",
    text: "The milestone has already happened, and the dot sits at the year it did.",
    drawing: <AchievedDot />,
  },
  {
    key: "never",
    label: "Cross in the Never zone",
    text: "Someone said the milestone will never happen. Their forecast is a cross in the Never zone near the end of the track, so it stays in view next to the forecasts that give years.",
    drawing: <NeverCross />,
  },
  {
    key: "unknown",
    label: "Timing unknown zone",
    text: "No team range and no forecasts yet. The milestone waits in the Timing unknown zone at the end of the track until someone gives it a date.",
    drawing: <UnknownZoneSwatch />,
  },
];

export function RuleSpecimens() {
  return (
    <ul className={styles.list}>
      {SPECIMENS.map((specimen) => (
        <li key={specimen.key} className={styles.item}>
          <div className={styles.plate} aria-hidden="true">
            {specimen.drawing}
          </div>
          <div className={styles.caption}>
            <span className={styles.label}>
              {specimen.label}
              {specimen.stamp && <Stamp size="sm" />}
            </span>
            <span className={styles.text}>{specimen.text}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
