import type { MouseEvent } from "react";

// How many frames to wait for Next to put the new address in place before
// scrolling anyway. It normally takes one or two.
const MAX_WAIT_FRAMES = 30;

// For a header, menu or footer link to the page you're already on. Without
// this, clicking one did nothing you could see. It scrolls to the top (at once
// if the reader asked for reduced motion) and moves focus to the page's
// heading, so Tab and a screen reader carry on from the top instead of the
// link. The link passes scroll={false} so Next's own scroll doesn't fight it.
export function backToTop(event: MouseEvent<HTMLAnchorElement>) {
  // Ctrl or Cmd click opens the page in a new tab: leave this one alone.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  // When the link also changes the address (dropping ?filters or a
  // #section), Next adds a history entry, and the browser saves where this
  // entry was scrolled to at that moment. Scrolling first would save the
  // wrong place, and Back would land short, or at the top with reduced
  // motion. So wait for the new address before scrolling.
  const changesAddress = window.location.search !== "" || window.location.hash !== "";
  if (!changesAddress) {
    scrollToTopAndFocusHeading();
    return;
  }
  const startAddress = window.location.href;
  let framesLeft = MAX_WAIT_FRAMES;
  function waitForNewAddress() {
    framesLeft -= 1;
    if (window.location.href !== startAddress || framesLeft === 0) {
      scrollToTopAndFocusHeading();
      return;
    }
    window.requestAnimationFrame(waitForNewAddress);
  }
  window.requestAnimationFrame(waitForNewAddress);
}

function scrollToTopAndFocusHeading() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "instant" : "smooth" });

  const heading = document.querySelector<HTMLElement>("main h1");
  if (heading) {
    // -1 lets a script focus the heading without adding it to the Tab order.
    // preventScroll keeps the focus from cutting the smooth scroll short.
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
