import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "applydock-theme";
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

const system = (): Theme => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/** Apply a theme; persist only an explicit user choice so the app otherwise keeps following the system. */
export function setTheme(theme: Theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }
  listeners.forEach((listener) => listener());
}

export function initTheme() {
  setTheme(stored() ?? system(), false);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!stored()) setTheme(system(), false);
  });
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentTheme,
  );
}
