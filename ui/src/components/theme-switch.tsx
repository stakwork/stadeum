"use client";

import { useEffect, useState } from "react";

import { applyTheme, readTheme, type Theme } from "@/lib/theme";

const LABEL: Record<Theme, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };
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

/** Three icon segments, one per choice. */
export function ThemeSegments() {
  const [theme, set] = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex gap-0.5 rounded-lg bg-raised p-0.5">
      {ORDER.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          aria-label={LABEL[t]}
          title={LABEL[t]}
          onClick={() => set(t)}
          className={`grid h-7 w-8 place-items-center rounded-md transition-colors duration-150 ${
            theme === t ? "bg-surface text-ink shadow-soft" : "text-ink-3 hover:text-ink"
          }`}
        >
          <Icon theme={t} />
        </button>
      ))}
    </div>
  );
}
