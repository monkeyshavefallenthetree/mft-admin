"use client";

import { useCallback, useSyncExternalStore } from "react";

export type HrLang = "ar" | "en";

const STORAGE_KEY = "mft_hr_lang";
const EVENT_NAME = "mft-hr-lang-change";

export function getStoredHrLang(): HrLang {
  if (typeof window === "undefined") return "ar";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "en" || saved === "ar" ? saved : "ar";
}

function getServerHrLang(): HrLang {
  return "ar";
}

function subscribeHrLang(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener(EVENT_NAME, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

export function setStoredHrLang(next: HrLang): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, next);
  window.dispatchEvent(new CustomEvent<HrLang>(EVENT_NAME, { detail: next }));
}

/**
 * Shared reactive language hook ("ar" | "en") across HR Dashboard, Workers Page, and HR Modals.
 * Defaults to Arabic ("ar") with instant 1-click toggle to English ("en").
 */
export function useHrLang(): {
  lang: HrLang;
  isAr: boolean;
  dir: "rtl" | "ltr";
  setLang: (next: HrLang) => void;
  toggleLang: () => void;
  t: (arText: string, enText: string) => string;
} {
  const lang = useSyncExternalStore(subscribeHrLang, getStoredHrLang, getServerHrLang);

  const setLang = useCallback((next: HrLang) => {
    setStoredHrLang(next);
  }, []);

  const toggleLang = useCallback(() => {
    setStoredHrLang(lang === "ar" ? "en" : "ar");
  }, [lang]);

  const t = useCallback(
    (arText: string, enText: string) => (lang === "ar" ? arText : enText),
    [lang],
  );

  return {
    lang,
    isAr: lang === "ar",
    dir: lang === "ar" ? "rtl" : "ltr",
    setLang,
    toggleLang,
    t,
  };
}
