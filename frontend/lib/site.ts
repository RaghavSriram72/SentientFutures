// Site-wide settings. The name is a working title from the team's domain
// shortlist; change it here and it changes everywhere.
export const SITE_NAME = "Minds in the Loop";
export const SITE_TAGLINE = "A Sentient Futures project";
export const CONTACT_EMAIL = "hello@example.org"; // placeholder until the team picks one

// Until launch the site is a draft: noindex everywhere and a banner on every page.
export const IS_DRAFT = true;

export interface NavItem {
  href: string;
  label: string;
  // Only in the phone menu. The desktop header has no room for it, and the
  // footer links to it on every page.
  menuOnly?: boolean;
}

// The header. On phones all of it folds into the Menu button.
export const PRIMARY_NAV: NavItem[] = [
  { href: "/timeline/", label: "Timeline" },
  { href: "/wbe/", label: "Brain emulation" },
  { href: "/bci/", label: "Brain interfaces" },
  { href: "/neuromorphic/", label: "Neuromorphic AI" },
  // After the three technologies it compares. Not in the desktop header:
  // the seven links without menuOnly already fill it at 1024px.
  { href: "/compare/", label: "Compare", menuOnly: true },
  { href: "/sources/", label: "Source database" },
  { href: "/blog/", label: "Blog" },
  { href: "/about/", label: "About" },
  { href: "/methodology/", label: "Methodology", menuOnly: true },
  { href: "/contact/", label: "Contact", menuOnly: true },
];

// The footer's one line of links. The evidence register is only here: the
// header has no room for it, and rating cards, technology pages and source
// rows link to it.
export const SECONDARY_NAV: NavItem[] = [
  { href: "/about/", label: "About" },
  { href: "/methodology/", label: "Methodology" },
  { href: "/compare/", label: "Compare" },
  { href: "/evidence/", label: "Evidence register" },
  { href: "/contact/", label: "Contact" },
];

// The menus draw a hairline above the menu-only pages at the end of the list
// (Methodology and Contact). Compare is menu-only too, but it sits with the
// three technologies it compares, so no line goes above it.
export function startsMenuOnlyEnd(items: NavItem[], index: number): boolean {
  if (!items[index].menuOnly) {
    return false;
  }
  // Only the first of the run gets the line.
  if (index > 0 && items[index - 1].menuOnly) {
    return false;
  }
  // And only when every item after it is menu-only too.
  for (let i = index + 1; i < items.length; i++) {
    if (!items[i].menuOnly) {
      return false;
    }
  }
  return true;
}
