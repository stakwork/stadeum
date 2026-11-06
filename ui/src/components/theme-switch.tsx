"use client";

import { useEffect, useState } from "react";

import { applyTheme, readTheme, type Theme } from "@/lib/theme";

const LABEL: Record<Theme, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
};
const ORDER: Theme[] = ["system", "light", "dark"];

function Icon({ theme }: { theme: Theme }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (theme === "light") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg {...common}>
        <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <path d="M6 13.5h4M8 11v2.5" />
    </svg>
  );
}

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("system");
  // The head script has already applied the stored choice; mirror it after mount.
  useEffect(() => setTheme(readTheme()), []);
  return [
    theme,
    (t) => {
      applyTheme(t);
      setTheme(t);
    },
  ];
}

/** One quiet icon button that steps System → Light → Dark. */
export function ThemeButton({ className = "" }: { className?: string }) {
  const [theme, set] = useTheme();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
  return (
    <button
      type="button"
      aria-label={`${LABEL[theme]}. Switch to ${LABEL[next].toLowerCase()}`}
      title={LABEL[theme]}
      onClick={() => set(next)}
      className={`grid size-9 place-items-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink ${className}`}
    >
      <Icon theme={theme} />
    </button>
  );
}

const NAME: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** A small drawing of the app in one scheme. Its colours are the scheme's own, whatever the page shows. */
function Sketch({ scheme }: { scheme: "light" | "dark" }) {
  const c =
    scheme === "light"
      ? {
          paper: "bg-[#f6f4ee]",
          surface: "bg-[#ffffff]",
          rule: "border-[#e4e0d6]",
          line: "bg-[#d6d1c4]",
          on: "bg-[#ece8de]",
        }
      : {
          paper: "bg-[#161513]",
          surface: "bg-[#1f1e1b]",
          rule: "border-[#34322d]",
          line: "bg-[#46433c]",
          on: "bg-[#2a2824]",
        };
  return (
    <span className={`absolute inset-0 flex ${c.paper}`}>
      <span className={`flex w-[30%] flex-col gap-1.5 border-r p-2 ${c.rule}`}>
        <span className={`h-1.5 w-3/5 rounded-full ${c.line}`} />
        <span className={`mt-1 h-2.5 rounded ${c.on}`} />
        <span className={`h-1.5 w-4/5 rounded-full ${c.line}`} />
        <span className={`h-1.5 w-3/5 rounded-full ${c.line}`} />
      </span>
      <span className={`m-2 flex flex-1 flex-col gap-1.5 rounded-md p-2 ${c.surface}`}>
        <span className={`h-2 w-1/2 rounded-full ${c.line}`} />
        <span className={`h-1.5 w-4/5 rounded-full ${c.line}`} />
        <span className={`h-1.5 w-3/5 rounded-full ${c.line}`} />
      </span>
    </span>
  );
}

/** The theme as three cards, each a sketch of the app in that scheme. System shows both. */
export function ThemeCards() {
  const [theme, set] = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3 md:gap-4">
      {ORDER.map((t) => {
        const on = theme === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => set(t)}
            className={`flex flex-col gap-3 rounded-[14px] bg-surface p-2.5 text-left transition-[border-color,transform] duration-150 active:scale-[0.99] md:p-3 ${
              on ? "border-2 border-accent" : "m-px border border-rule hover:border-rule-strong"
            }`}
          >
            <span className="relative block h-20 overflow-hidden rounded-lg border border-rule md:h-24">
              <Sketch scheme={t === "dark" ? "dark" : "light"} />
              {t === "system" && (
                <span className="absolute inset-0 [clip-path:polygon(60%_0,100%_0,100%_100%,40%_100%)]">
                  <Sketch scheme="dark" />
                </span>
              )}
            </span>
            <span className="flex items-center justify-between gap-2 px-0.5 text-[14px] font-medium text-ink">
              <span className="flex items-center gap-2">
                <Icon theme={t} />
                {NAME[t]}
              </span>
              <span
                aria-hidden
                className={`size-2.5 rounded-full ${on ? "bg-accent" : "border-[1.5px] border-rule-strong"}`}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
