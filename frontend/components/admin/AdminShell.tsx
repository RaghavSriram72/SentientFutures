"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { revokeToken } from "@/lib/api";
import { clearSession, getToken, parseSession, readSessionSnapshot, subscribeToSession } from "@/lib/auth";

import styles from "./AdminShell.module.css";
import { forgetGoogleAccount } from "./GoogleSignInButton";
import { LoginCard } from "./LoginCard";
import { mayDropUnsavedWork, useLeaveGuard } from "./unsavedWork";

// What the static HTML renders, before the browser can look at sessionStorage.
const SERVER_SNAPSHOT = "__rendered_on_server__";

function getServerSnapshot(): string {
  return SERVER_SNAPSHOT;
}

// setTimeout can't wait longer than about 24.8 days.
const MAX_TIMEOUT_MS = 2_147_483_647;

interface AdminNavItem {
  href: string;
  label: string;
  // Other admin paths that belong under this item.
  alsoActiveOn: string[];
}

const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin/", label: "Dashboard", alsoActiveOn: ["/admin/runs/"] },
  { href: "/admin/queue/", label: "Review queue", alsoActiveOn: ["/admin/review/"] },
  { href: "/admin/sources/new/", label: "Add a source", alsoActiveOn: [] },
  { href: "/admin/milestones/", label: "Milestones", alsoActiveOn: ["/admin/milestones/"] },
  { href: "/admin/posts/", label: "Blog posts", alsoActiveOn: ["/admin/posts/"] },
  { href: "/admin/stats/", label: "Review stats", alsoActiveOn: [] },
  { href: "/admin/settings/", label: "Settings", alsoActiveOn: [] },
];

// While the sign-in card covers the page, the site's own header, banner and
// footer (marked data-site-chrome) go inert too, so nothing behind the card
// can be clicked or tabbed to.
function useInertSiteChrome(locked: boolean): void {
  useEffect(() => {
    if (!locked) {
      return;
    }
    const parts = document.querySelectorAll<HTMLElement>("[data-site-chrome]");
    for (const part of parts) {
      part.inert = true;
    }
    return () => {
      for (const part of parts) {
        part.inert = false;
      }
    };
  }, [locked]);
}

// On a phone the admin links are one row that scrolls sideways. This scrolls
// that row (and only that row, never the page) so the current page's link
// isn't hidden off to the right.
function useCurrentLinkInView(listRef: RefObject<HTMLUListElement | null>, pathname: string, signedIn: boolean): void {
  useEffect(() => {
    const list = listRef.current;
    if (!signedIn || list === null) {
      return;
    }
    const current = list.querySelector<HTMLElement>('[aria-current="page"]');
    if (current === null) {
      return;
    }
    const listBox = list.getBoundingClientRect();
    const linkBox = current.getBoundingClientRect();
    if (linkBox.left < listBox.left || linkBox.right > listBox.right) {
      // Centered in the row where it can be.
      list.scrollLeft += linkBox.left - listBox.left - (listBox.width - linkBox.width) / 2;
    }
  }, [listRef, pathname, signedIn]);
}

function withTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function isActive(pathname: string, item: AdminNavItem): boolean {
  const path = withTrailingSlash(pathname);
  if (path === item.href) {
    return true;
  }
  for (const other of item.alsoActiveOn) {
    if (path.startsWith(other)) {
      return true;
    }
  }
  return false;
}

// Wraps every admin page. No valid token means the sign-in card instead of the
// page; signing in or out swaps them on the spot.
//
// When a session ends on its own (it expired, or the API answered 401), the
// page stays mounted underneath the sign-in card, so a half-written review or
// unsaved settings survive. Signing in again picks up where it left off.
export function AdminShell({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribeToSession, readSessionSnapshot, getServerSnapshot);
  const session = useMemo(() => (raw === SERVER_SNAPSHOT ? null : parseSession(raw)), [raw]);
  const pathname = usePathname() ?? "/admin/";
  const expiresAt = session ? session.expiresAt : null;
  // True once someone has been signed in on this page, until they sign out on purpose.
  const [wasSignedIn, setWasSignedIn] = useState(false);
  if (session !== null && !wasSignedIn) {
    // Adjusting state while rendering, as React's docs suggest for state
    // derived from something outside React.
    setWasSignedIn(true);
  }

  // Sign out when the token expires, even if the page is just sitting open.
  useEffect(() => {
    if (expiresAt === null) {
      return;
    }
    const delay = Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMEOUT_MS);
    const timer = window.setTimeout(() => {
      if (Date.now() >= expiresAt) {
        clearSession("Your session expired. Sign in again to carry on.");
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  // Any link on an admin page asks first when a form has unsaved work.
  useLeaveGuard();
  useInertSiteChrome(session === null && wasSignedIn);
  const linksRef = useRef<HTMLUListElement>(null);
  useCurrentLinkInView(linksRef, pathname, session !== null);
  const contentRef = useRef<HTMLDivElement>(null);
  const focusBeforeLockRef = useRef<HTMLElement | null>(null);
  // The last thing on the page that had focus. A button that's disabled while
  // it saves lets focus drop to the page, so when the save's 401 ends the
  // session, this still knows where the person was.
  const lastFocusRef = useRef<HTMLElement | null>(null);
  useFocusAfterSignInOrOut({
    checking: raw === SERVER_SNAPSHOT,
    signedIn: session !== null,
    wasSignedIn,
    contentRef,
    focusBeforeLockRef,
  });

  function signOut() {
    // Signing out closes the form, so unsaved changes would be lost.
    if (!mayDropUnsavedWork()) {
      return;
    }
    // Signing out on purpose closes the page too, so the next person starts fresh.
    const token = getToken();
    setWasSignedIn(false);
    forgetGoogleAccount();
    clearSession();
    // And the API stops accepting the token, so it can't be reused.
    if (token !== null) {
      void revokeToken(token);
    }
  }

  if (raw === SERVER_SNAPSHOT) {
    return (
      <div className={`container ${styles.gate}`}>
        <p className={styles.checking}>Checking whether you&rsquo;re signed in&hellip;</p>
      </div>
    );
  }

  if (!session && !wasSignedIn) {
    return (
      <div className={`container ${styles.gate}`}>
        <LoginCard />
      </div>
    );
  }

  // The page sits in the same place in the tree whether or not the sign-in
  // card covers it, so React keeps it, and everything typed into it, mounted.
  const locked = session === null;
  return (
    <>
      {session && (
        <div className={styles.bar}>
          <div className={`container ${styles.barInner}`}>
            <p className={styles.barLabel}>Team admin</p>
            <nav aria-label="Admin" className={styles.nav}>
              <ul ref={linksRef} className={styles.links}>
                {ADMIN_NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={styles.link}
                      aria-current={isActive(pathname, item) ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className={styles.user}>
              <span className={styles.userName} title={session.user.email}>
                {session.user.display_name || session.user.email}
              </span>
              <button type="button" className={styles.signOut} onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        ref={contentRef}
        inert={locked}
        onFocus={(event) => {
          if (event.target instanceof HTMLElement) {
            lastFocusRef.current = event.target;
          }
        }}
      >
        {children}
      </div>
      {locked && <SignInAgain focusBeforeLockRef={focusBeforeLockRef} lastFocusRef={lastFocusRef} />}
    </>
  );
}

interface FocusAfterSignInOrOutOptions {
  // True until the browser has looked at the session.
  checking: boolean;
  signedIn: boolean;
  // False after signing out on purpose (see AdminShell).
  wasSignedIn: boolean;
  // Wraps the admin page, whose heading takes focus after signing in.
  contentRef: RefObject<HTMLDivElement | null>;
  // What had focus on the page when the session ended on its own.
  focusBeforeLockRef: RefObject<HTMLElement | null>;
}

// Signing in or out swaps what's on screen, and the button that did it goes
// with it, so focus would drop to the page. It moves to the new heading
// instead: the page's after signing in, the sign-in card's after signing out.
// Signing in again over a page that was kept puts focus back where it was.
function useFocusAfterSignInOrOut({
  checking,
  signedIn,
  wasSignedIn,
  contentRef,
  focusBeforeLockRef,
}: FocusAfterSignInOrOutOptions): void {
  // Whether someone was signed in when this last ran, or null before the first look.
  const signedInBefore = useRef<boolean | null>(null);

  useEffect(() => {
    if (checking) {
      return;
    }
    const before = signedInBefore.current;
    signedInBefore.current = signedIn;
    // Loading the page leaves focus alone, like any other page.
    if (before === null || before === signedIn) {
      return;
    }
    if (!signedIn) {
      // When the session ended on its own, the card over the page takes focus itself (SignInAgain).
      if (!wasSignedIn) {
        document.getElementById("login-heading")?.focus();
      }
      return;
    }
    const kept = focusBeforeLockRef.current;
    focusBeforeLockRef.current = null;
    if (kept !== null && kept.isConnected) {
      kept.focus();
      return;
    }
    contentRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [checking, signedIn, wasSignedIn, contentRef, focusBeforeLockRef]);
}

interface SignInAgainProps {
  // Set here to what had focus on the page, for after signing in again.
  focusBeforeLockRef: RefObject<HTMLElement | null>;
  // The last thing on the page that had focus (see AdminShell).
  lastFocusRef: RefObject<HTMLElement | null>;
}

// The sign-in card over the page, after a session ended on its own.
function SignInAgain({ focusBeforeLockRef, lastFocusRef }: SignInAgainProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Whatever had focus is now inert underneath, so focus moves to the card.
  // It's remembered, so signing in again can put focus back there.
  useEffect(() => {
    const dialog = dialogRef.current;
    const active = document.activeElement;
    // Not the card itself, which already has focus when React runs this twice in development.
    if (active instanceof HTMLElement && active !== document.body && !dialog?.contains(active)) {
      focusBeforeLockRef.current = active;
    } else if (active === document.body) {
      // Focus had already dropped to the page, from a button disabled while
      // it saved, say. The last thing that had focus stands in.
      focusBeforeLockRef.current = lastFocusRef.current;
    }
    dialog?.focus();
  }, [focusBeforeLockRef, lastFocusRef]);

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-heading"
        tabIndex={-1}
        className={styles.dialog}
      >
        <LoginCard resuming />
      </div>
    </div>
  );
}
