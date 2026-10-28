"use client";

import { useEffect, useState } from "react";

import styles from "./TocNav.module.css";

export interface TocItem {
  id: string;
  label: string; // the same words as the section's heading
}

// The "On this page" list. While you scroll, the section you're reading is
// marked with aria-current, so the list shows where you are.
export function TocNav({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    // The current section is the last one whose top has scrolled above a line
    // a third of the way down the screen. At the very bottom of the page the
    // last section wins, since a short final section may never reach the line.
    function findActive(): string | null {
      const line = window.innerHeight * 0.33;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current: string | null = null;
      for (const item of items) {
        const section = document.getElementById(item.id);
        if (!section) {
          continue;
        }
        if (atBottom || section.getBoundingClientRect().top <= line) {
          current = item.id;
        }
      }
      return current;
    }

    // Scroll events come fast, so measure at most once per frame.
    let frame = 0;
    function onScroll() {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setActiveId(findActive());
      });
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [items]);

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
