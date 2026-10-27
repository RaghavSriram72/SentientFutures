"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FocusEvent } from "react";

import type { NavItem } from "@/lib/site";

import styles from "./SiteHeader.module.css";

function isActive(pathname: string, href: string): boolean {
  // usePathname() returns the path without the base path.
  return pathname === href || pathname.startsWith(href);
}

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
  // and a tap or click anywhere outside the nav closes it.
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
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={styles.navLink}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
