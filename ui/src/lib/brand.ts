import type { StrutBrand } from "@/lib/strut/client";

/**
 * The Branding page's arithmetic, none of it a copy of the brand: strut
 * keeps that (`GET /brand`, specs/API.md §14.12). `textOn` and
 * `brandStyles` are strut's own (`src/brand.ts`), so the preview hands its
 * components exactly the variables strut's host hands an app, and
 * `kitTokens` reads them the way the kit's stylesheet does
 * (`kit/src/styles/base.css`), falling back to the kit's neutral defaults.
 */

export type Theme = "light" | "dark";

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb`, `#rrggbb`, or either without the `#`, as lowercase `#rrggbb`; null for anything else. */
export function parseHex(input: string): string | null {
  const m = HEX.exec(input.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

const rgb = (hex: string): [number, number, number] => {
  const h = (parseHex(hex) ?? "#000000").slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Strut's pick for the text on a brand color: near-black `#0a0a0a` or white, whichever has the higher contrast. */
export function textOn(hex: string): string {
  const l = luminance(hex);
  const dark = 0.0032; // #0a0a0a, the kit's foreground
  return (l + 0.05) / (dark + 0.05) >= 1.05 / (l + 0.05) ? "#0a0a0a" : "#ffffff";
}

/** Strut's `brandStyles`: each theme's MCP Apps style variables, or null when the brand sets nothing. */
export function brandStyles(brand: StrutBrand): Record<Theme, { variables: Record<string, string> }> | null {
  if (!brand.color && !brand.colorDark && !brand.radius && !brand.font) return null;
  const forTheme = (color: string | undefined) => {
    const v: Record<string, string> = {};
    if (color) {
      v["--color-background-inverse"] = color;
      v["--color-text-inverse"] = textOn(color);
      v["--color-ring-primary"] = color;
    }
    if (brand.radius) v["--border-radius-md"] = brand.radius;
    if (brand.font) v["--font-sans"] = brand.font;
    return { variables: v };
  };
  return { light: forTheme(brand.color ?? brand.colorDark), dark: forTheme(brand.colorDark ?? brand.color) };
}

/** The kit's defaults (base.css, shadcn neutral, as hex), for what a brand leaves unset. */
const KIT = {
  light: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    card: "#ffffff",
    border: "#e5e5e5",
    input: "#e5e5e5",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    sidebar: "#fafafa",
    sidebarAccent: "#f5f5f5",
    primary: "#171717",
    primaryForeground: "#fafafa",
    sidebarPrimary: "#171717",
    sidebarPrimaryForeground: "#fafafa",
    ring: "#a1a1a1",
  },
  dark: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    card: "#171717",
    border: "rgb(255 255 255 / 0.1)",
    input: "rgb(255 255 255 / 0.15)",
    muted: "#262626",
    mutedForeground: "#a1a1a1",
    sidebar: "#171717",
    sidebarAccent: "#262626",
    primary: "#e5e5e5",
    primaryForeground: "#171717",
    sidebarPrimary: "#1447e6",
    sidebarPrimaryForeground: "#fafafa",
    ring: "#737373",
  },
} as const;

/** Tailwind's `font-sans`, which the kit keeps when no font is sent. */
export const KIT_FONT = 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
export const KIT_RADIUS = "0.625rem";

/** The kit's tokens for one theme under a brand: `--k-*` custom properties for the preview's wrapper. */
export function kitTokens(brand: StrutBrand, theme: Theme): Record<string, string> {
  const v = brandStyles(brand)?.[theme].variables ?? {};
  const k = KIT[theme];
  const primary = v["--color-background-inverse"];
  const primaryForeground = v["--color-text-inverse"];
  return {
    "--k-background": k.background,
    "--k-foreground": k.foreground,
    "--k-card": k.card,
    "--k-border": k.border,
    "--k-input": k.input,
    "--k-muted": k.muted,
    "--k-muted-foreground": k.mutedForeground,
    "--k-sidebar": k.sidebar,
    "--k-sidebar-accent": k.sidebarAccent,
    "--k-primary": primary ?? k.primary,
    "--k-primary-foreground": primaryForeground ?? k.primaryForeground,
    "--k-sidebar-primary": primary ?? k.sidebarPrimary,
    "--k-sidebar-primary-foreground": primaryForeground ?? k.sidebarPrimaryForeground,
    "--k-ring": v["--color-ring-primary"] ?? k.ring,
    "--k-radius": v["--border-radius-md"] ?? KIT_RADIUS,
    "--k-font": v["--font-sans"] ?? KIT_FONT,
  };
}

/** The color each theme shows: each falls back to the other, then to the kit's. */
export function themeColor(brand: StrutBrand, theme: Theme): string {
  return kitTokens(brand, theme)["--k-primary"]!;
}

// ── reading a color against its page ───────────────────────────────────

/** What a button sits on: the kit's white page, and its dark card (the lighter of its dark surfaces). */
export const PAGE: Record<Theme, string> = { light: "#ffffff", dark: "#171717" };

/** WCAG's floor for a control against what is around it. Below it, a button is hard to pick out. */
const READABLE = 3;
/** Where a suggestion lands: comfortably past the floor. */
const COMFORTABLE = 4.5;

/** Too pale to pick out on a white page. */
export const paleOnLight = (hex: string) => contrast(hex, PAGE.light) < READABLE;
/** Too dark to pick out on the dark theme's background. */
export const darkOnDark = (hex: string) => contrast(hex, PAGE.dark) < READABLE;

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const c = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(h + 1 / 3)}${channel(h)}${channel(h - 1 / 3)}`;
}

/** The same hue and saturation, lighter or darker until it reads comfortably on `page`. */
function shiftUntilReadable(hex: string, page: string, step: 1 | -1): string {
  const [h, s, l] = toHsl(hex);
  for (let i = Math.round(l * 100); i >= 0 && i <= 100; i += step) {
    const c = fromHsl(h, s, i / 100);
    if (contrast(c, page) >= COMFORTABLE) return c;
  }
  return step > 0 ? "#ffffff" : "#000000";
}

/** A lighter tint of `hex` that reads on the dark theme's background. */
export const lighterForDark = (hex: string) => shiftUntilReadable(hex, PAGE.dark, 1);
/** A deeper shade of `hex` that reads on a white page. */
export const deeperForLight = (hex: string) => shiftUntilReadable(hex, PAGE.light, -1);

// ── the choices ─────────────────────────────────────────────────────────

/** Brand colors to click, each with a lighter twin for the dark theme. */
export const SWATCHES: ReadonlyArray<{ name: string; light: string; dark: string }> = [
  { name: "Rose", light: "#e11d48", dark: "#fb7185" },
  { name: "Orange", light: "#ea580c", dark: "#fb923c" },
  { name: "Amber", light: "#d97706", dark: "#fbbf24" },
  { name: "Emerald", light: "#059669", dark: "#34d399" },
  { name: "Teal", light: "#0d9488", dark: "#2dd4bf" },
  { name: "Sky", light: "#0284c7", dark: "#38bdf8" },
  { name: "Blue", light: "#2563eb", dark: "#60a5fa" },
  { name: "Indigo", light: "#4f46e5", dark: "#818cf8" },
  { name: "Violet", light: "#7c3aed", dark: "#a78bfa" },
  { name: "Pink", light: "#db2777", dark: "#f472b6" },
  { name: "Navy", light: "#1e3a8a", dark: "#93c5fd" },
  { name: "Slate", light: "#475569", dark: "#94a3b8" },
];

/** A swatch's name for a color, in either theme. */
export const colorName = (hex: string | undefined) => (hex ? SWATCHES.find((s) => s.light === hex || s.dark === hex)?.name : undefined);

/**
 * The color to offer the dark theme for a light one: a swatch's own twin,
 * else a lighter tint when it is too dark to read there, else itself.
 */
export function darkFor(hex: string): string {
  return SWATCHES.find((s) => s.light === hex)?.dark ?? (darkOnDark(hex) ? lighterForDark(hex) : hex);
}

/** Corners, smallest first. Default (unset) is the kit's 0.625rem. */
export const RADII: ReadonlyArray<{ name: string; value: string | undefined; px: number }> = [
  { name: "Square", value: "0", px: 0 },
  { name: "Subtle", value: "0.375rem", px: 6 },
  { name: "Default", value: undefined, px: 10 },
  { name: "Round", value: "1rem", px: 16 },
];

/** Font stacks of fonts people's machines have: an app's page loads none from the network. */
export const FONTS: ReadonlyArray<{ name: string; value: string | undefined }> = [
  { name: "Default", value: undefined },
  { name: "System sans", value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { name: "Humanist", value: '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif' },
  { name: "Serif", value: 'Georgia, "Times New Roman", serif' },
  { name: "Rounded", value: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif' },
  { name: "Mono", value: 'ui-monospace, "SF Mono", Menlo, monospace' },
];

/** Whether two brands set the same look. */
export const sameBrand = (a: StrutBrand, b: StrutBrand) =>
  (["color", "colorDark", "radius", "font"] as const).every((k) => (a[k] || undefined) === (b[k] || undefined));
