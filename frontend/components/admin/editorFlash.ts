// A "Saved" message that survives the editor moving to a new address, e.g.
// from /admin/posts/edit/ to ?slug=its-new-slug after the first save. The new
// address mounts a fresh screen, so the message waits here for it.
import { useEffect, useState } from "react";

const waiting = new Map<string, string>();

export function flashAfterNavigation(key: string, message: string): void {
  waiting.set(key, message);
}

// The message left for this screen, if any. It's shown once: a later visit to
// the same address starts without it.
export function useFlash(key: string): string | null {
  const [message] = useState(() => waiting.get(key) ?? null);
  useEffect(() => {
    waiting.delete(key);
  }, [key]);
  return message;
}
