"use client";

import { useActiveSection } from "@/components/common/useActiveSection";

import styles from "./TocNav.module.css";

export interface TocItem {
  id: string;
  label: string; // the same words as the section's heading
}

// The "On this page" list. While you scroll, the section you're reading is
// marked with aria-current, so the list shows where you are.
export function TocNav({ items }: { items: TocItem[] }) {
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
  }
  const activeId = useActiveSection(ids);

  return (
    <nav className={styles.toc} aria-label="On this page">
      <p className={`eyebrow ${styles.title}`}>On this page</p>
      <ol className={styles.list}>
        {items.map((item, index) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={styles.link}
                aria-current={active ? "location" : undefined}
              >
                <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
