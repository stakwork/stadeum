"use client";

import { useEffect, useState } from "react";

/**
 * The Strut web UI, embedded for one person. Strut posts
 * `{type: "strut:location", params}` as the person navigates inside it;
 * mirroring `run` into our URL makes a reload or a shared link land on
 * the same run.
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
      const run = data.params?.run;
      if (run) url.searchParams.set("run", run);
      else url.searchParams.delete("run");
      window.history.replaceState(null, "", url);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

  return (
    <div className="relative h-[calc(100dvh-210px)] min-h-[480px] overflow-hidden rounded-2xl border border-rule bg-surface">
      {!loaded && (
        <p className="absolute inset-0 grid place-items-center text-[14.5px] text-ink-3">Opening {title}…</p>
      )}
      <iframe
        src={frameSrc}
        title={title}
        onLoad={() => frameSrc && setLoaded(true)}
        className={`relative size-full transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
        allow="clipboard-write; microphone"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
