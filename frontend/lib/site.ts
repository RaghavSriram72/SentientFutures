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
  { href: "/sources/", label: "Source database" },
  { href: "/blog/", label: "Blog" },
  { href: "/about/", label: "About" },
  { href: "/methodology/", label: "Methodology", menuOnly: true },
  { href: "/contact/", label: "Contact", menuOnly: true },
];

// The footer's one line of links.
export const SECONDARY_NAV: NavItem[] = [
  { href: "/about/", label: "About" },
  { href: "/methodology/", label: "Methodology" },
  { href: "/contact/", label: "Contact" },
];
