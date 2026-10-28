// The admin sign-in token, kept in sessionStorage. Cookies can't carry it because
// the site (github.io) and the API live on different domains, so every request
// sends it as a Bearer header instead (see lib/api.ts).
//
// Why sessionStorage: a GitHub Pages project site shares its origin
// (https://<user>.github.io) with every other Pages project of that account,
// and any script on those sites can read that origin's localStorage. A
// sessionStorage token belongs to this tab and is gone when the tab closes.
// The cost is signing in again in a new tab (links opened from an admin page
// usually carry the session over). A custom domain for the site would remove
// the shared origin altogether.
//
// The stored value is JSON: { token, expiresAt, user }. Expired tokens are
// dropped the next time anything reads them.
import type { AdminUser } from "./adminTypes";

const STORAGE_KEY = "sf_admin_token";

// Fired on this tab when the session changes.
const SESSION_EVENT = "sf-admin-session-change";

// Earlier versions kept the token in localStorage. It's removed once per page
// load, so an old token doesn't sit there for other github.io sites to read.
let removedOldToken = false;

function removeOldToken(): void {
  if (removedOldToken) {
    return;
  }
  removedOldToken = true;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage: there's nothing stored to remove either.
  }
}

// The API's tokens last 8 hours. Used only when neither the API response nor the
// token itself says when it expires.
const FALLBACK_LIFETIME_MS = 8 * 60 * 60 * 1000;

export interface AdminSession {
  token: string;
  expiresAt: number; // epoch milliseconds
  user: AdminUser;
}

// Why the last session ended, shown once on the sign-in card.
let signOutNotice: string | null = null;

function readStorage(): string | null {
  removeOldToken();
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private windows and blocked storage throw. Treat it as signed out.
    return null;
  }
}

function writeStorage(value: string | null): void {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(STORAGE_KEY, value);
    }
  } catch {
    // Nothing more to do: the session just won't survive a reload.
  }
}

function announceChange(): void {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

// Reads a JWT's payload without checking its signature. Only for display and
// expiry; the API checks the signature on every request.
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(
      Array.from(atob(padded))
        .map((char) => "%" + char.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const payload: unknown = JSON.parse(json);
    if (payload && typeof payload === "object") {
      return payload as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function expiryFromToken(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (payload && typeof payload.exp === "number") {
    return payload.exp * 1000;
  }
  return null;
}

export function parseSession(raw: string | null): AdminSession | null {
  if (!raw) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as Record<string, unknown>;
    const user = record.user as Record<string, unknown> | undefined;
    if (typeof record.token !== "string" || typeof record.expiresAt !== "number" || !user) {
      return null;
    }
    return {
      token: record.token,
      expiresAt: record.expiresAt,
      user: {
        email: String(user.email ?? ""),
        display_name: String(user.display_name ?? user.email ?? ""),
      },
    };
  } catch {
    return null;
  }
}

// The raw stored string, or null when there's no session or it has expired.
// Returns a string so React's useSyncExternalStore can compare snapshots cheaply.
export function readSessionSnapshot(): string | null {
  const raw = readStorage();
  const session = parseSession(raw);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    writeStorage(null);
    signOutNotice = "Your session expired. Sign in again to carry on.";
    return null;
  }
  return raw;
}

export function getSession(): AdminSession | null {
  return parseSession(readSessionSnapshot());
}

export function getToken(): string | null {
  const session = getSession();
  return session ? session.token : null;
}

export function saveSession(token: string, user: AdminUser, expiresAt: number | null): void {
  const expiry = expiresAt ?? expiryFromToken(token) ?? Date.now() + FALLBACK_LIFETIME_MS;
  const session: AdminSession = { token, expiresAt: expiry, user };
  signOutNotice = null;
  writeStorage(JSON.stringify(session));
  announceChange();
}

// notice: why the person was signed out, shown on the sign-in card. Leave it
// out when they signed out on purpose.
export function clearSession(notice: string | null = null): void {
  signOutNotice = notice;
  writeStorage(null);
  announceChange();
}

export function getSignOutNotice(): string | null {
  return signOutNotice;
}

// For useSyncExternalStore: call back when the session changes in this tab.
// Each tab has its own session, so signing out in one leaves the others alone.
export function subscribeToSession(callback: () => void): () => void {
  window.addEventListener(SESSION_EVENT, callback);
  return () => {
    window.removeEventListener(SESSION_EVENT, callback);
  };
}
