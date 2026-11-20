"use client";

import { useEffect } from "react";

// The key in a history entry's state that holds how far down the reader had
// scrolled on it, in px.
const SCROLL_KEY = "sfScrollY";

// The keys for the <details> open on the entry (OpenDetailsOnHash) and the
// source rows open on it (SourceDatabase).
export const OPEN_DETAILS_KEY = "sfOpenDetails";
export const OPEN_ROWS_KEY = "sfOpenRows";

// Everything the site stores on an entry about the reader's place on it.
const PLACE_KEYS = [SCROLL_KEY, OPEN_DETAILS_KEY, OPEN_ROWS_KEY];

// Scrolling stores the position once it pauses this long. Safari stops
// history writes after about 100 in 30 seconds, so not on every scroll event.
const SAVE_DELAY_MS = 150;

// How long a restored position is held after Back, Forward or a reload. In
// that time the router draws the page, folded <details> and source rows open
// again, and the browser starts its own jump to the #hash; each can move it.
const RESTORE_HOLD_MS = 700;

// The browser follows an in-page link straight after its click, with a
// popstate of its own. A click that went nowhere stops counting after this.
// OpenDetailsOnHash tells that popstate from Back the same way.
export const LINK_FOLLOW_MS = 100;

function readState(): Record<string, unknown> | null {
  const state: unknown = window.history.state;
  if (state === null || typeof state !== "object") {
    return null;
  }
  return state as Record<string, unknown>;
}

// Loading the address the tab already shows, as Enter in the address bar
// does, is a new visit, but Chrome keeps the entry and the state stored on
// it. Every page then took it for a return: the folds and rows the reader had
// open came back open, with the page at its top. So a new visit drops what
// was stored about the reader's place. Back, Forward and a reload keep it.
function forgetPlaceOnNewVisit() {
  const navigation = performance.getEntriesByType("navigation")[0];
  if (!(navigation instanceof PerformanceNavigationTiming) || navigation.type !== "navigate") {
    return;
  }
  const state = readState();
  if (state === null || !PLACE_KEYS.some((key) => key in state)) {
    return;
  }
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!PLACE_KEYS.includes(key)) {
      kept[key] = value;
    }
  }
  try {
    window.history.replaceState(kept, "");
  } catch {
    // Safari's limit on history writes. The page then shows it as a return.
  }
}

// Once, as the site's scripts load, so before any page reads the entry. Not
// on the server, which has no history.
if (typeof window !== "undefined") {
  forgetPlaceOnNewVisit();
}

// The scroll position stored on the current history entry, or null when the
// reader hasn't been on it yet.
export function storedScrollY(): number | null {
  const top = readState()?.[SCROLL_KEY];
  return typeof top === "number" ? top : null;
}

// Whether the reader is coming back to this history entry (Back, Forward or a
// reload) rather than arriving at it. An entry only gets a stored position
// once the reader has been on it, so a link, a typed address or a fresh load
// lands on a new entry without one. A page uses this to show the entry as the
// reader left it instead of jumping to its #hash.
export function isReturnVisit(): boolean {
  return storedScrollY() !== null;
}

// The site's own keys in the entry's state, without the router's (they start
// with "__"). A replaceState that changes the address passes these, so what
// the site stored stays on the entry and the router still sees the new address.
export function ownHistoryState(): Record<string, unknown> {
  const own: Record<string, unknown> = {};
  const state = readState();
  if (state === null) {
    return own;
  }
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith("__")) {
      own[key] = value;
    }
  }
  return own;
}

// Stores the scroll position on the current history entry. Only on an entry
// the router wrote: one without its state makes the router reload the page
// on Back.
function rememberScroll() {
  const state = readState();
  if (state === null || !("__NA" in state)) {
    return;
  }
  const top = Math.round(window.scrollY);
  if (state[SCROLL_KEY] === top) {
    return;
  }
  try {
    window.history.replaceState({ ...state, [SCROLL_KEY]: top }, "");
  } catch {
    // Safari's limit on history writes. The next save tries again.
  }
}

// Does two jobs for the site's history entries. Renders nothing.
//
// A plain in-page link such as <a href="#ratings"> makes a new history entry
// without the state Next's router keeps on each entry, and the router ignores
// Back and Forward to an entry without it. Going Back to such an entry from
// another page then changed the address but left the other page on screen.
// This copies the router's state from the entry the link was clicked on to
// the new entry, so the router can show the page again. Only the router's own
// keys are copied (they start with "__"): a marker another part of the site
// keeps, such as the timeline's open dossier, stays with its own entry.
//
// It also keeps the reader's place. The browser puts it back on Back to an
// address without a hash, but on one with a hash (/wbe/#minds, /sources/#s02)
// it jumps to the anchor instead, far from where the reader was. And a reload
// puts it back before the page has opened what was open, so it lands short.
// Each entry stores its scroll position, and Back or Forward to an address
// with a hash, or a reload, restores it.
export function HashLinkHistory() {
  useEffect(() => {
    // The page and the router's state when an in-page link was last clicked.
    let saved: { path: string; routerState: Record<string, unknown> } | null = null;
    // Set while the browser follows an in-page link. Its popstate isn't Back
    // or Forward, even when the link's #hash is already in the address and the
    // entry, stored position and all, stays the same.
    let followingLink = false;
    let followTimer = 0;
    let saveTimer = 0;
    let restoreFrame = 0;

    function cancelSave() {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
    }

    function stopRestoring() {
      window.cancelAnimationFrame(restoreFrame);
      restoreFrame = 0;
    }

    // Keeps the page at top while it settles, until the reader moves it.
    function restoreScroll(top: number) {
      stopRestoring();
      const startedAt = performance.now();
      function hold() {
        if (Math.round(window.scrollY) !== top) {
          window.scrollTo({ top, behavior: "instant" });
        }
        if (performance.now() - startedAt < RESTORE_HOLD_MS) {
          restoreFrame = window.requestAnimationFrame(hold);
        } else {
          restoreFrame = 0;
        }
      }
      restoreFrame = window.requestAnimationFrame(hold);
    }

    function restoreIfReturning() {
      const top = storedScrollY();
      if (top !== null) {
        restoreScroll(top);
      }
    }

    // Capture phase, so this runs before the browser or the router follows
    // the link and the entry it leaves still holds the current position.
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const link = event.target.closest("a[href]");
      if (!link) {
        return;
      }
      stopRestoring();
      cancelSave();
      rememberScroll();
      if (!link.getAttribute("href")?.startsWith("#")) {
        return;
      }
      followingLink = true;
      window.clearTimeout(followTimer);
      followTimer = window.setTimeout(() => {
        followingLink = false;
      }, LINK_FOLLOW_MS);
      const state = readState();
      if (state === null) {
        return;
      }
      const routerState: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(state)) {
        if (key.startsWith("__")) {
          routerState[key] = value;
        }
      }
      saved = { path: window.location.pathname, routerState };
    }

    // Gives the current entry the router's state when it has none, as after
    // an in-page link or a hash typed in the address bar.
    function giveRouterState() {
      const current = readState();
      const hasRouterState = current !== null && "__NA" in current;
      if (!hasRouterState) {
        if (saved && "__NA" in saved.routerState && saved.path === window.location.pathname) {
          window.history.replaceState({ ...(current ?? {}), ...saved.routerState }, "", window.location.href);
        } else {
          // A hash typed in the address bar or set by a script, with no link
          // to copy from. The router's replaceState writes its own state for
          // the entry when it's given the address without it.
          window.history.replaceState(current ?? {}, "", window.location.href);
        }
      }
      saved = null;
    }

    function onHashChange() {
      giveRouterState();
    }

    // Back or Forward, or the browser following a #hash. Without a hash the
    // browser puts the position back itself, and its copy is exact, while the
    // stored one can lag a scroll still waiting to be saved. With one it
    // jumps to the anchor, so the stored position wins.
    //
    // Following an in-page link isn't a return, so nothing is restored: a
    // link to the hash the address already has keeps the entry and its
    // stored position, but the reader asked for the anchor. Nor is a hash
    // typed in the address bar, whose new entry has no stored position yet.
    // When that hash is the one already shown, no hashchange follows, so the
    // entry gets the router's state here.
    function onPopState() {
      cancelSave();
      if (followingLink) {
        followingLink = false;
        return;
      }
      giveRouterState();
      if (window.location.hash !== "") {
        restoreIfReturning();
      }
    }

    function onScroll() {
      cancelSave();
      const address = window.location.href;
      saveTimer = window.setTimeout(() => {
        saveTimer = 0;
        // The page moved on while waiting, so the position isn't this entry's.
        if (window.location.href === address) {
          rememberScroll();
        }
      }, SAVE_DELAY_MS);
    }

    // A wheel, a touch, a key or a press means the reader is moving on their
    // own, so a restore still holding the page lets go. A key or a press can
    // also start Back (Alt+Left, the mouse's back button), so a position still
    // waiting to be saved is saved now.
    function onReaderInput() {
      stopRestoring();
      if (saveTimer !== 0) {
        cancelSave();
        rememberScroll();
      }
    }

    // A sideways wheel doesn't count: a two-finger swipe Back on a trackpad
    // ends with a few of them after the page has already changed.
    function onWheel(event: WheelEvent) {
      if (event.deltaY !== 0) {
        stopRestoring();
      }
    }

    // A reload or leaving the site. The browser keeps state written here
    // for the entry, so the reload can find the position.
    function onLeavePage() {
      rememberScroll();
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onReaderInput, { passive: true });
    window.addEventListener("keydown", onReaderInput);
    window.addEventListener("pointerdown", onReaderInput);
    window.addEventListener("beforeunload", onLeavePage);

    // A reload, or Back from another site, also comes back to an entry. The
    // page's own effects have already run, so what it reopens is open.
    const navigation = performance.getEntriesByType("navigation")[0];
    if (navigation instanceof PerformanceNavigationTiming && navigation.type !== "navigate") {
      restoreIfReturning();
    }

    return () => {
      cancelSave();
      stopRestoring();
      window.clearTimeout(followTimer);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onReaderInput);
      window.removeEventListener("keydown", onReaderInput);
      window.removeEventListener("pointerdown", onReaderInput);
      window.removeEventListener("beforeunload", onLeavePage);
    };
  }, []);

  return null;
}
