"use client";

import { useEffect } from "react";

// The part of the Navigation API's navigate event this reads. TypeScript's
// DOM types don't have that API yet.
interface NavigateEventLike extends Event {
  navigationType: string;
}

// How long smooth scrolling stays off after popstate. Chrome puts the page
// back in a task of its own soon after popstate, not in the same one: turned
// back on straight away, Forward to the top of a page still slid there.
const HOLD_AFTER_POPSTATE_MS = 300;

// How long smooth scrolling stays off when a Back or Forward never gets as far
// as its popstate, as when it leaves the site.
const FALLBACK_MS = 1000;

// Makes Back and Forward put the reader back at once. Renders nothing.
//
// The smooth scrolling in globals.css is for in-page links, but Chrome used it
// for Back and Forward too: the page slid for most of a second from the top to
// where the reader had been, and a Forward pressed in that time left the next
// page at the old one's place. Next turns smooth scrolling off only for its
// own jump to the top of a new page. This turns it off when a Back or Forward
// starts and back on once the browser has put the page back, which it does
// soon after popstate.
//
// Following an in-page link fires popstate too, and that should still scroll
// smoothly, so this needs the Navigation API to tell the two apart. Browsers
// without it keep the smooth scroll.
export function InstantHistoryScroll() {
  useEffect(() => {
    const navigation = (window as { navigation?: EventTarget }).navigation;
    if (!navigation) {
      return;
    }
    const html = document.documentElement;
    let timer = 0;

    function smoothAgain() {
      window.clearTimeout(timer);
      timer = 0;
      html.style.removeProperty("scroll-behavior");
    }

    function onNavigate(event: Event) {
      if ((event as NavigateEventLike).navigationType !== "traverse") {
        return;
      }
      html.style.scrollBehavior = "auto";
      window.clearTimeout(timer);
      timer = window.setTimeout(smoothAgain, FALLBACK_MS);
    }

    function onPopState() {
      if (timer === 0) {
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(smoothAgain, HOLD_AFTER_POPSTATE_MS);
    }

    navigation.addEventListener("navigate", onNavigate);
    window.addEventListener("popstate", onPopState);
    return () => {
      navigation.removeEventListener("navigate", onNavigate);
      window.removeEventListener("popstate", onPopState);
      smoothAgain();
    };
  }, []);

  return null;
}
