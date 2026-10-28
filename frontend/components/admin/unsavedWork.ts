// Asking before unsaved work is thrown away.
//
// A form with unsaved changes calls useUnsavedWork(true). While any form does,
// closing or reloading the tab asks first (the browser's own beforeunload
// dialog), and clicking any link on an admin page asks before moving on
// (useLeaveGuard, which the admin shell turns on). Next.js moves between pages
// without unloading the page, so beforeunload alone wouldn't catch links.
import { useEffect, type MouseEvent } from "react";

const LEAVE_QUESTION = "You have changes you haven't saved. Leave this page and lose them?";

// One entry per mounted form that has unsaved changes.
const formsWithUnsavedWork = new Set<symbol>();

export function hasUnsavedWork(): boolean {
  return formsWithUnsavedWork.size > 0;
}

export function useUnsavedWork(unsaved: boolean): void {
  useEffect(() => {
    if (!unsaved) {
      return;
    }
    const entry = Symbol("unsaved work");
    formsWithUnsavedWork.add(entry);

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Older browsers only show the dialog when returnValue is set.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      formsWithUnsavedWork.delete(entry);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [unsaved]);
}

// Clicks already asked about, so a link with its own confirmLeaving doesn't
// ask a second time after the page-wide guard has.
const askedClicks = new WeakSet<Event>();

function opensElsewhere(event: globalThis.MouseEvent, link: HTMLAnchorElement): boolean {
  // A new tab or window, or a download, keeps this page as it is.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return true;
  }
  return link.target === "_blank" || link.hasAttribute("download");
}

// Same page, different #anchor: nothing is lost.
function staysOnThisPage(link: HTMLAnchorElement): boolean {
  const target = new URL(link.href, window.location.href);
  const here = new URL(window.location.href);
  return target.hash !== "" && target.origin === here.origin && target.pathname === here.pathname && target.search === here.search;
}

// Asks before a click on `link` drops unsaved work. Returns false when the
// person chose to stay.
function mayLeave(event: globalThis.MouseEvent, link: HTMLAnchorElement): boolean {
  if (askedClicks.has(event) || !hasUnsavedWork() || opensElsewhere(event, link) || staysOnThisPage(link)) {
    return true;
  }
  askedClicks.add(event);
  return window.confirm(LEAVE_QUESTION);
}

// For a link's onClick. The page-wide guard below already covers every link
// on an admin page; this stays for links that may render outside it.
export function confirmLeaving(event: MouseEvent<HTMLAnchorElement>): void {
  if (!mayLeave(event.nativeEvent, event.currentTarget)) {
    event.preventDefault();
  }
}

// Asks before any link on the page (the site header included) drops unsaved
// work. It listens on the document in the capture phase, so it runs before
// next/link's own click handler, which skips navigating once the click is
// cancelled.
export function useLeaveGuard(): void {
  useEffect(() => {
    function onClick(event: globalThis.MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) {
        return;
      }
      if (!mayLeave(event, link)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
