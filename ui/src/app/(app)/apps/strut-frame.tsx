"use client";

import { useEffect, useState } from "react";

/**
 * A strut app's page, framed for one person. Strut posts
 * `{type: "strut:location", params}` as the person moves inside the app;
 * mirroring its `input` (the app's own deep link, e.g. `session=<id>`)
 * into our URL makes a reload or a shared link land on the same place.
 */
export function StrutFrame({ src, origin, title }: { src: string; origin: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  // Set after mount: an iframe that loads before hydration never reports onLoad.
  const [frameSrc, setFrameSrc] = useState<string | undefined>(undefined);
  useEffect(() => setFrameSrc(src), [src]);

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
        src={frameSrc}
        title={title}
        onLoad={() => frameSrc && setLoaded(true)}
        className={`absolute inset-0 size-full transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
        allow="clipboard-write; microphone"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
