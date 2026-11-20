"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

import { withBase } from "@/lib/paths";

// Starts each new page at its top. Renders nothing.
//
// Next only scrolls a new page to the top when the page's top isn't already
// on screen. Going from far down a long page to a short one (Menu > Blog from
// /wbe/ or from a post), the browser has already pulled the scroll back to the
// short page's bottom, where its top still shows, so Next left it there and
// the draft banner and the top of the header were scrolled off.
//
// Back and Forward are left alone: the browser and HashLinkHistory put the
// reader back where they were. So is an address with a #hash, which jumps to
// its anchor. A link to the page you're on doesn't change the path, so it's
// left to backToTop.
export function NewPageAtTop() {
  // usePathname() returns the path without the base path.
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  // The address Back or Forward went to, until the page it shows is drawn.
  // Back to a #hash on the same page changes no path, so this can be left
  // over; comparing it with the new address keeps a later link from counting.
  const historyAddress = useRef<string | null>(null);

  useEffect(() => {
    function onPopState() {
      historyAddress.current = window.location.href;
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  // Next scrolls in a layout effect around the page, inside SiteChrome. That
  // comes before this in the layout, so React runs it first and this has the
  // last word. And it's before the new page is painted, so the page never
  // shows part way down first.
  useLayoutEffect(() => {
    if (pathname === lastPath.current) {
      return;
    }
    lastPath.current = pathname;
    const isHistory = historyAddress.current === window.location.href;
    // A page drawn late, once a second Back or Forward has already changed
    // the address, isn't the page the address shows. The mark is kept for
    // that one, which is drawn next and is a return too.
    if (window.location.pathname === withBase(pathname)) {
      historyAddress.current = null;
    }
    if (isHistory || window.location.hash !== "") {
      return;
    }
    // Instant: the smooth scrolling in globals.css is for in-page links.
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}
