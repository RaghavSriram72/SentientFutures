"use client";

import { useEffect } from "react";

import { isReturnVisit, LINK_FOLLOW_MS, OPEN_DETAILS_KEY, storedScrollY } from "./HashLinkHistory";

// How much of the window's top the sticky header covers, in px.
function headerHeight(): number {
  const height = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height"));
  return Number.isNaN(height) ? 0 : height;
}

// Opens any closed <details> around the element a link points to, so links
// such as "Full scorecard" land on visible content even when it sits inside
// the collapsed "Full assessment". A link to a <details> itself, such as the
// methodology's "disagreement rule", opens that one too.
// It also remembers which ones are open on the current history entry, so Back,
// Forward or a reload opens them again. Otherwise they came back closed and
// the restored scroll position no longer pointed at the row the reader left.
// Renders nothing.
export function OpenDetailsOnHash() {
  useEffect(() => {
    // The page this runs on. Back to another page changes the address before
    // this page goes away, and its folds aren't this page's.
    const pagePath = window.location.pathname;

    // Back to this entry (or a reload): open what was open before.
    const remembered: unknown = window.history.state?.[OPEN_DETAILS_KEY];
    if (Array.isArray(remembered)) {
      const all = document.querySelectorAll("details");
      for (const index of remembered) {
        const details = typeof index === "number" ? all[index] : undefined;
        if (details) {
          details.open = true;
        }
      }
    }

    // Stores the open ones on the current history entry, by their position on
    // the page. Only on an entry the router wrote, so its state is kept.
    function rememberOpen() {
      const state: unknown = window.history.state;
      if (state === null || typeof state !== "object" || !("__NA" in state)) {
        return;
      }
      const open: number[] = [];
      document.querySelectorAll("details").forEach((details, index) => {
        if (details.open) {
          open.push(index);
        }
      });
      const stored: unknown = (state as Record<string, unknown>)[OPEN_DETAILS_KEY];
      if (Array.isArray(stored) && stored.join(" ") === open.join(" ")) {
        return;
      }
      try {
        window.history.replaceState({ ...state, [OPEN_DETAILS_KEY]: open }, "");
      } catch {
        // Safari's limit on history writes. The next change tries again.
      }
    }

    // Printing opens and closes them all at once, so the writes wait and run once.
    let rememberTimer = 0;
    function rememberSoon() {
      window.clearTimeout(rememberTimer);
      rememberTimer = window.setTimeout(rememberOpen, 0);
    }

    // Opening or closing one, by the reader or by a link, so the entry is up
    // to date however the reader leaves it, Back included.
    function onToggle(event: Event) {
      if (event.target instanceof HTMLDetailsElement) {
        rememberSoon();
      }
    }

    // Capture phase, so this runs before the link's own handler moves on, and
    // before an in-page link opens anything around its target: the entry the
    // reader leaves keeps the ones that were open on it.
    function onLeavingClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest("a[href]")) {
        rememberOpen();
      }
    }

    // The folds the reader opened by hand and hasn't closed since. Back or
    // Forward leaves these open where it can (see onPopState).
    const openedByReader = new Set<HTMLDetailsElement>();

    // A click on a fold's summary opens or closes it, unless the page
    // cancelled it or it landed on a link or button inside the summary.
    // Bubble phase, so it runs after the page's own handlers.
    function onSummaryClick(event: MouseEvent) {
      if (event.defaultPrevented || !(event.target instanceof Element)) {
        return;
      }
      const summary = event.target.closest("summary");
      const details = summary?.parentElement;
      if (!summary || !(details instanceof HTMLDetailsElement)) {
        return;
      }
      const control = event.target.closest("a[href], button");
      if (control && summary.contains(control)) {
        return;
      }
      // Still as it was before the click.
      if (details.open) {
        openedByReader.delete(details);
      } else {
        openedByReader.add(details);
      }
    }

    // Returns true when it had to open something.
    function openAround(id: string): boolean {
      const target = document.getElementById(id);
      let opened = false;
      let node: HTMLElement | null = target;
      while (node) {
        if (node instanceof HTMLDetailsElement && !node.open) {
          node.open = true;
          opened = true;
        }
        node = node.parentElement;
      }
      return opened;
    }

    // The hash an in-page link on this page just asked for, until the change
    // it makes arrives.
    let clickedHash: string | null = null;
    // Set while the browser follows an in-page link. Its popstate isn't Back
    // or Forward, even when the link's hash is the one the entry already has.
    let followingLink = false;
    let followTimer = 0;

    // In-page links: open first, then let the browser scroll as usual.
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const link = event.target.closest("a[href^='#']");
      if (!link) {
        return;
      }
      followingLink = true;
      window.clearTimeout(followTimer);
      followTimer = window.setTimeout(() => {
        followingLink = false;
      }, LINK_FOLLOW_MS);
      const id = decodeURIComponent(link.getAttribute("href")?.slice(1) ?? "");
      if (id) {
        clickedHash = id;
        openAround(id);
      }
    }

    // Arriving with a hash.
    function onHash() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) {
        return;
      }
      // The browser scrolled before the content was visible, so scroll again.
      if (openAround(id)) {
        document.getElementById(id)?.scrollIntoView();
      }
    }

    // A changed hash. Back or Forward to an entry the reader has been on puts
    // their place back (see HashLinkHistory), so the hash is left alone. A
    // hash typed in the address bar can lose to a smooth scroll still running
    // from an earlier link, which carries on to the old section, so it gets
    // scrolled to here as well.
    function onHashChange() {
      // A new entry stores the open ones too, even when none opens or closes
      // on it, so Back or Forward to it can put them back. Waiting lets
      // HashLinkHistory give the entry the router's state first.
      rememberSoon();
      const id = decodeURIComponent(window.location.hash.slice(1));
      const fromLink = id === clickedHash;
      clickedHash = null;
      if (!id || isReturnVisit()) {
        return;
      }
      const opened = openAround(id);
      if (opened || !fromLink) {
        document.getElementById(id)?.scrollIntoView();
      }
    }

    // Back or Forward to another entry on this page. The position put back
    // (by the browser after this event, or by HashLinkHistory for an entry
    // with a hash) only fits the page as the reader left the entry: a fold
    // above it opened or closed since then moves everything below. So the
    // folds go back to how the entry had them. One exception: a fold the
    // reader opened by hand stays open when it starts below the top of the
    // view. It moves nothing in view there, and closing it would undo what
    // they opened, like the full assessment.
    function onPopState() {
      if (followingLink) {
        followingLink = false;
        return;
      }
      const top = storedScrollY();
      const stored: unknown = window.history.state?.[OPEN_DETAILS_KEY];
      if (window.location.pathname !== pagePath || top === null || !Array.isArray(stored)) {
        return;
      }
      const viewTop = top + headerHeight();
      // In page order, so each is measured with the ones above it already set.
      document.querySelectorAll("details").forEach((details, index) => {
        const detailsTop = details.getBoundingClientRect().top + window.scrollY;
        const readerKeepsIt = details.open && openedByReader.has(details) && detailsTop >= viewTop;
        if (!readerKeepsIt) {
          details.open = stored.includes(index);
        }
        if (!details.open) {
          openedByReader.delete(details);
        }
      });
    }

    document.addEventListener("click", onClick);
    document.addEventListener("click", onSummaryClick);
    document.addEventListener("click", onLeavingClick, true);
    document.addEventListener("toggle", onToggle, true);
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState);
    // Coming back to this entry, the details opened above are the ones the
    // reader left open, and the hash would undo that.
    if (window.location.hash && !isReturnVisit()) {
      onHash();
    }
    return () => {
      window.clearTimeout(rememberTimer);
      window.clearTimeout(followTimer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("click", onSummaryClick);
      document.removeEventListener("click", onLeavingClick, true);
      document.removeEventListener("toggle", onToggle, true);
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  return null;
}
