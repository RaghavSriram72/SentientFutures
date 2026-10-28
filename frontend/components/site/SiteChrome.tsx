"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// How much of the site's own frame a page gets:
//   full     -> header and footer
//   admin    -> header and the footer without the "Team login" link
//   none     -> neither; the page draws its own frame (the full-screen timeline
//               and its specimen in the style guide)
type ChromeMode = "full" | "admin" | "none";

function chromeFor(pathname: string): ChromeMode {
  // Only the timeline itself: a mistyped /timeline/... address still gets the
  // full frame around its "not found" page.
  if (pathname === "/timeline" || pathname === "/timeline/") {
    return "none";
  }
  if (pathname === "/styleguide/track" || pathname === "/styleguide/track/") {
    return "none";
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
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
// The static export renders each page with its own path, so the HTML already
// matches what the browser shows.
export function SiteChrome({ header, footer, adminFooter, children }: SiteChromeProps) {
  // usePathname() returns the path without the base path.
  const pathname = usePathname() ?? "/";
  const mode = chromeFor(pathname);

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
