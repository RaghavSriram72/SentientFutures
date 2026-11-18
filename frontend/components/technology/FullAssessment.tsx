import type { ReactNode } from "react";

import { capitalize, joinList } from "./text";
import styles from "./FullAssessment.module.css";

export interface AssessmentPart {
  id: string; // a link target, such as "scorecard"
  title: string;
  summary: string; // for the line that lists what's inside, e.g. "the full scorecard"
  body: ReactNode;
}

interface FullAssessmentProps {
  parts: AssessmentPart[];
  // What the toggle names: "Show the full assessment", or "Show the full
  // scorecard" when the scorecard is the one part.
  label: "assessment" | "scorecard";
  top?: ReactNode;
}

// The working behind the ratings, collapsed by default: a native <details>, so
// it needs no JavaScript. OpenDetailsOnHash opens it when a link points inside.
// The browser can open it before React hydrates (a URL like /wbe/#scorecard),
// so the open attribute is allowed to differ from the server HTML.
export function FullAssessment({ parts, label, top }: FullAssessmentProps) {
  const summaries: string[] = [];
  for (const part of parts) {
    summaries.push(part.summary);
  }
  return (
    <>
      <p className={styles.contents}>{capitalize(joinList(summaries))}.</p>
      <details className={styles.details} suppressHydrationWarning>
        <summary className={styles.summary}>
          <span className={styles.closedLabel}>Show the full {label}</span>
          <span className={styles.openLabel}>Hide the full {label}</span>
          <span className={styles.toggle} aria-hidden="true" />
        </summary>
        <div className={styles.body}>
          {top}
          {parts.map((part) => (
            <div key={part.id} id={part.id} className={styles.part}>
              {/* With one part, the section's heading already names it. */}
              {parts.length > 1 && <h3 className={styles.partTitle}>{part.title}</h3>}
              {part.body}
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
