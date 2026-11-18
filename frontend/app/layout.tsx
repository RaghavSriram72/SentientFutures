// Keep this import first, above every component. The built CSS follows the
// import order, and the global styles have to come before any page's or
// component's own styles, so that their classes win over a global one of
// the same weight (a home page chip over .chip, say). With this import below
// the components, the production build put the home page's styles first and
// the globals overrode them. The dev server doesn't show it.
import "./globals.css";

import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google";

import { HashLinkHistory } from "@/components/common/HashLinkHistory";
import { PrintOpenDetails } from "@/components/common/PrintOpenDetails";
import { TermDock } from "@/components/glossary/TermDock";
import { InstantHistoryScroll } from "@/components/site/InstantHistoryScroll";
import { NewPageAtTop } from "@/components/site/NewPageAtTop";
import { SiteChrome } from "@/components/site/SiteChrome";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { IS_DRAFT, SITE_NAME } from "@/lib/site";

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "We look at whether whole brain emulation, brain-computer interfaces or neuromorphic AI could help with AI alignment or keep humans in the loop, what would have to happen first, and what new problems each one would bring.",
  // Draft prototype: keep it out of search engines until launch.
  robots: IS_DRAFT ? { index: false, follow: false } : undefined,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-scroll-behavior tells Next that the smooth scrolling in globals.css is
    // on purpose, so it turns it off while it jumps to the top of a new page.
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${instrumentSans.variable} ${plexMono.variable}`}
      data-scroll-behavior="smooth"
    >
      <body>
        {/* data-site-chrome: the admin's sign-in card makes it inert with the
            header and footer, since it points into the page the card covers. */}
        <a className="skip-link" href="#main" data-site-chrome="skip-link">
          Skip to content
        </a>
        <SiteChrome header={<SiteHeader />} footer={<SiteFooter />} adminFooter={<SiteFooter showTeamLogin={false} />}>
          {children}
        </SiteChrome>
        <PrintOpenDetails />
        <HashLinkHistory />
        {/* After SiteChrome, so it runs after Next's own scroll. */}
        <NewPageAtTop />
        <InstantHistoryScroll />
        <TermDock />
      </body>
    </html>
  );
}
