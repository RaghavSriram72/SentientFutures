"use client";

import { useEffect } from "react";

// Opens any closed <details> around the element a link points to, so links
// such as "Full scorecard" land on visible content even when it sits inside
// the collapsed "Full assessment". Renders nothing.
export function OpenDetailsOnHash() {
  useEffect(() => {
    // Returns true when it had to open something.
    function openAround(id: string): boolean {
      const target = document.getElementById(id);
      let opened = false;
      let parent = target ? target.parentElement : null;
      while (parent) {
        if (parent instanceof HTMLDetailsElement && !parent.open) {
          parent.open = true;
          opened = true;
        }
        parent = parent.parentElement;
      }
      return opened;
    }

    // In-page links: open first, then let the browser scroll as usual.
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const link = event.target.closest("a[href^='#']");
      if (!link) {
        return;
      }
      const id = decodeURIComponent(link.getAttribute("href")?.slice(1) ?? "");
      if (id) {
        openAround(id);
      }
    }

    // Arriving with a hash, or changing it by hand.
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

    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHash);
    if (window.location.hash) {
      onHash();
    }
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  return null;
}
