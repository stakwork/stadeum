import type { App } from "@/lib/apps";
import { env } from "@/lib/env";
import { ensureDelegation } from "@/lib/mothership/delegation";
import { requireUser } from "@/lib/session";
import { embedUrl } from "@/lib/strut/client";
import { StrutFrame } from "./strut-frame";

/**
 * A strut app, framed: strut's own host page showing the app alone,
 * signed in as this person with a fresh one-use ticket. It fills the page
 * beside the rail, with nothing of stadeum's around it: stadeum never
 * draws an app (AGENTS.md rule 2).
 */
export async function AppFrame({ app, input }: { app: Pick<App, "name" | "title">; input?: string }) {
  const user = await requireUser();
  // Renews past half-life, as Hive does on every embed. Never throws.
  await ensureDelegation(user);
  const src = await embedUrl(user.actor, app.name, input).catch((err: unknown) => {
    console.warn(`[apps] no frame for ${app.name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (!src) return <CannotOpen title={app.title} />;
  return <StrutFrame src={src} origin={new URL(env.strutPublicUrl()).origin} title={app.title} />;
}

export function CannotOpen({ title }: { title: string }) {
  return (
    <p className="rounded-xl border border-dashed border-dash px-5 py-10 text-center text-[14.5px] text-ink-2">
      {title} can&rsquo;t open right now.
    </p>
  );
}
