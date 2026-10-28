"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

// The parts of Google Identity Services this page uses.
// Docs: https://developers.google.com/identity/gsi/web/reference/js-reference
interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const GOOGLE_SCRIPT_URL = "https://accounts.google.com/gsi/client";

// One script tag per page load, however many times the button mounts.
let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }
  if (scriptPromise) {
    return scriptPromise;
  }
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let the next attempt try again (an ad blocker, or the network was down).
      scriptPromise = null;
      script.remove();
      reject(new Error("Google's sign-in script didn't load."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// Stops Google from signing the same account straight back in after "Sign out".
export function forgetGoogleAccount(): void {
  window.google?.accounts?.id?.disableAutoSelect();
}

interface GoogleSignInButtonProps {
  clientId: string;
  onCredential: (credential: string) => void;
  // For the box Google draws into; give it a min-height so the card doesn't jump.
  className?: string;
}

export function GoogleSignInButton({ clientId, onCredential, className }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const handleCredential = useEffectEvent((credential: string) => {
    onCredential(credential);
  });

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript().then(
      () => {
        const container = containerRef.current;
        const google = window.google;
        if (cancelled || !container || !google) {
          return;
        }
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => handleCredential(response.credential),
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        google.accounts.id.renderButton(container, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "signin_with",
          logo_alignment: "left",
          // Fits inside the card on a 375px phone.
          width: 280,
        });
      },
      () => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (loadFailed) {
    return (
      <p role="alert">
        Google&rsquo;s sign-in button didn&rsquo;t load. An ad or tracker blocker can stop it, so try allowing
        accounts.google.com and reload the page.
      </p>
    );
  }
  // Google draws its own button into this box.
  return <div ref={containerRef} className={className} />;
}
