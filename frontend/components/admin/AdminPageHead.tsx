"use client";

import { useLayoutEffect, useRef, type ReactNode, type Ref, type RefObject } from "react";

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

// True while a heading that had focus is being replaced by another, e.g. an
// editor's "Loading the milestone" by the form's own heading once it loads.
// It lives at module level because the two headings belong to different
// components that know nothing of each other. Only one admin page is on
// screen at a time, so there's only ever one handover to track.
let focusedHeadingLeft = false;

// The new heading takes focus over from the one it replaces, so focus
// doesn't drop to the page in between (after signing in on an editor's
// address, say). Within one React commit, the old heading's layout cleanup
// runs first, while it's still on the page with focus, and sets the flag.
// React then removes it, and the new heading's layout effect sees the flag
// and takes focus. The microtask clears the flag once the commit is over, so
// leaving for a page without a heading doesn't let a later one take focus.
function useFocusHandOver(headRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const heading = headRef.current?.querySelector("h1") ?? null;
    if (focusedHeadingLeft && document.activeElement === document.body) {
      heading?.focus();
    }
    focusedHeadingLeft = false;
    return () => {
      if (heading === null || document.activeElement !== heading) {
        return;
      }
      focusedHeadingLeft = true;
      queueMicrotask(() => {
        focusedHeadingLeft = false;
      });
    };
  }, [headRef]);
}

// A slimmer version of the public PageHeader: admin screens are for working,
// so the band is shorter and the title smaller.
export function AdminPageHead({ eyebrow, title, lede, actions, kicker, headingRef }: AdminPageHeadProps) {
  const headRef = useRef<HTMLElement>(null);
  useFocusHandOver(headRef);

  return (
    <header ref={headRef} className={styles.head}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.text}>
          {kicker && <div className={styles.kicker}>{kicker}</div>}
          <p className={`eyebrow ${styles.eyebrow}`}>{eyebrow}</p>
          {/* Always focusable: signing in moves focus here too (AdminShell). */}
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            {title}
          </h1>
          {lede && <p className={styles.lede}>{lede}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
}
