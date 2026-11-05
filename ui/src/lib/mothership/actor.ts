/**
 * The actor string for a person: `<email-local>-<userId>`. The same value
 * is the macaroon `user_id`, the Bifrost customer + VK name, the Strut
 * actor (`x-strut-actor`, the delegation URL, the embed JWT `sub`).
 * Computed once at user creation and stored, so an email change never
 * moves anyone's spend. (Hive: `buildBifrostName`, `reconciler.ts:736-742`.)
 */
export function buildActor(email: string, userId: string): string {
  const local = (email.split("@")[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);
  return local ? `${local}-${userId}` : userId;
}
