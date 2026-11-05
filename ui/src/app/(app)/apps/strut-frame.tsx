"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { shownTheme } from "@/lib/theme";

/**
 * A strut app's page, framed for one person, in the theme stadeum shows
 * (`&theme=`, which strut reads once). Strut posts
 * `{type: "strut:location", params}` as the person moves inside the app;
 * mirroring its `input` (the app's own deep link, e.g. `session=<id>`)
 * into our URL makes a reload or a shared link land on the same place.
 */
export function StrutFrame({ src, origin, title }: { src: string; origin: string; title: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  // Set after mount: an iframe that loads before hydration never reports
  // onLoad, and the theme lives in this browser, not on the server.
  const [frame, setFrame] = useState<{ src: string; theme: "light" | "dark" } | undefined>(undefined);
  useEffect(() => {
    const theme = shownTheme();
    const url = new URL(src);
    url.searchParams.set("theme", theme);
    // Hidden until it loads, a reload too: strut's page starts dark.
    setLoaded(false);
    setFrame({ src: url.toString(), theme });
  }, [src]);

  // A new theme needs a new frame, and a new frame a new ticket: re-render
  // the page, which mints one.
  const frameTheme = frame?.theme;
  useEffect(() => {
    if (!frameTheme) return;
    const check = () => {
      if (shownTheme() !== frameTheme) router.refresh();
    };
    const choice = new MutationObserver(check);
    choice.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    system.addEventListener("change", check);
    return () => {
      choice.disconnect();
      system.removeEventListener("change", check);
    };
  }, [frameTheme, router]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== origin) return;
      const data = e.data as { type?: string; params?: Record<string, string> } | null;
      if (data?.type !== "strut:location") return;
      const url = new URL(window.location.href);
      const input = data.params?.input;
      if (input) url.searchParams.set("input", input);
      else url.searchParams.delete("input");
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

  return (
    // `data-bleed`: the layout's <main> drops its padding and width cap around it.
    <div data-bleed className="relative min-h-[420px] flex-1 overflow-hidden">
      {!loaded && (
        <p className="absolute inset-0 grid place-items-center text-[14.5px] text-ink-3">Opening {title}…</p>
      )}
      <iframe
        src={frame?.src}
        title={title}
        onLoad={() => frame && setLoaded(true)}
        className={`absolute inset-0 size-full transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
        allow="clipboard-write; microphone"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
