"use client";

import { THEME_DESCRIPTIONS, THEME_LABELS, THEME_PREFERENCES, isThemePreference, resolveTheme, type ThemePreference } from "@timepeace/shared";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { cx } from "./ui";

type ThemeContext = { preference: ThemePreference; choose: (p: ThemePreference) => void };
const Ctx = createContext<ThemeContext>({ preference: "system", choose: () => {} });

/** Keeps <html data-theme> in step with the saved preference and, on "System", with the OS setting. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // null until the saved value is read, so the first effect can't overwrite what the boot script set.
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {}
    setPreference(isThemePreference(saved) ? saved : "system");
  }, []);

  useEffect(() => {
    if (!preference) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.setAttribute("data-theme", resolveTheme(preference, mq.matches));
    apply();
    if (preference !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [preference]);

  const choose = useCallback((p: ThemePreference) => {
    setPreference(p);
    try {
      if (p === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {}
  }, []);

  return <Ctx.Provider value={{ preference: preference ?? "system", choose }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

export function ThemePicker({ className }: { className?: string }) {
  const { preference, choose } = useTheme();
  return (
    <label className={cx("flex items-center gap-1.5 text-sm text-ink-2", className)}>
      <span>Theme</span>
      <select
        value={preference}
        onChange={(e) => isThemePreference(e.target.value) && choose(e.target.value)}
        className="rounded-md border border-line-strong bg-surface px-1.5 py-1 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-ring"
      >
        {THEME_PREFERENCES.map((p) => (
          <option key={p} value={p} title={THEME_DESCRIPTIONS[p]}>
            {THEME_LABELS[p]}
          </option>
        ))}
      </select>
    </label>
  );
}
