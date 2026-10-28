import { enumValues } from "@/lib/enums";
import type { Stage } from "@/lib/types";

import styles from "./StageCards.module.css";

// A sentence on top of each stage's description, for the about and methodology pages.
const STAGE_DETAIL: Record<Stage, string> = {
  possible: "A lab demo is enough to count. It tells you nothing yet about cost, safety or who can get it.",
  widely_available: "Most of the hurdles at this stage are practical ones: cost, safety, regulation and supply have to work out for people outside a handful of labs and trials.",
  actually_helping: "The proposals are aiming for this stage, and wide use alone doesn't get a technology there.",
};

// The three stages as paper cards, each with its stage color across the top.
// The name is printed in the stage's ink color, and the number and words carry
// the meaning, so color is never the only cue. Compact cards are shorter, for
// pages that list a lot else besides.
export function StageCards({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`${styles.stages} ${compact ? styles.compact : ""}`}>
      {enumValues("Stage").map((info, index) => {
        const stage = info.value as Stage;
        return (
          <li key={stage} className={`${styles.stage} ${styles[`stage_${stage}`]} reveal`}>
            <span className={styles.number}>Stage {index + 1}</span>
            <h3 className={styles.name}>{info.label}</h3>
            <p className={styles.desc}>{info.description}</p>
            <p className={styles.detail}>{STAGE_DETAIL[stage]}</p>
          </li>
        );
      })}
    </ol>
  );
}
