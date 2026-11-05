"use client";

import { kitTokens, themeColor, type Theme } from "@/lib/brand";
import type { StrutBrand } from "@/lib/strut/client";

/**
 * A small app drawn the way strut's kit draws one (shadcn's button,
 * switch, input, card, badge, sidebar and progress), every color and
 * corner read from the `--k-*` tokens `kitTokens` sets on the wrapper: the
 * brand's variables where it sets them, the kit's defaults where it does
 * not. Nothing is saved or sent to draw it.
 */
export function Preview({ brand, theme, onTheme }: { brand: StrutBrand; theme: Theme; onTheme: (t: Theme) => void }) {
  const tokens = {
    ...kitTokens(brand, theme),
    "--k-radius-sm": "calc(var(--k-radius) - 4px)",
    "--k-radius-md": "calc(var(--k-radius) - 2px)",
    "--k-radius-xl": "calc(var(--k-radius) + 4px)",
    fontFamily: "var(--k-font)",
    colorScheme: theme,
  } as React.CSSProperties;
  const dark = theme === "dark";

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase md:text-[13px]">Preview</h2>
        <div role="radiogroup" aria-label="Preview theme" className="inline-flex gap-0.5 rounded-lg bg-raised p-0.5">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              onClick={() => onTheme(t)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors duration-150 ${
                theme === t ? "bg-surface text-ink shadow-soft" : "text-ink-3 hover:text-ink"
              }`}
            >
              <span aria-hidden className="size-2.5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: themeColor(brand, t) }} />
              {t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>

      <div
        aria-label={`An app in the ${theme} theme, as the brand would draw it`}
        role="img"
        style={tokens}
        className="grid min-h-[360px] grid-cols-[104px_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-rule bg-(--k-background) text-[13px] leading-snug text-(--k-foreground) shadow-soft @md:grid-cols-[120px_minmax(0,1fr)]"
      >
        <aside className="flex flex-col gap-0.5 border-r border-(--k-border) bg-(--k-sidebar) p-2">
          <span className="flex items-center gap-2 px-2 pt-1 pb-2.5 font-semibold">
            <span className="grid size-5 place-items-center rounded-(--k-radius-sm) bg-(--k-primary) text-[10px] text-(--k-primary-foreground)">A</span>
            Acme
          </span>
          {["Overview", "Invoices", "Clients", "Reports"].map((item) => (
            <span
              key={item}
              className={`flex h-8 items-center rounded-(--k-radius-md) px-2 ${
                item === "Invoices" ? "bg-(--k-sidebar-primary) font-medium text-(--k-sidebar-primary-foreground)" : "opacity-80"
              }`}
            >
              {item}
            </span>
          ))}
        </aside>

        <div className="flex min-w-0 flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] font-semibold">Invoices</span>
            <span className="inline-flex h-7 items-center rounded-(--k-radius) bg-(--k-muted) p-[3px] text-[12px]">
              <span className={`rounded-(--k-radius-md) px-2 py-0.5 font-medium shadow-sm ${dark ? "border border-(--k-input) bg-(--k-input)/30" : "bg-(--k-background)"}`}>
                Open
              </span>
              <span className="px-2 py-0.5 text-(--k-muted-foreground)">Paid</span>
            </span>
          </div>

          <div className="flex flex-col gap-3 rounded-(--k-radius-xl) border border-(--k-border) bg-(--k-card) p-3.5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">INV-1042</span>
              <span className="rounded-(--k-radius-md) bg-(--k-primary) px-2 py-0.5 text-[11px] font-medium text-(--k-primary-foreground)">Sent</span>
            </div>
            <span className="text-(--k-muted-foreground)">Northwind Traders · $4,200</span>
            <span className="flex items-center gap-2.5">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-(--k-primary)/20">
                <span className="block h-full w-[64%] rounded-full bg-(--k-primary)" />
              </span>
              <span className="text-[12px] text-(--k-muted-foreground) tabular-nums">64%</span>
            </span>
          </div>

          <span className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium">Client</span>
            <span
              className={`flex h-9 items-center rounded-(--k-radius-md) border border-(--k-ring) px-3 ring-[3px] ring-(--k-ring)/50 ${dark ? "bg-(--k-input)/30" : "bg-(--k-background)"}`}
            >
              Northwind Traders<span aria-hidden className="ml-px h-4 w-px animate-pulse bg-(--k-foreground)" />
            </span>
          </span>

          <span className="flex items-center gap-2.5">
            <span className="inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full bg-(--k-primary) p-px">
              <span className={`size-4 translate-x-[calc(100%-2px)] rounded-full ${dark ? "bg-(--k-primary-foreground)" : "bg-(--k-background)"}`} />
            </span>
            Email a reminder
          </span>

          <span className="mt-auto flex flex-wrap gap-2">
            <span className="inline-flex h-9 items-center rounded-(--k-radius-md) bg-(--k-primary) px-4 font-medium text-(--k-primary-foreground) shadow-xs">
              Send invoice
            </span>
            <span
              className={`inline-flex h-9 items-center rounded-(--k-radius-md) border px-4 font-medium shadow-xs ${
                dark ? "border-(--k-input) bg-(--k-input)/30" : "border-(--k-border) bg-(--k-background)"
              }`}
            >
              Cancel
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
