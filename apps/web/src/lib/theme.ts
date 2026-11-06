import { THEME_NAMES, THEMES, tokenName, type Palette } from "@timepeace/shared";

/** Per-browser preference. Absent means "system". */
export const THEME_STORAGE_KEY = "timepeace.theme";

/** The --tp-* variables for every theme, keyed by <html data-theme>. Light is also the no-JS default. */
export function themeCss(): string {
  return THEME_NAMES.map((name) => {
    const selector = name === "light" ? `:root,[data-theme="light"]` : `[data-theme="${name}"]`;
    const palette = THEMES[name];
    const vars = (Object.keys(palette) as (keyof Palette)[]).map((k) => `--tp-${tokenName(k)}:${palette[k]}`).join(";");
    return `${selector}{color-scheme:${name === "dark" ? "dark" : "light"};${vars}}`;
  }).join("\n");
}

/**
 * Runs in <head> before the first paint, so a saved theme never flashes the light one first.
 * Kept in step with `resolveTheme` in @timepeace/shared.
 */
export const themeBootScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var t=(${JSON.stringify(
  THEME_NAMES,
)}.indexOf(p)>=0)?p:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
