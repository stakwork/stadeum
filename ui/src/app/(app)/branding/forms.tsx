"use client";

import { useState, useTransition } from "react";

import { buttonClass } from "@/components/button";
import {
  colorName,
  contrast,
  darkFor,
  darkOnDark,
  deeperForLight,
  FONTS,
  KIT_FONT,
  lighterForDark,
  paleOnLight,
  parseHex,
  RADII,
  sameBrand,
  SWATCHES,
  textOn,
  type Theme,
} from "@/lib/brand";
import type { StrutBrand } from "@/lib/strut/client";
import { saveBrand } from "./actions";
import { Preview } from "./preview";

/** Drops the fields set to nothing, so a brand compares and saves as strut keeps it. */
function clean(b: StrutBrand): StrutBrand {
  const out: StrutBrand = {};
  for (const k of ["color", "colorDark", "radius", "font"] as const) if (b[k]) out[k] = b[k];
  return out;
}

const LIGHT = SWATCHES.map((s) => ({ name: s.name, hex: s.light }));
const DARK = SWATCHES.map((s) => ({ name: s.name, hex: s.dark }));

/**
 * The brand, picked: every pick restyles the preview at once, and nothing
 * reaches strut until Save. Starts from what strut holds.
 */
export function BrandForm({ saved: initial }: { saved: StrutBrand }) {
  const [saved, setSaved] = useState(() => clean(initial));
  const [brand, setBrand] = useState(() => clean(initial));
  const [theme, setTheme] = useState<Theme>("light");
  const [note, setNote] = useState<{ ok?: string; error?: string }>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, start] = useTransition();

  const dirty = !sameBrand(brand, saved);
  const set = (patch: StrutBrand, show?: Theme) => {
    setBrand((b) => clean({ ...b, ...patch }));
    setNote({});
    if (show) setTheme(show);
  };
  const save = (next: StrutBrand) =>
    start(async () => {
      const r = await saveBrand(next);
      setConfirmReset(false);
      if (r.error !== undefined) return setNote({ error: r.error });
      setSaved(clean(r.brand));
      setBrand(clean(r.brand));
      setNote({ ok: Object.keys(r.brand).length ? "Saved." : "Reset to the kit’s own look." });
    });

  // A radius or font strut holds that is not one of ours stays a choice.
  const radii =
    saved.radius && !RADII.some((r) => r.value === saved.radius)
      ? [...RADII, { name: saved.radius, value: saved.radius, px: parseFloat(saved.radius) * (/em$/.test(saved.radius) ? 16 : 1) }]
      : RADII;
  const fonts = saved.font && !FONTS.some((f) => f.value === saved.font) ? [...FONTS, { name: "Current", value: saved.font }] : FONTS;

  const ownDark = !!brand.colorDark;
  const darkShown = brand.colorDark ?? brand.color;

  return (
    <>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,330px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,370px)] xl:gap-10">
        <div className="lg:sticky lg:top-8 lg:order-2">
          <Preview brand={brand} theme={theme} onTheme={setTheme} />
        </div>

        <div className="@container flex min-w-0 flex-col gap-8 lg:order-1">
          <Group id="brand-color" title="Color" hint="Primary buttons, switches, the selected item and focus rings.">
            <ColorPicker
              label="Color"
              options={LIGHT}
              value={brand.color}
              onChange={(color) => set({ color }, "light")}
              withDefault
            />
            {brand.color && paleOnLight(brand.color) && (
              <Suggestion
                hex={deeperForLight(brand.color)}
                onUse={(color) => set({ color }, "light")}
                label="Use a deeper shade"
              >
                This color is pale on a white page, so its buttons can be hard to pick out. A deeper shade reads better:
              </Suggestion>
            )}
          </Group>

          <Group id="brand-dark" title="Dark theme" hint="Apps follow each person’s light or dark setting.">
            <label className={`flex items-start gap-3 text-[14.5px] text-ink ${brand.color || ownDark ? "" : "opacity-60"}`}>
              <input
                type="checkbox"
                checked={ownDark}
                disabled={!brand.color && !ownDark}
                onChange={(e) => set({ colorDark: e.target.checked ? darkFor(brand.color!) : undefined }, "dark")}
                className="mt-1 size-4 accent-[var(--accent)]"
              />
              <span className="flex flex-col gap-0.5">
                Use a different color in dark mode
                <span className="text-[13px] text-ink-3">
                  {ownDark ? (
                    "Lighter colors read best on a dark background."
                  ) : brand.color ? (
                    <>
                      Dark mode uses <ColorWord hex={brand.color} /> too.
                    </>
                  ) : (
                    "Pick a color above first. Until then dark mode keeps the kit’s light grey."
                  )}
                </span>
              </span>
            </label>

            {ownDark ? (
              <>
                <ColorPicker label="Dark mode color" options={DARK} value={brand.colorDark} onChange={(colorDark) => set({ colorDark }, "dark")} />
                {!brand.color && <p className="text-[13px] text-ink-3">With no color above, the light theme takes this one too.</p>}
              </>
            ) : null}
            {darkShown && darkOnDark(darkShown) && (
              <Suggestion
                hex={ownDark ? lighterForDark(darkShown) : darkFor(darkShown)}
                onUse={(colorDark) => set({ colorDark }, "dark")}
                label="Use it in dark mode"
              >
                {colorName(darkShown) ?? "This color"} is hard to see on a dark background. A lighter one reads better there:
              </Suggestion>
            )}
          </Group>

          <Group id="brand-corners" title="Corners" hint="Buttons, fields, cards and the selected item.">
            <div role="radiogroup" aria-labelledby="brand-corners" className="grid grid-cols-2 gap-1 self-start rounded-[12px] bg-raised p-1 @md:inline-flex">
              {radii.map((r) => {
                const on = (brand.radius || undefined) === r.value;
                return (
                  <button
                    key={r.name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set({ radius: r.value })}
                    className={`flex flex-col items-center gap-1.5 rounded-[9px] px-4 pt-3 pb-2 text-[12.5px] @md:min-w-[88px] transition-colors duration-150 ${
                      on ? "bg-surface font-medium text-ink shadow-soft" : "text-ink-3 hover:text-ink"
                    }`}
                  >
                    <svg width="46" height="30" viewBox="0 0 46 30" aria-hidden>
                      <rect x="1.5" y="1.5" width="43" height="27" rx={r.px * 0.75} fill={on ? "var(--accent-soft)" : "none"} stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    {r.name}
                  </button>
                );
              })}
            </div>
          </Group>

          <Group
            id="brand-font"
            title="Font"
            hint="Only fonts installed on each person’s machine show: an app loads no web fonts, and each list falls back to the next name."
          >
            <div role="radiogroup" aria-labelledby="brand-font" className="grid gap-2 @md:grid-cols-2">
              {fonts.map((f) => {
                const on = (brand.font || undefined) === f.value;
                return (
                  <button
                    key={f.name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set({ font: f.value })}
                    className={`flex min-w-0 flex-col items-start gap-1 rounded-[12px] border px-4 py-3 text-left transition-colors duration-150 ${
                      on ? "border-ink bg-surface shadow-[0_0_0_1px_var(--ink)]" : "border-rule bg-surface hover:border-rule-strong"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between gap-2 text-[12.5px] text-ink-3">
                      {f.name}
                      {on && <Check className="text-ink" />}
                    </span>
                    <span className="truncate text-[18px] leading-tight text-ink" style={{ fontFamily: f.value ?? KIT_FONT }}>
                      The quick brown fox
                    </span>
                  </button>
                );
              })}
            </div>
          </Group>
        </div>
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[14px] border border-rule bg-surface py-2.5 pr-2.5 pl-5 shadow-soft">
        <p aria-live="polite" className="text-[13px] text-ink-3">
          {confirmReset ? (
            <span className="text-ink">Reset every app to the kit’s own look?</span>
          ) : note.error ? (
            <span className="text-warn">{note.error}</span>
          ) : note.ok ? (
            <>
              <span className="text-ok">{note.ok}</span> Open apps pick it up when they reload.
            </>
          ) : dirty ? (
            <span className="text-ink">Not saved yet: only the preview shows it.</span>
          ) : (
            <span className="max-sm:hidden">Apps pick up a saved change the next time they load.</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {confirmReset ? (
            <>
              <button type="button" onClick={() => setConfirmReset(false)} className={buttonClass.quiet}>
                Cancel
              </button>
              <button type="button" disabled={pending} onClick={() => save({})} className={`${buttonClass.primary} h-9 px-3 text-[14px]`}>
                {pending ? "Resetting…" : "Reset"}
              </button>
            </>
          ) : (
            <>
              {dirty && (
                <button
                  type="button"
                  onClick={() => {
                    setBrand(saved);
                    setNote({});
                  }}
                  className={buttonClass.quiet}
                >
                  Discard
                </button>
              )}
              <button
                type="button"
                disabled={pending || (!Object.keys(saved).length && !Object.keys(brand).length)}
                onClick={() => {
                  setConfirmReset(true);
                  setNote({});
                }}
                className={buttonClass.quiet}
              >
                Reset to default
              </button>
              <button type="button" disabled={!dirty || pending} onClick={() => save(brand)} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
                {pending ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Group({ id, title, hint, children }: { id: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase md:text-[13px]">
          {title}
        </h2>
        <p className="text-[14px] text-ink-2">{hint}</p>
      </div>
      <div className="flex flex-col gap-4 rounded-[14px] border border-rule bg-surface p-5 md:p-6">{children}</div>
    </section>
  );
}

const RAINBOW = "conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #f43f5e)";
const KIT_DEFAULT = "linear-gradient(135deg, #171717 50%, #e5e5e5 50%)";
const ring = "ring-2 ring-ink ring-offset-2 ring-offset-surface";
const swatch =
  "relative grid size-9 shrink-0 place-items-center rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)] transition-transform duration-150 hover:scale-110 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

/**
 * A row of swatches, the kit's default first (where unset is a choice) and
 * a custom color last (the platform's own picker), with a hex field kept in
 * sync and the button text strut will pick for the color.
 */
function ColorPicker({
  label,
  options,
  value,
  onChange,
  withDefault,
}: {
  label: string;
  options: Array<{ name: string; hex: string }>;
  value: string | undefined;
  onChange: (hex: string | undefined) => void;
  withDefault?: boolean;
}) {
  const named = options.find((o) => o.hex === value);
  const custom = !!value && !named;
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={label} className="flex flex-wrap gap-2.5 p-1">
        {withDefault && (
          <button
            type="button"
            data-own-ring
            aria-pressed={!value}
            aria-label="Default"
            title="Default: the kit’s near-black, light grey in dark mode"
            onClick={() => onChange(undefined)}
            className={`${swatch} ${!value ? ring : ""}`}
            style={{ background: KIT_DEFAULT }}
          >
            {!value && <Check className="text-white mix-blend-difference" />}
          </button>
        )}
        {options.map((o) => (
          <button
            key={o.hex}
            type="button"
            data-own-ring
            aria-pressed={value === o.hex}
            aria-label={o.name}
            title={`${o.name} ${o.hex}`}
            onClick={() => onChange(o.hex)}
            className={`${swatch} ${value === o.hex ? ring : ""}`}
            style={{ background: o.hex }}
          >
            {value === o.hex && <Check style={{ color: textOn(o.hex) }} />}
          </button>
        ))}
        <span className={`relative size-9 shrink-0 rounded-full transition-transform duration-150 hover:scale-110 ${custom ? ring : ""}`} title="Any color">
          <input
            type="color"
            data-own-ring
            aria-label={`${label}: any color`}
            value={value ?? "#4f46e5"}
            onChange={(e) => onChange(parseHex(e.target.value) ?? undefined)}
            className="peer absolute inset-0 z-10 size-full rounded-full opacity-0"
          />
          <span aria-hidden className="absolute inset-0 rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent" style={{ background: RAINBOW }} />
          {custom && (
            <span aria-hidden className="absolute inset-[5px] grid place-items-center rounded-full" style={{ background: value }}>
              <Check style={{ color: textOn(value) }} />
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <HexField label={label} value={value} onChange={onChange} />
        <span className="text-[14px] text-ink">{named?.name ?? (custom ? "Custom" : "Default")}</span>
        {value ? <TextOn hex={value} /> : <span className="text-[13px] text-ink-3">The kit’s own: near-black buttons, light grey in dark mode.</span>}
      </div>
    </div>
  );
}

/**
 * `#rrggbb` applies as it is typed; `#rgb` once the field is left, so
 * typing a long one never flashes the short one it starts with.
 */
function HexField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (hex: string | undefined) => void }) {
  const [text, setText] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (parseHex(text) !== value) setText(value ?? "");
  }
  const commit = () => {
    const hex = parseHex(text);
    if (hex) {
      onChange(hex);
      setText(hex);
    } else setText(value ?? "");
  };
  const bad = text.trim() !== "" && !parseHex(text);
  return (
    <input
      aria-label={`${label}, hex`}
      value={text}
      placeholder="#rrggbb"
      spellCheck={false}
      autoComplete="off"
      maxLength={7}
      onChange={(e) => {
        setText(e.target.value);
        if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) onChange(parseHex(e.target.value)!);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        commit();
      }}
      aria-invalid={bad || undefined}
      className={`h-10 w-[116px] rounded-[10px] border bg-surface px-3 font-mono text-[14px] text-ink placeholder:text-ink-3 focus:outline-none ${
        bad ? "border-warn" : "border-rule-strong focus:border-ink-3"
      }`}
    />
  );
}

/** The text strut will put on the color, and how well it reads. */
function TextOn({ hex }: { hex: string }) {
  const text = textOn(hex);
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-3">
      <span className="inline-flex h-7 items-center rounded-md px-2.5 text-[12.5px] font-semibold" style={{ background: hex, color: text }}>
        Button
      </span>
      {text === "#ffffff" ? "White" : "Near-black"} text, {contrast(hex, text).toFixed(1)}:1
    </span>
  );
}

function Suggestion({
  hex,
  onUse,
  label,
  children,
}: {
  hex: string;
  onUse: (hex: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] bg-warn-soft px-4 py-3 text-[13.5px] text-ink-2">
      <span className="min-w-0 flex-[1_1_240px]">
        {children}{" "}
        <span className="inline-flex items-center gap-1.5 align-middle font-mono text-[13px] text-ink">
          <span aria-hidden className="inline-block size-3.5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: hex }} />
          {hex}
        </span>
      </span>
      <button
        type="button"
        onClick={() => onUse(hex)}
        className="inline-flex h-8 items-center rounded-lg border border-rule-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-ink-3"
      >
        {label}
      </button>
    </div>
  );
}

function ColorWord({ hex }: { hex: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span aria-hidden className="inline-block size-3 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: hex }} />
      {colorName(hex) ?? hex}
    </span>
  );
}

function Check({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className} style={style}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}
