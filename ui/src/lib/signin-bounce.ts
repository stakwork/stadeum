import { NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * Sign-in through a bounce (`STADEUM_SIGNIN_BOUNCE`; docs/stack-spec.md,
 * "Sign-in through a bounce"). Google takes no wildcard in a redirect URL
 * and has no API to add one, so boxes under one domain cannot each register
 * their own. They share the bounce's instead.
 *
 * Auth.js sends the provider to the bounce on both legs: the authorization's
 * `redirect_uri`, and the code exchange that must repeat it. The box puts its
 * label in front of the OAuth `state` on the way out (`acme.<state>`). The
 * bounce reads it and redirects to `https://acme.<its domain>` with the path
 * and query unchanged. On the way back the box takes the label off, before
 * Auth.js compares the state with its own cookie.
 */

type Bounce = { origin: string; label: string };

/** The bounce, when one is set and this box has a label: its host's first name. */
export function bounce(): Bounce | undefined {
  const origin = env.signinBounce();
  if (!origin) return undefined;
  const host = new URL(env.publicUrl()).hostname;
  const dot = host.indexOf(".");
  if (dot <= 0) return undefined;
  return { origin, label: host.slice(0, dot) };
}

/** A provider's options: its redirect URL becomes the bounce's. */
export function bounceOptions(): { redirectProxyUrl?: string } {
  const b = bounce();
  return b ? { redirectProxyUrl: `${b.origin}/api/auth` } : {};
}

/** The provider's authorization URL, with this box's label in front of its state. */
export function labelState(authorizationUrl: string): string {
  const b = bounce();
  if (!b) return authorizationUrl;
  const url = new URL(authorizationUrl);
  const state = url.searchParams.get("state");
  if (!state) return authorizationUrl;
  url.searchParams.set("state", `${b.label}.${state}`);
  return url.toString();
}

/** A callback that came through the bounce, its state without this box's label. */
export function unlabelState(req: NextRequest): NextRequest {
  const b = bounce();
  const state = req.nextUrl.searchParams.get("state");
  if (!b || !state?.startsWith(`${b.label}.`) || !req.nextUrl.pathname.includes("/callback/")) return req;
  const url = new URL(req.nextUrl);
  url.searchParams.set("state", state.slice(b.label.length + 1));
  return new NextRequest(url, req);
}
