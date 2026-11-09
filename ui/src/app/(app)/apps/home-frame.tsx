"use client";

import { usePathname, useSearchParams } from "next/navigation";

import type { App } from "@/lib/apps";
import { StrutFrame } from "./strut-frame";

/**
 * The assistant's frame, held by the (app) layout above every page: shown
 * on the home, kept open but hidden everywhere else, so coming back is
 * instant and nothing typed in it is lost. The home's `?input=` is read
 * here, as a layout gets no search params; off the home the frame gets
 * none and leaves the URL alone.
 */
export function HomeFrame({ app, origin }: { app: Pick<App, "name" | "title">; origin: string }) {
  const shown = usePathname() === "/";
  const input = useSearchParams().get("input");
  return <StrutFrame app={app.name} title={app.title} origin={origin} shown={shown} input={shown && input ? input : undefined} />;
}
