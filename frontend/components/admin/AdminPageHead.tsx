import type { ReactNode, Ref } from "react";

import styles from "./AdminPageHead.module.css";

interface AdminPageHeadProps {
  eyebrow: string;
  // A fragment with one <em>, like the public page headers.
  title: ReactNode;
  lede?: ReactNode;
  // Buttons or links on the right, e.g. "Refresh".
  actions?: ReactNode;
  // Above the eyebrow, e.g. a back link.
  kicker?: ReactNode;
  // Lets a page move focus to the heading after it loads new content.
  headingRef?: Ref<HTMLHeadingElement>;
}

// A slimmer version of the public PageHeader: admin screens are for working,
// so the band is shorter and the title smaller.
export function AdminPageHead({ eyebrow, title, lede, actions, kicker, headingRef }: AdminPageHeadProps) {
  return (
    <header className={styles.head}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.text}>
          {kicker && <div className={styles.kicker}>{kicker}</div>}
          <p className={`eyebrow ${styles.eyebrow}`}>{eyebrow}</p>
          <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={styles.title}>
            {title}
          </h1>
          {lede && <p className={styles.lede}>{lede}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
}
