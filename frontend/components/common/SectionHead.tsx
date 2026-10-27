import type { ReactNode } from "react";

import styles from "./SectionHead.module.css";

interface SectionHeadProps {
  // A mono label above the heading, e.g. "01 · How to read this site"
  eyebrow: string;
  // A fragment with exactly one <em>.
  title: ReactNode;
  id?: string;
  intro?: ReactNode;
}

// The heading block at the top of a page section: mono label, serif h2, short intro.
export function SectionHead({ eyebrow, title, id, intro }: SectionHeadProps) {
  return (
    <div className={styles.head}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className={styles.title}>
        {title}
      </h2>
      {intro && <p className={styles.intro}>{intro}</p>}
    </div>
  );
}
