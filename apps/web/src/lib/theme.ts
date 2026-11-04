import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Shared with the inline bootstrap script in index.html. */
const STORAGE_KEY = "chargemesh-theme";
const EVENT = "chargemesh-theme-change";

function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

/** Read the theme that the bootstrap script (or a previous toggle) already applied. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme, persist = true): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Private mode can block storage; the class still applies for this visit. */
    }
  }
  window.dispatchEvent(new CustomEvent<Theme>(EVENT, { detail: theme }));
}

/**
 * Keeps every toggle on the page in sync. When the visitor has never chosen a
 * theme, the app follows the operating system and reacts to system changes.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      if (storedTheme()) return;
      const next = systemTheme();
      applyTheme(next, false);
      setTheme(next);
    };

    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    media.addEventListener("change", followSystem);
    sync();
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      media.removeEventListener("change", followSystem);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }, []);

  return { theme, toggle };
}
