import type { ReactNode } from "react";

import styles from "./PageHeader.module.css";

interface PageHeaderProps {
  eyebrow: string;
  // Pass a fragment with exactly one <em>, e.g. <>Tell us where we&rsquo;re <em>wrong</em></>
  title: ReactNode;
  lede?: ReactNode;
  // Shown above the eyebrow, e.g. a "back to all posts" link.
  kicker?: ReactNode;
  // Narrow centers everything on the 680px reading column (blog posts).
  narrow?: boolean;
  // A row under the lede for counts, chips or buttons.
  children?: ReactNode;
}

// The washed band at the top of every inner page.
export function PageHeader({ eyebrow, title, lede, kicker, narrow = false, children }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className="container">
        <div className={`${styles.inner} ${narrow ? styles.narrow : ""}`}>
          {kicker && <div className={styles.kicker}>{kicker}</div>}
          <p className={`eyebrow ${styles.eyebrow}`}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          {lede && <p className={`lede ${styles.lede}`}>{lede}</p>}
          {children && <div className={styles.extra}>{children}</div>}
        </div>
      </div>
    </header>
  );
}
