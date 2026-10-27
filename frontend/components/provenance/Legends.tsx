import { enumDescription, enumValues } from "@/lib/enums";
import type { Provenance, Stage } from "@/lib/types";

import { ProvenanceTag } from "./ProvenanceTag";
import styles from "./Provenance.module.css";

const PROVENANCE_ORDER: Provenance[] = ["source", "team", "ai", "unclear"];

// The site-wide key for the four kinds of content. Shown on the timeline,
// the sources page, technology pages and methodology.
export function ProvenanceLegend({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className={styles.legendCompact} aria-label="What the marks mean">
        {PROVENANCE_ORDER.map((kind) => (
          <ProvenanceTag key={kind} kind={kind} plain />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.legend} aria-label="What the marks mean">
      {PROVENANCE_ORDER.map((kind) => (
        <div key={kind} className={`${styles.legendItem} ${styles[`legendItem_${kind}`]}`}>
          <ProvenanceTag kind={kind} plain />
          <p className={styles.legendDesc}>{enumDescription("Provenance", kind)}</p>
        </div>
      ))}
    </div>
  );
}

// Stage is the only thing color carries on the timeline.
export function StageLegend() {
  return (
    <ul className={styles.stageLegend} aria-label="Stages">
      {enumValues("Stage").map((info) => (
        <li key={info.value} className={styles.stageItem}>
          <span className={`${styles.stageSwatch} ${styles[`stage_${info.value as Stage}`]}`} aria-hidden="true" />
          {info.label}
        </li>
      ))}
    </ul>
  );
}
