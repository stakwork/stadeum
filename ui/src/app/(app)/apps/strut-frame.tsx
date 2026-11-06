"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { shownTheme } from "@/lib/theme";

/**
 * A strut app's page, framed for one person, in the theme stadeum shows
 * (`&theme=`, which strut reads once). Strut posts
 * `{type: "strut:location", params}` as the person moves inside the app;
 * mirroring its `input` (the app's own deep link, e.g. `session=<id>`)
 * into our URL makes a reload or a shared link land on the same place.
 *
 * The frame stays hidden until the app is on screen, then fades in: strut
 * posts `{type: "strut:ready"}` once the app's page has started (strut
 * `specs/API.md` §14.3). The frame's own load is only strut's page, whose
 * background and "Loading the app…" would flash first. A strut that never
 * says so is shown a few seconds after its page loads; a slow one gets a
 * quiet "Opening…" after a second.
 */
export function StrutFrame({ src, origin, title }: { src: string; origin: string; title: string }) {
  const router = useRouter();
  const ref = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [pageLoaded, setPageLoaded] = useState(false);
  // Set after mount: an iframe that loads before hydration never reports
  // onLoad, and the theme lives in this browser, not on the server.
  const [frame, setFrame] = useState<{ src: string; theme: "light" | "dark" } | undefined>(undefined);
  useEffect(() => {
    const theme = shownTheme();
    const url = new URL(src);
    url.searchParams.set("theme", theme);
    // Hidden until the app is on screen, a reload too.
    setLoaded(false);
    setPageLoaded(false);
    setSlow(false);
    setFrame({ src: url.toString(), theme });
    const slowly = setTimeout(() => setSlow(true), 1000);
    return () => clearTimeout(slowly);
  }, [src]);

  // A strut that never posts `strut:ready` (one older than it) is shown anyway.
  useEffect(() => {
    if (!pageLoaded || loaded) return;
    const fallback = setTimeout(() => setLoaded(true), 3000);
    return () => clearTimeout(fallback);
  }, [pageLoaded, loaded]);

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
      if (e.origin !== origin || e.source !== ref.current?.contentWindow) return;
      const data = e.data as { type?: string; params?: Record<string, string> } | null;
      if (data?.type === "strut:ready") setLoaded(true);
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
      <p
        className={`absolute inset-0 grid place-items-center text-[14.5px] text-ink-3 transition-opacity duration-300 ${slow && !loaded ? "opacity-100" : "opacity-0"}`}
      >
        Opening {title}…
      </p>
      <iframe
        ref={ref}
        src={frame?.src}
        title={title}
        onLoad={() => frame && setPageLoaded(true)}
        className={`absolute inset-0 size-full transition-opacity duration-150 ease-out ${loaded ? "opacity-100" : "opacity-0"}`}
        allow="clipboard-write; microphone"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
