import type { App } from "@/lib/apps";
import { env } from "@/lib/env";
import { StrutFrame } from "./strut-frame";

export { CannotOpen } from "./strut-frame";

/** Where the browser loads strut's UI from: the frame's origin, which its messages are checked against. */
export function strutOrigin() {
  return new URL(env.strutPublicUrl()).origin;
}

/**
 * A strut app, framed: strut's own host page showing the app alone,
 * signed in as this person with a fresh one-use ticket the frame asks for
 * as it opens (`openApp`). It fills the page beside the rail, with nothing
 * of stadeum's around it: stadeum never draws an app (AGENTS.md rule 2).
 * The assistant's frame is not a page's but the layout's (`HomeFrame`).
 */
export function AppFrame({ app, input }: { app: Pick<App, "name" | "title">; input?: string }) {
  return <StrutFrame app={app.name} input={input} origin={strutOrigin()} title={app.title} />;
}
