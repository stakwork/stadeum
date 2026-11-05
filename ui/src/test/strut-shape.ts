/**
 * Strut's delegation shape check, copied from strut
 * `src/mothership.ts:123-161` (`checkDelegationMacaroon`) so tests and the
 * fake lab apply exactly the rules the real `PUT /llm/delegations` does.
 */
import { decodeMacaroon } from "gatekey";

const STRUT_AGENT = "strut-agent";

export function checkDelegationShape(encoded: string): { delegationId: string; exp: string; ceilingUsd: number } {
  let m;
  try {
    m = decodeMacaroon(encoded);
  } catch (err) {
    throw new Error(`macaroon does not decode: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (m.v !== 1) throw new Error(`macaroon v=${String(m.v)}; expected 1`);
  const ua = m.user_authorization;
  const inv = m.invocation;
  if (!ua || typeof ua !== "object" || !inv || typeof inv !== "object") {
    throw new Error("macaroon must carry a user_authorization and an invocation");
  }
  if (!Array.isArray(m.attenuations) || m.attenuations.length > 0) {
    throw new Error("a delegation must carry no attenuations — strut appends its own");
  }
  if (!Array.isArray(inv.agents) || !inv.agents.includes(STRUT_AGENT)) {
    throw new Error(`the invocation must authorize agent "${STRUT_AGENT}"`);
  }
  if (inv.max_steps !== 0) {
    throw new Error(`the invocation's max_steps must be 0 (no call-count cap); got ${String(inv.max_steps)}`);
  }
  if (typeof inv.max_cost_usd !== "number" || !(inv.max_cost_usd > 0)) {
    throw new Error("the invocation's max_cost_usd (the delegation ceiling) must be a positive number");
  }
  if (typeof inv.run_id !== "string" || !inv.run_id) {
    throw new Error("the invocation must carry a run_id (the delegation id)");
  }
  for (const [what, exp] of [
    ["user_authorization", ua.exp],
    ["invocation", inv.exp],
  ] as const) {
    if (typeof exp !== "string" || !Number.isFinite(Date.parse(exp))) {
      throw new Error(`the ${what}'s exp is not a timestamp`);
    }
  }
  const exp = Date.parse(ua.exp) <= Date.parse(inv.exp) ? ua.exp : inv.exp;
  return { delegationId: inv.run_id, exp, ceilingUsd: inv.max_cost_usd };
}
