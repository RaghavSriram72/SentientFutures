"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FocusEvent } from "react";

import { startsMenuOnlyEnd, type NavItem } from "@/lib/site";

import { backToTop } from "./backToTop";
import { isActive } from "./isActive";
import styles from "./SiteHeader.module.css";

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The header stays mounted across page changes, so close the menu whenever
  // the path changes: the logo link, Back and Forward all navigate without
  // going through the menu's own links.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // While the menu is open, Esc closes it and puts focus back on the button,
  // and a tap or click anywhere outside the nav closes it. A tap on the page
  // lands on the scrim, which is inside the nav, so it closes the menu itself.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      const nav = navRef.current;
      if (nav && !nav.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // Tabbing past the last item closes the menu. Focus moving to nothing (some
  // browsers do that on click) is left to the pointer handler above.
  function onBlur(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) {
      setOpen(false);
    }
  }

  return (
    <nav ref={navRef} className={styles.nav} aria-label="Main" onBlur={onBlur}>
      {/* A clear layer over the page while the menu is open, so the tap that
          closes the menu doesn't also follow the link under it. It closes the
          menu on the click, not on pointerdown: gone any sooner, it would let
          that click through. A swipe that starts on it never clicks, so it
          closes the menu when the swipe takes over. */}
      {open && (
        <div
          className={styles.scrim}
          aria-hidden="true"
          onClick={() => setOpen(false)}
          onPointerCancel={() => setOpen(false)}
        />
      )}
      <button
        ref={buttonRef}
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls="primary-nav"
        onClick={() => setOpen(!open)}
      >
        <span className={styles.menuIcon} aria-hidden="true" />
        Menu
      </button>
      <ul id="primary-nav" className={`${styles.navList} ${open ? styles.navOpen : ""}`}>
        {items.map((item, index) => {
          // A link to the page you're already on goes back to its top, the
          // same as the footer's. Next's own scroll is off so it doesn't
          // fight backToTop.
          const isThisPage = pathname === item.href;
          let className: string | undefined = undefined;
          if (item.menuOnly) {
            className = startsMenuOnlyEnd(items, index) ? `${styles.menuOnly} ${styles.menuEndStart}` : styles.menuOnly;
          }
          return (
            <li key={item.href} className={className}>
              <Link
                href={item.href}
                className={styles.navLink}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                scroll={isThisPage ? false : undefined}
                onClick={(event) => {
                  setOpen(false);
                  if (isThisPage) {
                    backToTop(event);
                  }
                }}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
