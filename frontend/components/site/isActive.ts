// Whether a header, menu or footer link points at the page you're on, or at
// the section it belongs to (a blog post counts as the Blog). Those links get
// aria-current. Pass the path from usePathname(), which has no base path.
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href);
}
