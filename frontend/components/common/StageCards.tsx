import { enumValues } from "@/lib/enums";
import type { Stage } from "@/lib/types";

import styles from "./StageCards.module.css";

// A sentence on top of each stage's description, for the about and methodology pages.
const STAGE_DETAIL: Record<Stage, string> = {
  possible: "A lab demo counts. It says nothing yet about cost, safety or who gets access.",
  widely_available: "Most hurdles here aren't scientific. Cost, safety, regulation and supply all have to work for people beyond a few labs and trials.",
  actually_helping: "The bar that matters. Something can be widely available and still not help at all.",
};

// The three stages as paper cards, each with its stage color across the top.
// The name is printed in the stage's ink color, and the number and words carry
// the meaning, so color is never the only cue.
export function StageCards() {
  return (
    <ol className={styles.stages}>
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
