"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { backToTop } from "./backToTop";

interface BrandLinkProps {
  className: string;
  label: string;
  children: ReactNode;
}

// The logo's link home. On the home page it goes back to the top, the same as
// the header's other links to the page you're on. Only this link needs the
// path, so the rest of the header stays a server component.
export function BrandLink({ className, label, children }: BrandLinkProps) {
  // usePathname() returns the path without the base path.
  const pathname = usePathname() ?? "/";
  const isThisPage = pathname === "/";
  return (
    <Link
      href="/"
      className={className}
      aria-label={label}
      scroll={isThisPage ? false : undefined}
      onClick={isThisPage ? backToTop : undefined}
    >
      {children}
    </Link>
  );
}
