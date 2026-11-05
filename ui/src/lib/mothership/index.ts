/**
 * The mothership library: what lets a signed-in person run LLM steps on
 * Strut. Phase 2 calls `ensureOrgTrust()` at install and
 * `ensureDelegation(user)` per person; sign-in calls the latter too.
 * Contract: docs/mothership-spec.md.
 */
export { ensureOrgTrust, type OrgTrustResult } from "./trust";
export { ensureDelegation, pushDelegation, isPastHalfLife, isWithinRenewWindow } from "./delegation";
export type { DelegationResult, DelegationStatus, DelegationUser } from "./delegation";
export { ensureOrgKeys, ensureUserKeys, macaroonOrgId } from "./keys";
export { ensureVirtualKey } from "./virtual-key";
export { mintDelegation, MintError } from "./mint";
export { listDelegations, putDelegation, deleteDelegation, pushActorSecret } from "./strut-lab";
export { buildActor } from "./actor";
export { MothershipConfigError } from "./admin-credentials";
export { renewAllDelegations } from "./renew";
