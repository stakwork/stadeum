"use client";

import { useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";

import { shownTheme } from "@/lib/theme";
import { openApp } from "./open";

/**
 * A strut app's page, framed for one person, in the theme stadeum shows
 * (`&theme=`, which strut reads once).
 *
 * Where the person is in the app is its `input` (the app's own deep link,
 * e.g. `session=<id>`). Strut posts `{type: "strut:location", params}` as
 * the person moves, and the URL follows (`?input=`), so a reload or a
 * shared link lands on the same place. The URL leads only with an `input`
 * that is not where the app is: that link is followed, with a fresh open
 * (strut takes no new input from its host). A URL with none leaves the
 * app where it is and takes its place: the rail's link back to an app
 * returns to it, not to its start.
 *
 * `shown` is whether the frame is the page on screen. Hidden, it stays
 * mounted with the app in it and leaves the URL alone: the assistant's
 * frame is the (app) layout's (`HomeFrame`), so leaving the home and
 * coming back is instant, with nothing typed in it lost.
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
export function StrutFrame({
  app,
  input,
  origin,
  title,
  shown = true,
}: {
  app: string;
  input?: string;
  origin: string;
  title: string;
  shown?: boolean;
}) {
  preconnect(origin);
  const ref = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState<string | undefined>(undefined);
  // Counts the opens after the first: a new deep link.
  const [opening, setOpening] = useState(0);
  // Read after mount: the theme lives in this browser, not on the server.
  const [theme, setTheme] = useState<"light" | "dark" | undefined>(undefined);
  // Where the person is in the app: the first `input`, then what strut reports.
  const where = useRef(input);

  // A deep link that is not where the app is: go there, with a fresh open.
  useEffect(() => {
    if (input === undefined || input === where.current) return;
    where.current = input;
    setOpening((n) => n + 1);
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
  }, [app, theme, opening]);

  // A strut that never posts `strut:ready` (one older than it) is shown anyway.
  useEffect(() => {
    if (!pageLoaded || loaded) return;
    const fallback = setTimeout(() => setLoaded(true), 3000);
    return () => clearTimeout(fallback);
  }, [pageLoaded, loaded]);

  // The URL follows the app while it is the page on screen.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== origin || e.source !== ref.current?.contentWindow) return;
      const data = e.data as { type?: string; params?: Record<string, string> } | null;
      if (data?.type === "strut:ready") setLoaded(true);
      if (data?.type !== "strut:location") return;
      where.current = data.params?.input;
      if (shown) follow(where.current);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, shown]);

  // On screen at a URL without an input (back from another page, the
  // rail's link): the URL takes the app's place.
  useEffect(() => {
    if (shown && input === undefined && where.current) follow(where.current);
  }, [shown, input]);

  if (failed) return shown ? <CannotOpen title={title} /> : null;
  return (
    // `data-bleed`: the layout's <main> drops its padding and width cap around it.
    <div data-bleed={shown || undefined} hidden={!shown} className="relative min-h-[420px] flex-1 overflow-hidden">
      {!loaded && <p className="opening absolute inset-0 grid place-items-center text-[14.5px] text-ink-3">Opening {title}…</p>}
      {/* Each address gets its own frame: a frame's first load leaves no
          history entry, a second would, and Back is the page's to keep. */}
      <iframe
        key={src ?? "none"}
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

/**
 * `?input=` on the address bar, replaced in place: the app's place, or none.
 * With a null state Next's router sees the change (`useSearchParams`) and
 * fetches nothing; its own state handed back would slip past it.
 */
function follow(input: string | undefined) {
  const url = new URL(window.location.href);
  if (input) url.searchParams.set("input", input);
  else url.searchParams.delete("input");
  if (url.href !== window.location.href) window.history.replaceState(null, "", url);
}

export function CannotOpen({ title }: { title: string }) {
  return (
    <p className="rounded-xl border border-dashed border-dash px-5 py-10 text-center text-[14.5px] text-ink-2">
      {title} can&rsquo;t open right now.
    </p>
  );
}
