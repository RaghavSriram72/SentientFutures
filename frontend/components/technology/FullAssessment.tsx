import type { ReactNode } from "react";

import { capitalize, joinList } from "./text";
import styles from "./FullAssessment.module.css";

export interface AssessmentPart {
  id: string; // a link target, such as "scorecard"
  title: string;
  summary: string; // for the line that lists what's inside, e.g. "the full scorecard"
  body: ReactNode;
}

// The working behind the ratings, collapsed by default: a native <details>, so
// it needs no JavaScript. OpenDetailsOnHash opens it when a link points inside.
export function FullAssessment({ parts, top }: { parts: AssessmentPart[]; top?: ReactNode }) {
  const summaries: string[] = [];
  for (const part of parts) {
    summaries.push(part.summary);
  }
  return (
    <>
      <p className={styles.contents}>{capitalize(joinList(summaries))}.</p>
      <details className={styles.details}>
        <summary className={styles.summary}>
          <span className={styles.closedLabel}>Show the full assessment</span>
          <span className={styles.openLabel}>Hide the full assessment</span>
          <span className={styles.toggle} aria-hidden="true" />
        </summary>
        <div className={styles.body}>
          {top}
          {parts.map((part) => (
            <div key={part.id} id={part.id} className={styles.part}>
              <h3 className={styles.partTitle}>{part.title}</h3>
              {part.body}
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
