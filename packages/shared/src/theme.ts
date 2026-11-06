/**
 * Color themes shared by web and mobile. Both apps use these semantic tokens (never raw
 * palette colors), so every screen changes with the theme and the two apps stay in step.
 *
 * - light: the original look.
 * - dark: for evenings and dim trailers. Warm neutral surfaces, lighter accent text.
 * - sunlight: maximum contrast for phones and tablets in direct sun on a job site. Black ink,
 *   white surfaces, darker accent and status colors, stronger borders.
 *
 * `theme.test.ts` checks contrast for every text/background pair in every theme.
 */

export const THEME_NAMES = ["light", "dark", "sunlight"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
/** What the user picks. "system" follows the device's light/dark setting. */
export type ThemePreference = ThemeName | "system";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark", "sunlight"];

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
  sunlight: "Sunlight",
};

export const THEME_DESCRIPTIONS: Record<ThemePreference, string> = {
  system: "Follows your device's light or dark setting.",
  light: "The standard look.",
  dark: "Dark surfaces for low light.",
  sunlight: "Extra contrast for screens in bright sun.",
};

export type Palette = {
  /** Page background, behind cards. */
  canvas: string;
  /** Cards, inputs, nav. */
  surface: string;
  /** Subtle hover / zebra rows on a surface. */
  surface2: string;
  /** Chips, neutral badges, ghost-button hover. */
  surface3: string;
  lineSoft: string;
  line: string;
  /** Input borders, secondary buttons. */
  lineStrong: string;
  /** Headings and body text. */
  ink: string;
  /** Secondary text and labels. */
  ink2: string;
  /** Supporting text. */
  muted: string;
  /** De-emphasized, non-essential text (≥3:1). */
  faint: string;

  /** Primary buttons, focus borders, selected states. */
  accent: string;
  accentStrong: string;
  /** Links and accent-colored text on surfaces. */
  accentInk: string;
  /** Selected nav item, info badges. */
  accentSoft: string;
  accentRing: string;
  onAccent: string;
  /** Secondary text on an accent background (the mobile clock card). */
  onAccentMuted: string;

  /** Status marks (icons, dots). Never the only signal: always paired with an icon or label. */
  good: string;
  /** Success buttons with on-accent text. */
  goodStrong: string;
  goodSoft: string;
  goodSoft2: string;
  goodInk: string;
  warning: string;
  warningSoft: string;
  warningInk: string;
  warningLine: string;
  serious: string;
  critical: string;
  criticalSoft: string;
  criticalInk: string;
  criticalLine: string;
  /** "With payroll" (exported) state. */
  violetSoft: string;
  violetInk: string;

  /** Chart marks. */
  series1: string;
  track: string;
  /** Diverging bars: over estimate (warm) vs under (cool). */
  divergeOver: string;
  divergeUnder: string;
};

export const THEMES: Record<ThemeName, Palette> = {
  light: {
    canvas: "#f5f5f3",
    surface: "#ffffff",
    surface2: "#fafaf9",
    surface3: "#f5f5f4",
    lineSoft: "#f0efed",
    line: "#e7e5e4",
    lineStrong: "#d6d3d1",
    ink: "#1c1917",
    ink2: "#57534e",
    muted: "#736c67",
    faint: "#928c87",
    accent: "#256abf",
    accentStrong: "#1c5cab",
    accentInk: "#1c5cab",
    accentSoft: "#eef5fd",
    accentRing: "#cde2fb",
    onAccent: "#ffffff",
    onAccentMuted: "#e3edfb",
    good: "#0ca30c",
    goodStrong: "#15803d",
    goodSoft: "#f0fdf4",
    goodSoft2: "#dcfce7",
    goodInk: "#166534",
    warning: "#fab219",
    warningSoft: "#fffbeb",
    warningInk: "#92400e",
    warningLine: "#fbbf24",
    serious: "#ec835a",
    critical: "#d03b3b",
    criticalSoft: "#fef2f2",
    criticalInk: "#b91c1c",
    criticalLine: "#fca5a5",
    violetSoft: "#f5f3ff",
    violetInk: "#5b21b6",
    series1: "#2a78d6",
    track: "#e7e6e1",
    divergeOver: "#e34948",
    divergeUnder: "#2a78d6",
  },
  dark: {
    canvas: "#121211",
    surface: "#1a1a19",
    surface2: "#212120",
    surface3: "#2a2a28",
    lineSoft: "#262624",
    line: "#33322f",
    lineStrong: "#4a4944",
    ink: "#f0efec",
    ink2: "#c3c2b7",
    muted: "#a3a29a",
    faint: "#7f7e77",
    accent: "#2f6fc2",
    accentStrong: "#2a63ad",
    accentInk: "#86b6ef",
    accentSoft: "#182a40",
    accentRing: "#2a4d78",
    onAccent: "#ffffff",
    onAccentMuted: "#f3f7fe",
    good: "#0ca30c",
    goodStrong: "#13742f",
    goodSoft: "#132b1a",
    goodSoft2: "#183a21",
    goodInk: "#86dc9d",
    warning: "#fab219",
    warningSoft: "#33280f",
    warningInk: "#f5c76a",
    warningLine: "#8a6514",
    serious: "#ec835a",
    critical: "#d03b3b",
    criticalSoft: "#381818",
    criticalInk: "#f6a3a3",
    criticalLine: "#7a2e2e",
    violetSoft: "#272044",
    violetInk: "#c7bcf6",
    series1: "#3987e5",
    track: "#383835",
    divergeOver: "#e66767",
    divergeUnder: "#3987e5",
  },
  sunlight: {
    canvas: "#ededed",
    surface: "#ffffff",
    surface2: "#f5f5f5",
    surface3: "#e6e6e6",
    lineSoft: "#b8b8b8",
    line: "#8c8c8c",
    lineStrong: "#4d4d4d",
    ink: "#000000",
    ink2: "#1f1f1f",
    muted: "#383838",
    faint: "#595959",
    accent: "#0b4fa8",
    accentStrong: "#083c80",
    accentInk: "#083f8a",
    accentSoft: "#dde9fb",
    accentRing: "#4f86d6",
    onAccent: "#ffffff",
    onAccentMuted: "#ffffff",
    good: "#0a7a0a",
    goodStrong: "#0b6620",
    goodSoft: "#dff3df",
    goodSoft2: "#c8eac8",
    goodInk: "#0a4214",
    warning: "#b37400",
    warningSoft: "#ffefc7",
    warningInk: "#5c2e00",
    warningLine: "#a06800",
    serious: "#b0481f",
    critical: "#a11f18",
    criticalSoft: "#fde2e2",
    criticalInk: "#7f1010",
    criticalLine: "#b3261e",
    violetSoft: "#ebe5ff",
    violetInk: "#36108a",
    series1: "#1c5cab",
    track: "#cfcfcf",
    divergeOver: "#b3261e",
    divergeUnder: "#1c5cab",
  },
};

export function isThemePreference(v: unknown): v is ThemePreference {
  return typeof v === "string" && (THEME_PREFERENCES as readonly string[]).includes(v);
}

/** The theme to show for a preference, given whether the device is in dark mode. */
export function resolveTheme(pref: ThemePreference | null | undefined, systemDark: boolean): ThemeName {
  if (pref && pref !== "system") return pref;
  return systemDark ? "dark" : "light";
}

/** `surface2` → `surface-2`, `onAccentMuted` → `on-accent-muted`: the CSS / Tailwind token name. */
export function tokenName(key: keyof Palette): string {
  return key.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/([a-z])([0-9])/g, "$1-$2").toLowerCase();
}

/** WCAG 2.x contrast ratio between two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
