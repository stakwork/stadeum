"use client";

import { useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";

import { shownTheme } from "@/lib/theme";
import { openApp } from "./open";

/**
 * A strut app's page, framed for one person, in the theme stadeum shows
 * (`&theme=`, which strut reads once). Strut posts
 * `{type: "strut:location", params}` as the person moves inside the app;
 * mirroring its `input` (the app's own deep link, e.g. `session=<id>`)
 * into our URL makes a reload or a shared link land on the same place.
 *
 * The frame asks for its address each time it opens (`openApp`), with a
 * one-use ticket minted then. The server's render never carries one: Next
 * shows a page it already has again (Back, a page a redirect rendered)
 * without rendering it, and the ticket in it would be spent.
 *
 * The frame stays hidden until the app is on screen, then fades in: strut
 * posts `{type: "strut:ready"}` once the app's page has started (strut
 * `specs/API.md` §14.3). The frame's own load is only strut's page, whose
 * background and "Loading the app…" would flash first. A strut that never
 * says so is shown a few seconds after its page loads.
 *
 * An open is the ticket, strut's page and sign-in, the app's files and the
 * app's own start: a second or two, with nothing where the app will be. A
 * notice timed inside that wait blinked: it came, and the app covered it.
 * "Opening…" starts to show only when the wait has grown long, and comes in
 * slowly (`.opening`, globals.css), so an app that arrives meanwhile covers
 * a faint word at most. The connection to strut is opened as the frame
 * mounts, while the ticket is minted.
 */
export function StrutFrame({ app, input, origin, title }: { app: string; input?: string; origin: string; title: string }) {
  preconnect(origin);
  const ref = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState<string | undefined>(undefined);
  // Read after mount: the theme lives in this browser, not on the server.
  const [theme, setTheme] = useState<"light" | "dark" | undefined>(undefined);
  // Where the person is in the app: the page's `input`, then what strut reports.
  const where = useRef(input);

  useEffect(() => {
    where.current = input;
  }, [input]);

  // A new theme needs a new frame, so a new ticket.
  useEffect(() => {
    const check = () => setTheme(shownTheme());
    check();
    const choice = new MutationObserver(check);
    choice.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    system.addEventListener("change", check);
    return () => {
      choice.disconnect();
      system.removeEventListener("change", check);
    };
  }, []);

  // Each opening asks for a fresh ticket; hidden until the app is on screen.
  useEffect(() => {
    if (!theme) return;
    let gone = false;
    setLoaded(false);
    setPageLoaded(false);
    setFailed(false);
    setSrc(undefined);
    openApp(app, where.current).then(
      (opened) => {
        if (gone) return;
        if ("error" in opened) return setFailed(true);
        const url = new URL(opened.src);
        url.searchParams.set("theme", theme);
        setSrc(url.toString());
      },
      () => !gone && setFailed(true),
    );
    return () => {
      gone = true;
    };
  }, [app, input, theme]);

  // A strut that never posts `strut:ready` (one older than it) is shown anyway.
  useEffect(() => {
    if (!pageLoaded || loaded) return;
    const fallback = setTimeout(() => setLoaded(true), 3000);
    return () => clearTimeout(fallback);
  }, [pageLoaded, loaded]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== origin || e.source !== ref.current?.contentWindow) return;
      const data = e.data as { type?: string; params?: Record<string, string> } | null;
      if (data?.type === "strut:ready") setLoaded(true);
      if (data?.type !== "strut:location") return;
      const input = data.params?.input;
      where.current = input;
      const url = new URL(window.location.href);
      if (input) url.searchParams.set("input", input);
      else url.searchParams.delete("input");
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

  if (failed) return <CannotOpen title={title} />;
  return (
    // `data-bleed`: the layout's <main> drops its padding and width cap around it.
    <div data-bleed className="relative min-h-[420px] flex-1 overflow-hidden">
      {!loaded && <p className="opening absolute inset-0 grid place-items-center text-[14.5px] text-ink-3">Opening {title}…</p>}
      <iframe
        ref={ref}
        src={src}
        title={title}
        onLoad={() => src && setPageLoaded(true)}
        className={`absolute inset-0 size-full transition-opacity duration-150 ease-out ${loaded ? "opacity-100" : "opacity-0"}`}
        allow="clipboard-write; microphone"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

export function CannotOpen({ title }: { title: string }) {
  return (
    <p className="rounded-xl border border-dashed border-dash px-5 py-10 text-center text-[14.5px] text-ink-2">
      {title} can&rsquo;t open right now.
    </p>
  );
}
