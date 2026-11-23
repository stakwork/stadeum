/**
 * Strut's delegation shape check for a macaroon v2, after strut
 * `src/mothership.ts` (`checkDelegationMacaroon`), so tests and the fake
 * strut apply the rules the real `PUT /llm/delegations` does: the org's
 * grant (block 0) and strut's own block (block 1), nothing appended yet.
 */
import { decodeToken, type Token } from "gatekey";

const STRUT_AGENT = "strut-agent";

export function checkDelegationShape(encoded: string): { delegationId: string; exp: string; ceilingUsd: number } {
  let m: Token;
  try {
    m = decodeToken(encoded);
  } catch (err) {
    throw new Error(`macaroon does not decode: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (m.v !== 2) throw new Error(`macaroon v=${String(m.v)}; expected 2`);
  if (!Array.isArray(m.blocks) || m.blocks.length !== 2) {
    throw new Error("a delegation must be two blocks, the org's grant and strut's — strut appends its own");
  }
  if (typeof m.proof !== "string" || !m.proof) throw new Error("a delegation must carry its proof key");
  const grant = m.blocks[0]!.caveats;
  const own = m.blocks[1]!.caveats;
  if (!grant.user_id) throw new Error("block 0 must name the person (user_id)");
  if (own.agent !== STRUT_AGENT) throw new Error(`block 1 must hand the run to agent "${STRUT_AGENT}"`);
  if (typeof own.max_cost_usd !== "number" || !(own.max_cost_usd > 0)) {
    throw new Error("block 1's max_cost_usd (the delegation ceiling) must be a positive number");
  }
  if (typeof own.run_id !== "string" || !own.run_id) throw new Error("block 1 must carry a run_id (the delegation id)");
  for (const [i, c] of [grant, own].entries()) {
    if (typeof c.exp !== "string" || !Number.isFinite(Date.parse(c.exp))) throw new Error(`block ${i}'s exp is not a timestamp`);
  }
  const exp = Date.parse(grant.exp) <= Date.parse(own.exp) ? grant.exp : own.exp;
  return { delegationId: own.run_id, exp, ceilingUsd: own.max_cost_usd };
}
