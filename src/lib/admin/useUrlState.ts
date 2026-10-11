"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function readParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

function writeParam(key: string, value: string, defaultValue: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!value || value === defaultValue) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + url.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(window.history.state, "", next);
  }
}

export const URL_SYNC_EVENT = "mft:urlsync";

/**
 * Like useState<string>, but mirrored to a URL query param so filters survive
 * refreshes and can be shared as links. Avoids useSearchParams so pages stay
 * statically renderable without Suspense boundaries.
 */
export function useUrlState(key: string, defaultValue = ""): [string, (v: string | ((prev: string) => string)) => void] {
  const [value, setValue] = useState<string>(defaultValue);
  const hydrated = useRef(false);

  // Hydrate from URL after mount, and re-sync on back/forward or in-app deep links to the same page.
  useEffect(() => {
    const fromUrl = readParam(key);
    if (fromUrl !== null) setValue(fromUrl);
    hydrated.current = true;
    const resync = () => setValue(readParam(key) ?? defaultValue);
    window.addEventListener("popstate", resync);
    window.addEventListener(URL_SYNC_EVENT, resync);
    return () => {
      window.removeEventListener("popstate", resync);
      window.removeEventListener(URL_SYNC_EVENT, resync);
    };
  }, [key, defaultValue]);

  // Debounced write-back to the URL.
  useEffect(() => {
    if (!hydrated.current) return;
    const t = setTimeout(() => writeParam(key, value, defaultValue), 250);
    return () => clearTimeout(t);
  }, [key, value, defaultValue]);

  const set = useCallback((v: string | ((prev: string) => string)) => {
    setValue((prev) => (typeof v === "function" ? (v as (p: string) => string)(prev) : v));
  }, []);

  return [value, set];
}
