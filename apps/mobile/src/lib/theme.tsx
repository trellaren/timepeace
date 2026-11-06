import { THEMES, isThemePreference, resolveTheme, type Palette, type ThemeName, type ThemePreference } from "@timepeace/shared";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { kv } from "./db";

/** A device preference: kept across sign-out (`kv.clearCache` keeps `pref:` keys). */
const KEY = "pref:theme";

type ThemeContext = { preference: ThemePreference; name: ThemeName; colors: Palette; choose: (p: ThemePreference) => void };
const Ctx = createContext<ThemeContext>({ preference: "system", name: "light", colors: THEMES.light, choose: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    kv.get<string>(KEY)
      .then((v) => isThemePreference(v) && setPreference(v))
      .catch(() => {});
  }, []);

  const choose = useCallback((p: ThemePreference) => {
    setPreference(p);
    void kv.set(KEY, p).catch(() => {});
  }, []);

  const name = resolveTheme(preference, system === "dark");
  return <Ctx.Provider value={{ preference, name, colors: THEMES[name], choose }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
export const useColors = () => useContext(Ctx).colors;

/**
 * Themed styles: `const useStyles = makeStyles((c) => StyleSheet.create({...}))`, then
 * `const s = useStyles()` in a component. Built once per theme, not per render.
 */
export function makeStyles<T>(build: (c: Palette) => T): () => T {
  const cache = new Map<ThemeName, T>();
  return function useStyles() {
    const { name, colors } = useTheme();
    let styles = cache.get(name);
    if (!styles) {
      styles = build(colors);
      cache.set(name, styles);
    }
    return styles;
  };
}
