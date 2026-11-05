/**
 * Strut's brand check, copied from strut `src/brand.ts` (`brandProblem`,
 * `normalizeBrand`, stakwork/strut#538) so the fake strut's `PUT /brand`
 * refuses and keeps exactly what the real one does.
 */
import type { StrutBrand } from "@/lib/strut/client";

const FIELDS = ["color", "colorDark", "radius", "font"] as const;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const LENGTH = /^(?:0|\d{1,3}(?:\.\d{1,3})?(?:px|rem|em))$/;
/** Names, quotes, commas and spaces: nothing that could end the value. */
const FONT = /^[\p{L}\p{N} "',._-]{1,200}$/u;

/** Why `body` is not a brand, or undefined. An empty string or null clears a field. */
export function brandProblem(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "the brand is { color?, colorDark?, radius?, font? }";
  for (const [k, v] of Object.entries(body)) {
    if (!(FIELDS as readonly string[]).includes(k)) return `unknown field "${k}" (the brand is { color?, colorDark?, radius?, font? })`;
    if (v === null || v === "") continue;
    if (typeof v !== "string") return `${k} is a string`;
    if ((k === "color" || k === "colorDark") && !HEX.test(v)) return `${k} is a hex color, #rrggbb`;
    if (k === "radius" && !LENGTH.test(v)) return "radius is a length in px, rem or em (0.5rem, 6px)";
    if (k === "font" && !FONT.test(v)) return 'font is a font-family list ("Avenir Next", system-ui, sans-serif)';
  }
  return undefined;
}

/** The brand as kept: empty fields dropped, a color as lowercase `#rrggbb`. */
export function normalizeBrand(body: Record<string, unknown>): StrutBrand {
  const out: StrutBrand = {};
  for (const k of FIELDS) {
    const v = body[k];
    if (typeof v !== "string" || !v.trim()) continue;
    out[k] = k === "color" || k === "colorDark" ? longHex(v) : v.trim();
  }
  return out;
}

function longHex(hex: string): string {
  const h = hex.trim().toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
}
