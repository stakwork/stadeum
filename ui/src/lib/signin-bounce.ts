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
 * Auth.js compares the state with its own cookie. The connect seam
 * (lib/connect.ts) labels its own state the same way, and comes back to the
 * bounce's `/api/connect/<provider>/callback`.
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

/** A state with this box's label in front, when there is a bounce. */
export function label(state: string): string {
  const b = bounce();
  return b ? `${b.label}.${state}` : state;
}

/** A state that came back through the bounce, without this box's label; any other state as it is. */
export function unlabel(state: string): string {
  const b = bounce();
  return b && state.startsWith(`${b.label}.`) ? state.slice(b.label.length + 1) : state;
}

/** The provider's authorization URL, with this box's label in front of its state. */
export function labelState(authorizationUrl: string): string {
  if (!bounce()) return authorizationUrl;
  const url = new URL(authorizationUrl);
  const state = url.searchParams.get("state");
  if (!state) return authorizationUrl;
  url.searchParams.set("state", label(state));
  return url.toString();
}

/** A callback that came through the bounce, its state without this box's label. */
export function unlabelState(req: NextRequest): NextRequest {
  const state = req.nextUrl.searchParams.get("state");
  if (!state || !req.nextUrl.pathname.includes("/callback/")) return req;
  const bare = unlabel(state);
  if (bare === state) return req;
  const url = new URL(req.nextUrl);
  url.searchParams.set("state", bare);
  return new NextRequest(url, req);
}
