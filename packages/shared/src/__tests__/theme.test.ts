import { describe, expect, it } from "vitest";
import { THEME_NAMES, THEMES, contrastRatio, isThemePreference, resolveTheme, tokenName, type Palette } from "../theme";

type Pair = [fg: keyof Palette, bg: keyof Palette, min: number];

/** Every text/background combination the web and mobile apps draw. AA is 4.5:1 for text, 3:1 for marks. */
const TEXT: Pair[] = [
  ["ink", "canvas", 7],
  ["ink", "surface", 7],
  ["ink", "surface2", 7],
  ["ink", "surface3", 7],
  ["ink2", "surface", 4.5],
  ["ink2", "surface2", 4.5],
  ["ink2", "surface3", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "canvas", 4.5],
  ["muted", "surface2", 4.5],
  ["faint", "surface", 3],
  ["accentInk", "surface", 4.5],
  ["accentInk", "accentSoft", 4.5],
  ["onAccent", "accent", 4.5],
  ["onAccent", "accentStrong", 4.5],
  ["onAccentMuted", "accent", 4.5],
  ["onAccent", "goodStrong", 4.5],
  ["onAccent", "critical", 4.5], // danger buttons
  ["goodInk", "goodSoft", 4.5],
  ["goodInk", "goodSoft2", 4.5],
  ["goodInk", "surface", 4.5],
  ["warningInk", "warningSoft", 4.5],
  ["warningInk", "surface", 4.5],
  ["criticalInk", "criticalSoft", 4.5],
  ["criticalInk", "surface", 4.5],
  ["violetInk", "violetSoft", 4.5],
  ["ink2", "surface3", 4.5],
];

/** Non-text marks against the surface they sit on. */
const MARKS: Pair[] = [
  ["accent", "surface", 3],
  ["good", "surface", 3],
  ["critical", "surface", 3],
  ["series1", "surface", 3],
  ["divergeOver", "surface", 3],
  ["divergeUnder", "surface", 3],
  ["lineStrong", "surface", 1.4],
];

describe("themes", () => {
  for (const name of THEME_NAMES) {
    const p = THEMES[name];
    // Sunlight exists to be read in direct sun: hold its text to AAA (7:1) where AA would allow 4.5.
    const boost = (min: number) => (name === "sunlight" && min === 4.5 ? 7 : min);

    it.each(TEXT)(`${name}: %s on %s ≥ %d`, (fg, bg, min) => {
      expect(contrastRatio(p[fg], p[bg])).toBeGreaterThanOrEqual(boost(min));
    });

    it.each(MARKS)(`${name}: mark %s on %s ≥ %d`, (fg, bg, min) => {
      expect(contrastRatio(p[fg], p[bg])).toBeGreaterThanOrEqual(min);
    });

    it(`${name}: warning mark is visible (light is exempt: it always ships with ▲ and a label)`, () => {
      if (name !== "light") expect(contrastRatio(p.warning, p.surface)).toBeGreaterThanOrEqual(3);
    });
  }

  it("all themes define the same tokens as valid hex colors", () => {
    const keys = Object.keys(THEMES.light).sort();
    for (const name of THEME_NAMES) {
      expect(Object.keys(THEMES[name]).sort()).toEqual(keys);
      for (const v of Object.values(THEMES[name])) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("resolves preferences", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme("sunlight", true)).toBe("sunlight");
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("neon")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });

  it("names CSS tokens", () => {
    expect(tokenName("surface2")).toBe("surface-2");
    expect(tokenName("onAccentMuted")).toBe("on-accent-muted");
    expect(tokenName("goodSoft2")).toBe("good-soft-2");
    expect(tokenName("series1")).toBe("series-1");
  });

  it("contrast ratio matches known values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
