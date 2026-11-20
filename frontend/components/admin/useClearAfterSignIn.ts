"use client";

import { useEffect, useEffectEvent } from "react";

import type { ApiError } from "@/lib/api";
import { getToken, subscribeToSession } from "@/lib/auth";

// For a form that keeps the error from its last save (or other action) in state.
//
// A 401 means the session ended before the save went through. The page stays
// open under the sign-in card (see AdminShell), so once someone signs in
// again, "Your session ended." is out of date. This calls clear() then, so
// the form can take that error off the screen and is ready to try again.
// Any other error stays until the form clears it itself.
export function useClearAfterSignIn(error: ApiError | null, clear: () => void): void {
  const waitingForSignIn = error !== null && error.status === 401;
  // The latest clear(), without making the effect below start over each render.
  const runClear = useEffectEvent(clear);

  useEffect(() => {
    if (!waitingForSignIn) {
      return;
    }
    return subscribeToSession(() => {
      if (getToken() !== null) {
        runClear();
      }
    });
  }, [waitingForSignIn]);
}
