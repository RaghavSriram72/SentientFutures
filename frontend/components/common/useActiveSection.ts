"use client";

import { useEffect, useState } from "react";

import { isReturnVisit } from "./HashLinkHistory";

// After a jump, the page counts as settled once it has gone this long without
// a scroll event. The browser's smooth scroll to a section fires one per frame.
const SETTLE_DELAY_MS = 150;

// The id of the section the reader is in, for an "On this page" list, or null
// above the first one. Takes the section ids in page order.
export function useActiveSection(ids: string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  // A new array arrives on every render, so the effect keys on the ids
  // themselves and only starts over when they change.
  const idKey = ids.join(" ");

  useEffect(() => {
    const sectionIds = idKey.split(" ");

    // The current section is the last one whose top has scrolled above a line
    // a third of the way down the screen. At the very bottom of the page the
    // last section wins, since a short final section may never reach the line.
    function findActive(): string | null {
      const line = window.innerHeight * 0.33;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current: string | null = null;
      for (const id of sectionIds) {
        const section = document.getElementById(id);
        if (!section) {
          continue;
        }
        if (atBottom || section.getBoundingClientRect().top <= line) {
          current = id;
        }
      }
      return current;
    }

    // The section the reader jumped to with a link, kept marked until the
    // page moves on from where the jump left it. Near the end of the page a
    // short section can sit above the line together with the next one, so
    // the rule above would mark the section after the one they asked for.
    let jumpedTo: string | null = null;
    // Coming back to an entry with a #hash (Back, Forward or a reload) puts
    // the reader where they were, which may be far from that section. It's
    // marked again only if its heading is on screen once the page settles
    // there, as it was after the jump.
    let returningTo: string | null = null;
    // Where the page came to rest, or null while it's still scrolling there.
    let settledAt: number | null = null;
    let settleTimer = 0;

    function headingOnScreen(id: string): boolean {
      const section = document.getElementById(id);
      if (!section) {
        return false;
      }
      const top = section.getBoundingClientRect().top;
      return top >= 0 && top < window.innerHeight;
    }

    function waitToSettle() {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settledAt = window.scrollY;
        if (returningTo !== null && headingOnScreen(returningTo)) {
          jumpedTo = returningTo;
          onScroll();
        }
        returningTo = null;
      }, SETTLE_DELAY_MS);
    }

    function sectionFromHash(hash: string): string | null {
      const id = decodeURIComponent(hash.slice(1));
      return sectionIds.includes(id) ? id : null;
    }

    function jumpTo(id: string | null) {
      jumpedTo = id;
      returningTo = null;
      settledAt = null;
      if (id) {
        waitToSettle();
      }
    }

    function returnTo(id: string | null) {
      jumpedTo = null;
      returningTo = id;
      settledAt = null;
      if (id) {
        waitToSettle();
      }
    }

    // A new #hash is a jump. Back, Forward or a reload comes back to where
    // the reader was, so the hash only counts if its section is still there.
    function followHash() {
      const id = sectionFromHash(window.location.hash);
      if (isReturnVisit()) {
        returnTo(id);
      } else {
        jumpTo(id);
      }
    }

    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const link = event.target.closest("a[href^='#']");
      if (link) {
        const id = sectionFromHash(link.getAttribute("href") ?? "");
        if (id) {
          jumpTo(id);
          setActiveId(id);
        }
      }
    }

    function onHashChange() {
      followHash();
      onScroll();
    }

    // A wheel, a touch or a key means the reader is moving on their own.
    // Clicking a link with the keyboard also starts with a key, and the click
    // that follows marks the new section again.
    function onReaderInput() {
      jumpTo(null);
    }

    // Scroll events come fast, so measure at most once per frame.
    let frame = 0;
    function onScroll() {
      // Moving away from where the jump settled, by any means: the reader
      // dragging the scrollbar, Back restoring a position, a script.
      if (jumpedTo !== null || returningTo !== null) {
        if (settledAt === null) {
          waitToSettle();
        } else if (Math.abs(window.scrollY - settledAt) > 1) {
          jumpTo(null);
        }
      }
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setActiveId(jumpedTo ?? findActive());
      });
    }

    // Arriving with a hash counts too: as a jump, or as a return on a reload
    // or Back from another page.
    followHash();
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    window.addEventListener("wheel", onReaderInput, { passive: true });
    window.addEventListener("touchstart", onReaderInput, { passive: true });
    window.addEventListener("keydown", onReaderInput);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick);
      window.removeEventListener("wheel", onReaderInput);
      window.removeEventListener("touchstart", onReaderInput);
      window.removeEventListener("keydown", onReaderInput);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
    };
  }, [idKey]);

  return activeId;
}
