"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavItem } from "@/lib/site";

import { backToTop } from "./backToTop";
import { isActive } from "./isActive";

// The footer's links, marked with aria-current on the page you're on. On
// desktop the header has no Methodology or Contact link, so this is the only
// place those pages show as current. Only this list needs the path, so the
// rest of the footer stays a server component.
export function FooterLinks({ items }: { items: NavItem[] }) {
  // usePathname() returns the path without the base path.
  const pathname = usePathname() ?? "/";
  return (
    <>
      {items.map((item) => {
        // A link to the page you're already on goes back to its top, the same
        // as the header's. Next still updates the address (dropping a
        // #section), but its own scroll is off so it doesn't fight backToTop.
        const isThisPage = pathname === item.href;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              scroll={isThisPage ? false : undefined}
              onClick={isThisPage ? backToTop : undefined}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </>
  );
}
