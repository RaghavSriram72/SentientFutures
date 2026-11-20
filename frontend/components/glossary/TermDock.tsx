"use client";

import { useEffect } from "react";

import styles from "./Term.module.css";

// The least room a tip under its word keeps from either edge of the window,
// the same as a docked tip.
const EDGE_GAP_PX = 16;

// The least room it keeps from the inside edge of a box that clips it, so its
// border doesn't run into the box's own.
const CLIP_GAP_PX = 6;

// How long the tip of a term that wraps stays up after the pointer leaves the
// term, long enough to cross a line of text on the way to the tip.
const LINGER_MS = 300;

// Glossary tips work without JavaScript (see Term). On a phone the tip docks
// to the bottom of the screen, and this fills two gaps that leaves. A tip that
// would cover its own word docks at the top instead, and a tip closes once its
// word has scrolled off the screen, under the sticky header or under the tip
// itself. At any width, Escape hides a tip that's showing. All three are data
// attributes on the term that Term.module.css reads. Where the tip sits under
// its word instead (a mouse, even in a narrow window), this slides one that
// would run off the screen, or out of a box that clips it, back into view,
// and keeps the tip of a term that wraps up for a moment after the pointer
// leaves it, so the pointer can still reach the tip. Renders nothing.
export function TermDock() {
  useEffect(() => {
    // The term whose tip was opened last, so scrolling can check it.
    let openTerm: HTMLElement | null = null;
    // The term whose tip is staying up after the pointer left it.
    let lingeringTerm: HTMLElement | null = null;
    let lingerTimer = 0;

    function stopLingering() {
      window.clearTimeout(lingerTimer);
      lingerTimer = 0;
      if (lingeringTerm) {
        delete lingeringTerm.dataset.linger;
        lingeringTerm = null;
      }
    }

    function partsOf(term: HTMLElement) {
      const word = term.querySelector<HTMLElement>(`.${styles.word}`);
      const tip = term.querySelector<HTMLElement>(`.${styles.tip}`);
      return word && tip ? { word, tip } : null;
    }

    function isDocked(tip: HTMLElement): boolean {
      return window.getComputedStyle(tip).position === "fixed";
    }

    // The strip a tip under its word can show in: the window, less the edge
    // gap on each side, narrowed to the inside of the nearest box around the
    // term that clips what overflows it (the technology page hero does).
    function visibleStrip(term: HTMLElement): { left: number; right: number } {
      let left = EDGE_GAP_PX;
      let right = document.documentElement.clientWidth - EDGE_GAP_PX;
      for (let box = term.parentElement; box && box !== document.body; box = box.parentElement) {
        if (window.getComputedStyle(box).overflowX !== "visible") {
          const boxLeft = box.getBoundingClientRect().left + box.clientLeft;
          left = Math.max(left, boxLeft + CLIP_GAP_PX);
          right = Math.min(right, boxLeft + box.clientWidth - CLIP_GAP_PX);
          break;
        }
      }
      return { left, right };
    }

    // Where the sticky header ends, or 0 once it has scrolled away. Anything
    // above this line is hidden behind the header.
    function headerBottom(): number {
      const header = document.querySelector("[data-site-chrome='header']");
      return header ? Math.max(header.getBoundingClientRect().bottom, 0) : 0;
    }

    // Runs as the pointer reaches the word or it takes focus, before the tip
    // is drawn, so the tip shows up in the right place straight away.
    function onOpen(event: Event) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const word = event.target.closest(`.${styles.word}`);
      const term = word?.parentElement;
      if (!term) {
        return;
      }
      const parts = partsOf(term);
      if (!parts) {
        return;
      }
      // Only one tip at a time: one still lingering closes now.
      stopLingering();
      delete term.dataset.dismissed;
      delete term.dataset.dock;
      term.style.removeProperty("--term-shift");
      openTerm = term;

      // Measure the tip where it would show: under its word, or docked at the
      // bottom. The inline display is put back straight away, before anything
      // is drawn.
      parts.tip.style.display = "block";
      const tipBox = parts.tip.getBoundingClientRect();
      parts.tip.style.display = "";

      if (!isDocked(parts.tip)) {
        // A word near the right edge pushed its tip (which starts at the word)
        // out of view: slide the tip left just enough. A word near the left
        // edge did the same to a tip lined up with its right edge (align
        // "end"): slide that one right. Either way the tip still covers the
        // word, so the strip that bridges the gap between them stays under
        // it. A tip too wide for the strip keeps its left edge in view, since
        // that's where its lines start.
        const strip = visibleStrip(term);
        let shift = 0;
        if (tipBox.right > strip.right) {
          shift = Math.floor(strip.right - tipBox.right);
        }
        if (tipBox.left + shift < strip.left) {
          shift = Math.ceil(strip.left - tipBox.left);
        }
        if (shift !== 0) {
          term.style.setProperty("--term-shift", `${shift}px`);
        }
        return;
      }

      if (parts.word.getBoundingClientRect().bottom + 8 > tipBox.top) {
        term.style.setProperty("--term-dock-top", `${Math.round(headerBottom() + 12)}px`);
        term.dataset.dock = "top";
      }
    }

    // The pointer left a term that wraps onto two lines or more. Its tip sits
    // under the last line, so moving down from an earlier one crosses other
    // text on the way: keep the tip up for a moment, so the pointer can get
    // across. A one-line term doesn't need it, since the strip in
    // Term.module.css bridges its gap, and a tip left up could cover the next
    // word the pointer heads for. A touch has no pointer to move, and a
    // docked tip closes some other way.
    function onLeave(event: PointerEvent) {
      if (event.pointerType === "touch" || !(event.target instanceof Element)) {
        return;
      }
      const term = event.target.closest<HTMLElement>(`.${styles.term}`);
      if (!term || term.dataset.dismissed !== undefined) {
        return;
      }
      // Moving between the word and its tip stays inside the term.
      if (event.relatedTarget instanceof Node && term.contains(event.relatedTarget)) {
        return;
      }
      const parts = partsOf(term);
      if (!parts || parts.word.getClientRects().length < 2 || isDocked(parts.tip)) {
        return;
      }
      stopLingering();
      lingeringTerm = term;
      term.dataset.linger = "";
      lingerTimer = window.setTimeout(stopLingering, LINGER_MS);
    }

    // Scroll events come fast, so check at most once per frame.
    let frame = 0;
    function onScroll() {
      if (frame !== 0 || !openTerm) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const term = openTerm;
        const parts = term ? partsOf(term) : null;
        if (!term || !parts) {
          return;
        }
        if (window.getComputedStyle(parts.tip).display === "none") {
          openTerm = null;
          return;
        }
        if (!isDocked(parts.tip)) {
          return;
        }
        // The word can only be seen between these two lines. The top one is
        // the header's bottom, not the top of the screen, since a word behind
        // the header is hidden too. The docked tip covers whichever edge it
        // sits on, so a word that has scrolled under it is hidden as well.
        let visibleTop = headerBottom();
        let visibleBottom = window.innerHeight;
        const tipBox = parts.tip.getBoundingClientRect();
        if (term.dataset.dock === "top") {
          visibleTop = Math.max(visibleTop, tipBox.bottom);
        } else {
          visibleBottom = tipBox.top;
        }
        const box = parts.word.getBoundingClientRect();
        if (box.bottom <= visibleTop || box.top >= visibleBottom) {
          term.dataset.dismissed = "";
          parts.word.blur();
          openTerm = null;
        }
      });
    }

    // Escape hides every tip that's showing, without moving focus or the
    // pointer (WCAG 1.4.13). It stays hidden until the pointer comes back onto
    // the word or the word takes focus again, since onOpen clears the mark.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      for (const term of document.querySelectorAll<HTMLElement>(`.${styles.term}`)) {
        const parts = partsOf(term);
        if (parts && window.getComputedStyle(parts.tip).display !== "none") {
          term.dataset.dismissed = "";
        }
      }
    }

    document.addEventListener("pointerover", onOpen);
    document.addEventListener("pointerout", onLeave);
    document.addEventListener("focusin", onOpen);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerover", onOpen);
      document.removeEventListener("pointerout", onLeave);
      document.removeEventListener("focusin", onOpen);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(frame);
      stopLingering();
    };
  }, []);

  return null;
}
