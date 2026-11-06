import type { App } from "@/lib/apps";
import { env } from "@/lib/env";
import { StrutFrame } from "./strut-frame";

export { CannotOpen } from "./strut-frame";

/**
 * A strut app, framed: strut's own host page showing the app alone,
 * signed in as this person with a fresh one-use ticket the frame asks for
 * as it opens (`openApp`). It fills the page beside the rail, with nothing
 * of stadeum's around it: stadeum never draws an app (AGENTS.md rule 2).
 */
export function AppFrame({ app, input }: { app: Pick<App, "name" | "title">; input?: string }) {
  return <StrutFrame app={app.name} input={input} origin={new URL(env.strutPublicUrl()).origin} title={app.title} />;
}
