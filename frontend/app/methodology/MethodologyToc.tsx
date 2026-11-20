"use client";

import { useEffect, useRef } from "react";

import { useActiveSection } from "@/components/common/useActiveSection";

import styles from "./page.module.css";

// On a short desktop window the list is cut off at the bottom and scrolls on
// its own (see .toc in page.module.css). When the current entry is out of the
// list's view, or sits under the fade at its top or bottom edge, this scrolls
// the list just far enough to show it. Only the list moves, never the page.
// Where the list fits, this does nothing.
function keepCurrentInView(nav: HTMLElement) {
  if (nav.scrollHeight <= nav.clientHeight) {
    return;
  }
  // While someone tabs through the list, keep the entry they are on in view,
  // not the section being read. Tabbing into the list can scroll the page a
  // little, which changes the current section. Following that section would
  // pull the list away from the keyboard focus and hide it. :focus-visible
  // only matches focus that came from the keyboard, so after a mouse click on
  // an entry the list goes on following the section being read.
  const link = nav.querySelector("a:focus-visible") ?? nav.querySelector("[aria-current]");
  // Back above the first section nothing is marked, so the list goes back to
  // its start, title included.
  if (!link) {
    nav.scrollTop = 0;
    return;
  }
  // The room to leave above and below the entry comes from the list's
  // scroll-padding in page.module.css. Each room includes the fade at that
  // edge, so the entry never sits under a fade. The browser uses the same room
  // when you tab to an entry, so both ways of scrolling the list agree. The
  // browser hands the values back in px; "|| 0" covers a missing value.
  const navStyle = window.getComputedStyle(nav);
  const roomAbove = parseFloat(navStyle.scrollPaddingTop) || 0;
  const roomBelow = parseFloat(navStyle.scrollPaddingBottom) || 0;
  const navBox = nav.getBoundingClientRect();
  const linkBox = link.getBoundingClientRect();
  if (linkBox.top < navBox.top + roomAbove) {
    nav.scrollTop -= navBox.top + roomAbove - linkBox.top;
  } else if (linkBox.bottom > navBox.bottom - roomBelow) {
    nav.scrollTop += linkBox.bottom - (navBox.bottom - roomBelow);
  }
}

// While a cut-off list has more entries below what it shows, its bottom edge
// fades out (data-more-below in page.module.css), so a list that happens to
// end cleanly after an entry doesn't look complete. Once the list has
// scrolled down, its top edge fades out too (data-more-above), so the title
// or an entry cut off at the top edge fades away instead of being sliced
// through its letters. This turns the two fades on or off. React doesn't
// render these attributes or the style property, so a re-render leaves them
// as set here.
function updateFade(nav: HTMLElement) {
  // The list keeps a little padding under the last entry as room for its
  // focus ring (see .toc in page.module.css). That room isn't another entry,
  // so it doesn't count as "more below". scrollTop can be a fraction of a px
  // on a zoomed page, so 1px of slack keeps the end of the list from counting
  // either. The browser hands the padding back in px; "|| 0" covers a missing
  // value.
  const paddingBottom = parseFloat(window.getComputedStyle(nav).paddingBottom) || 0;
  // The last entry's own bottom padding (part of its click area, under its
  // label) isn't another entry either. Without this, a list whose last label
  // fits but whose padding doesn't would fade out a fully shown last entry.
  const lastLink = nav.querySelector("li:last-child a");
  const lastLinkPadding = lastLink
    ? parseFloat(window.getComputedStyle(lastLink).paddingBottom) || 0
    : 0;
  const moreBelow =
    nav.scrollTop + nav.clientHeight < nav.scrollHeight - paddingBottom - lastLinkPadding - 1;
  nav.toggleAttribute("data-more-below", moreBelow);
  // The list has no padding above the title, so any scrolling at all cuts
  // something off at the top edge.
  const moreAbove = nav.scrollTop > 0;
  nav.toggleAttribute("data-more-above", moreAbove);
  // How far the list has scrolled down. The CSS grows the top fade with it
  // (see .toc[data-more-above]), so the fade doesn't appear at full height
  // the moment the list moves, and a list that has moved only a px or two
  // keeps its title sharp.
  nav.style.setProperty("--toc-scrolled", `${nav.scrollTop}px`);
  // A scrollbar that takes up room (Windows, or macOS with a mouse) is the
  // difference between the box's full width and the width left for the
  // entries. Overlay scrollbars take none, so this is 0 for them. The CSS
  // keeps that strip out of the fade, so the scrollbar stays whole.
  const scrollbarWidth = nav.offsetWidth - nav.clientWidth;
  nav.style.setProperty("--toc-scrollbar", `${scrollbarWidth}px`);
}

// The page's "On this page" list. While you scroll, the section you're
// reading is marked with aria-current, so the list shows where you are.
export function MethodologyToc({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const ids: string[] = [];
  for (const section of sections) {
    ids.push(section.id);
  }
  const activeId = useActiveSection(ids);
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // When the reader moves to another section, bring its entry into view (or,
  // while someone is tabbing through the list, keep the focused entry in
  // view). Moving the list fires its scroll event, which updates the fades
  // (see the next effect).
  useEffect(() => {
    const nav = navRef.current;
    if (nav) {
      keepCurrentInView(nav);
    }
  }, [activeId]);

  // The list's size changes without the section changing: the window is
  // resized or zoomed, devtools or a bookmarks bar opens, or the web fonts
  // load and the labels wrap differently. A ResizeObserver tells us about all
  // of these. It watches the list box (nav), which follows the window height,
  // and the entries inside it (ol), which change when the labels rewrap. Each
  // time, the current entry is brought back into view and the fades are
  // updated. The observer also reports once as soon as it starts, which sets
  // the fades for the first time.
  useEffect(() => {
    const nav = navRef.current;
    const list = listRef.current;
    if (!nav || !list) {
      return;
    }

    const onResize = () => {
      keepCurrentInView(nav);
      updateFade(nav);
    };
    // Scrolling the list (by hand, by tabbing or from keepCurrentInView)
    // shows or hides the fades as the start and end of the list come and go.
    const onScroll = () => {
      updateFade(nav);
    };

    const observer = new ResizeObserver(onResize);
    observer.observe(nav);
    observer.observe(list);
    nav.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      nav.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <nav ref={navRef} className={styles.toc} aria-label="On this page">
      <p className={`eyebrow ${styles.tocTitle}`}>On this page</p>
      <ol ref={listRef} className={styles.tocList}>
        {sections.map((section, index) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={styles.tocLink}
              aria-current={section.id === activeId ? "location" : undefined}
            >
              <span className={styles.tocNumber}>{String(index + 1).padStart(2, "0")}</span>
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
