"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

import { ApiError, toApiError } from "@/lib/api";
import { getToken, subscribeToSession } from "@/lib/auth";

export interface ApiData<T> {
  data: T | null;
  error: ApiError | null;
  // True until the first answer for this key arrives, and again during a reload.
  loading: boolean;
  reload: () => void;
}

interface LoadResult<T> {
  key: string;
  version: number;
  data: T | null;
  error: ApiError | null;
}

// Loads data from the API whenever `key` changes (null means "don't load yet").
// reload() asks again with the same key and keeps showing the old data until
// the new answer arrives, so polling doesn't flicker.
export function useApiData<T>(key: string | null, load: () => Promise<T>): ApiData<T> {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<LoadResult<T> | null>(null);
  const runLoad = useEffectEvent(load);

  useEffect(() => {
    if (key === null) {
      return;
    }
    let cancelled = false;
    runLoad().then(
      (data) => {
        if (!cancelled) {
          setResult({ key, version, data, error: null });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          // Keep the last good data for this key, so a failed poll doesn't blank the page.
          setResult((previous) => ({
            key,
            version,
            data: previous && previous.key === key ? previous.data : null,
            error: toApiError(error),
          }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  // A 401 means the session ended. Once someone signs in again (over the
  // page, which stays open), ask again, so the page doesn't sit on "sign in
  // again" after they already have.
  const sameKey = result !== null && result.key === key;
  const waitingForSignIn = sameKey && result.error !== null && result.error.status === 401;
  useEffect(() => {
    if (!waitingForSignIn) {
      return;
    }
    return subscribeToSession(() => {
      if (getToken() !== null) {
        setVersion((current) => current + 1);
      }
    });
  }, [waitingForSignIn]);

  return {
    data: sameKey ? result.data : null,
    error: sameKey ? result.error : null,
    loading: key !== null && (!sameKey || result.version !== version),
    reload,
  };
}
