"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import type { ReactNode } from "react";

// How much of the site's own frame a page gets:
//   full     -> header and footer
//   admin    -> header and the footer without the "Team login" link
//   none     -> neither; the page draws its own frame (the full-screen timeline
//               and its specimen in the style guide)
type ChromeMode = "full" | "admin" | "none";

// `segments` name the page's folders under app/ (["admin", "milestones"]),
// not the address in the browser. That matters for the "not found" page: it's
// built once, with the full frame, and then served at any unknown address,
// /admin/nope/ included. Its segments are the same wherever it's served, so
// the browser draws the same frame as the built HTML.
function chromeFor(segments: string[]): ChromeMode {
  const route = segments.join("/");
  // Only the timeline itself: a mistyped /timeline/... address still gets the
  // full frame around its "not found" page.
  if (route === "timeline") {
    return "none";
  }
  if (route === "styleguide/track") {
    return "none";
  }
  if (segments[0] === "admin") {
    return "admin";
  }
  return "full";
}

interface SiteChromeProps {
  header: ReactNode;
  footer: ReactNode;
  adminFooter: ReactNode;
  children: ReactNode;
}

// Picks the frame for the current page. The header and footers are rendered on
// the server and passed in, so this only decides which ones to show. A part
// that isn't shown isn't in the page at all, so it never takes keyboard focus.
// The static export renders each page with its own route, so the HTML already
// matches what the browser shows.
export function SiteChrome({ header, footer, adminFooter, children }: SiteChromeProps) {
  // The active route below the root layout, e.g. ["admin", "milestones", "edit"].
  const segments = useSelectedLayoutSegments();
  const mode = chromeFor(segments);

  if (mode === "none") {
    return <main id="main">{children}</main>;
  }

  return (
    <>
      {header}
      <main id="main">{children}</main>
      {mode === "admin" ? adminFooter : footer}
    </>
  );
}
