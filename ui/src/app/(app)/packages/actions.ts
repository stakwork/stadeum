"use server";

import { revalidatePath } from "next/cache";

import { namesOf } from "@/lib/members";
import {
  DIGEST_RE,
  explainRefusal,
  followedActors,
  followedFrom,
  followedIdOf,
  followedOf,
  followingFrom,
  hostOf,
  INDEX_ID_RE,
  indexIdOf,
  INSTALL_ID_RE,
  installWatch,
  PACKAGE_NAME_RE,
  parseRepositoryRef,
  settableSecret,
  SUBSCRIPTION_ID_RE,
  subscriptionIdOf,
  Z32_KEY_RE,
  type Followed,
  type InstallWatch,
} from "@/lib/packages";
import { requireAdmin } from "@/lib/session";
import {
  followPackageIndex,
  followPackageRef,
  getPackageInstall,
  listPackageIndexes,
  listPackageInstalls,
  listPackages,
  listPackageSubscriptions,
  putDeploymentSetting,
  searchPackages,
  startPackageInstall,
  StrutHttpError,
  syncPackageSubscription,
  uninstallPackage,
  unfollowPackageIndex,
  unfollowPackageSubscription,
  type PackageHit,
  type PackageIndex,
  type PackageSubscription,
  type UninstallResult,
} from "@/lib/strut/client";

/**
 * The Packages page's writes and its search, each an admin's, each through
 * strut's API with the deployment key on the server (strut `specs/API.md`
 * §16). A refusal comes back in plain words with strut's own after them;
 * nothing here installs without the admin's click on Install.
 */

type Failed = { error: string };

function refusal(err: unknown): string {
  if (err instanceof StrutHttpError) return explainRefusal(err.detail, err.status);
  return "Strut isn’t answering. Nothing changed.";
}

/** Every page: the rail lists the apps a package brings. */
const changed = () => revalidatePath("/", "layout");

export type FindResult = { hits: PackageHit[]; errors: Array<{ index: string; error: string }> } | Failed;

/** `GET /packages/search`: the indexes the box follows. An empty query lists what they have. */
export async function findPackages(q: string): Promise<FindResult> {
  await requireAdmin();
  try {
    return await searchPackages(typeof q === "string" ? q.trim().slice(0, 200) : "");
  } catch (err) {
    console.warn(`[packages] search failed: ${err instanceof Error ? err.message : String(err)}`);
    return { error: "Strut isn’t answering, so the indexes can’t be searched right now." };
  }
}

export type InstallOutcome = InstallWatch | (Failed & { status?: never });

/**
 * `POST /packages/install { ref, index, digest, wait: false }` as this
 * admin: the package by its name, through the index the hit came from, at
 * the release the admin reviewed. Strut answers at once with the install's
 * record and goes on behind it: the page follows it with `installProgress`.
 * Strut checks it against the publisher's signed catalog and builds its
 * apps before it writes anything.
 */
export async function install(pkg: string, index: string, digest?: string): Promise<InstallOutcome> {
  const me = await requireAdmin();
  if (typeof pkg !== "string" || !PACKAGE_NAME_RE.test(pkg)) return { error: "That isn’t a package name." };
  if (typeof index !== "string" || !INDEX_ID_RE.test(index)) return { error: "That isn’t an index this box follows." };
  if (digest !== undefined && (typeof digest !== "string" || !DIGEST_RE.test(digest))) return { error: "That isn’t a release." };
  try {
    const watch = installWatch(await startPackageInstall(pkg, { index, ...(digest ? { digest } : {}) }, me.actor));
    if (watch.status === "done") changed();
    return watch;
  } catch (err) {
    return { error: refusal(err) };
  }
}

/** Following an install: its record, or why there is none now. `retry`: strut didn't answer this time. */
export type ProgressOutcome = InstallWatch | (Failed & { retry: boolean; status?: never });

/**
 * `GET /packages/installs/:id`: how far an install is, whichever door
 * started it. Once it is done every page reads the box again, since a
 * package's apps join everyone's list.
 */
export async function installProgress(id: string): Promise<ProgressOutcome> {
  await requireAdmin();
  if (typeof id !== "string" || !INSTALL_ID_RE.test(id)) return { error: "That isn’t an install.", retry: false };
  try {
    const install = await getPackageInstall(id);
    if (!install) {
      return { error: "Strut no longer knows this install: it restarted, or the install ended over an hour ago. The Installed list shows what landed.", retry: false };
    }
    const watch = installWatch(install);
    if (watch.status === "done") changed();
    return watch;
  } catch (err) {
    console.warn(`[packages] install ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return { error: "Strut isn’t answering just now. Still trying.", retry: true };
  }
}

export type UninstallOutcome = (UninstallResult & { error?: never }) | (Failed & { removed?: never; kept?: never });

/** `DELETE /packages/:publisher/:name` as this admin. What people edited here stays. */
export async function uninstall(pkg: string): Promise<UninstallOutcome> {
  const me = await requireAdmin();
  if (typeof pkg !== "string" || !PACKAGE_NAME_RE.test(pkg)) return { error: "That isn’t a package name." };
  try {
    const r = await uninstallPackage(pkg, me.actor);
    changed();
    return r;
  } catch (err) {
    return { error: refusal(err) };
  }
}

export type FollowOutcome = { index: PackageIndex; error?: never } | (Failed & { index?: never });

/**
 * Follow an index by its key, from the store's link or the form: `PUT
 * /packages/indexes/<its host> { key, urls: [url], label: host }`. Never
 * replaces another key filed under that id: a link must not change which
 * key this box trusts for names.
 */
export async function followIndex(key: string, url: string): Promise<FollowOutcome> {
  await requireAdmin();
  key = typeof key === "string" ? key.trim() : "";
  url = typeof url === "string" ? url.trim() : "";
  if (!Z32_KEY_RE.test(key)) return { error: "The key is 52 characters of z-base-32, as the index shows it." };
  if (!/^https?:\/\/\S+$/.test(url)) return { error: "Give the address its card is served at, starting https://." };
  const id = indexIdOf(url);
  try {
    const followed = await listPackageIndexes();
    const same = followed.find((i) => i.key === key);
    if (same) return { index: same };
    if (followed.some((i) => i.id === id)) {
      return { error: `This box already follows an index at ${hostOf(url)} under another key. Remove that one first if you mean to replace it.` };
    }
    const index = await followPackageIndex(id, { key, urls: [url], label: hostOf(url) });
    revalidatePath("/packages");
    return { index };
  } catch (err) {
    return { error: refusal(err) };
  }
}

/** `DELETE /packages/indexes/:id`. What was installed through it stays. */
export async function unfollowIndex(id: string): Promise<{ error?: string }> {
  await requireAdmin();
  if (typeof id !== "string" || !INDEX_ID_RE.test(id)) return { error: "That isn’t an index this box follows." };
  try {
    await unfollowPackageIndex(id);
  } catch (err) {
    return { error: refusal(err) };
  }
  revalidatePath("/packages");
  return {};
}

/**
 * `PUT /secrets/:name { value }`: a key an installed package's steps read,
 * in strut's deployment store, for every run. Only a name an installed
 * package's steps read and do not manage themselves (`boxSecrets`: never a
 * person's own), or one a package the box follows waits for; the value
 * goes to strut and nowhere else. What waited for it is read again now, so
 * it installs without waiting for strut's next look.
 */
export async function setSecret(name: string, value: string): Promise<{ error?: string }> {
  await requireAdmin();
  value = typeof value === "string" ? value.trim() : "";
  if (!value) return { error: "Paste the value first." };
  if (value.length > 64 * 1024) return { error: "That is longer than any key." };
  try {
    const [installed, followed] = await Promise.all([listPackages(), listPackageSubscriptions().catch(() => [])]);
    if (typeof name !== "string" || !settableSecret(name, installed, followed)) return { error: "No package installed here reads that secret." };
    await putDeploymentSetting(name, value);
    for (const s of followed.filter((f) => f.waiting?.secrets.includes(name))) readInBackground(s.id);
  } catch (err) {
    return { error: refusal(err) };
  }
  revalidatePath("/packages");
  return {};
}

// ── from a repository ───────────────────────────────────────────────────

/** Strut's subscriptions, each with whose it is: the page's Followed list. */
async function followedAs(subs: PackageSubscription[], me: { actor: string }): Promise<Followed[]> {
  return followedOf(subs, await namesOf(followedActors(subs)), me.actor);
}

/**
 * A subscription read now, the page not waiting on it: strut answers only
 * once the read is done, an install it makes included, so the page follows
 * it with `followedProgress` instead.
 */
function readInBackground(id: string) {
  void syncPackageSubscription(id).catch((err) => console.warn(`[packages] reading ${id} failed: ${err instanceof Error ? err.message : String(err)}`));
}

/** Following started: what strut answered, and when it was last read before (none: never), so the page knows when the new read is done. */
export type FollowRepoOutcome = { followed: Followed; before?: string; error?: never } | (Failed & { followed?: never });

/**
 * From a repository, kept up to date: `PUT /packages/subscriptions/:id
 * { ref }` as this admin, who is then its person (strut `specs/API.md`
 * §16, "Whose a subscription is"): what it installs is theirs, and a
 * private repository is read with their own account alone. The body never
 * names a person. The repository's package already followed (on any
 * branch, by anyone) is the same subscription, so following it again
 * moves it to this branch and makes it this admin's. A package a followed
 * bundle lists is that bundle's: strut would leave a second subscription
 * nothing to do. A bundle's repository is followed the same way, every
 * package it lists with it (the Software card is one). Strut answers at
 * once and reads it behind the answer.
 */
export async function followRepository(raw: string): Promise<FollowRepoOutcome> {
  const me = await requireAdmin();
  const r = parseRepositoryRef(raw);
  if ("error" in r) return { error: r.error };
  if (r.commit) return { error: "A commit never moves, so there is nothing to keep up to date. Name a branch, or turn Keep it up to date off to install that commit once." };
  try {
    const found = followingFrom(await listPackageSubscriptions(), r.ref);
    if (found?.part) {
      return { error: `The box follows that already, as part of ${followedFrom(found.sub)}, and keeps it up to date with it. To follow it on its own, stop following that first.` };
    }
    const same = found?.sub;
    const sub = await followPackageRef(same?.id ?? subscriptionIdOf(r), r.ref, me.actor);
    revalidatePath("/packages");
    const [followed] = await followedAs([sub], me);
    return { followed: followed!, ...(same?.ref === r.ref && same.checkedAt ? { before: same.checkedAt } : {}) };
  } catch (err) {
    return { error: refusal(err) };
  }
}

/**
 * From a repository, once: `POST /packages/install { ref, wait: false }`
 * as this admin, followed as any install is (`installProgress`). A private
 * repository is read with this admin's own account; a tag or a commit
 * after @ is fine here.
 */
export async function installFromRepository(raw: string): Promise<InstallOutcome> {
  const me = await requireAdmin();
  const r = parseRepositoryRef(raw);
  if ("error" in r) return { error: r.error };
  try {
    const watch = installWatch(await startPackageInstall(r.ref, {}, me.actor));
    if (watch.status === "done") changed();
    return watch;
  } catch (err) {
    return { error: refusal(err) };
  }
}

/** Check now: strut reads it again (`POST /packages/subscriptions/:id/sync`) behind the answer. `before`: when it was last read. */
export async function checkFollowed(id: string): Promise<{ before?: string; error?: never } | Failed> {
  await requireAdmin();
  if (typeof id !== "string" || !SUBSCRIPTION_ID_RE.test(id)) return { error: "That isn’t something the box follows." };
  try {
    const sub = (await listPackageSubscriptions()).find((s) => s.id === id);
    if (!sub) return { error: "The box doesn’t follow that any more." };
    readInBackground(id);
    return sub.checkedAt ? { before: sub.checkedAt } : {};
  } catch (err) {
    return { error: refusal(err) };
  }
}

/** A followed thing as it stands, and the install it is making now. `followed: null`: the box no longer follows it. `retry`: strut didn't answer this time. */
export type FollowedProgress = { followed: Followed | null; install?: InstallWatch; error?: never } | (Failed & { retry: boolean; followed?: never });

/**
 * How a read is going: strut's record of the subscription, and its
 * install while one runs (a bundle's: the part strut is installing now).
 * Once its last read is newer than `before`, the read is done (a
 * bundle's, once every part is read), and every page reads the box again.
 */
export async function followedProgress(id: string, before?: string): Promise<FollowedProgress> {
  const me = await requireAdmin();
  if (typeof id !== "string" || !SUBSCRIPTION_ID_RE.test(id)) return { error: "That isn’t something the box follows.", retry: false };
  try {
    const [subs, installs] = await Promise.all([listPackageSubscriptions(), listPackageInstalls()]);
    const sub = subs.find((s) => s.id === id);
    if (!sub) return { followed: null };
    const running = installs.find((i) => followedIdOf(i.ref) === id && i.finishedAt === undefined);
    if (sub.checkedAt && sub.checkedAt !== before && !running) changed();
    const [followed] = await followedAs([sub], me);
    return { followed: followed!, ...(running ? { install: installWatch(running) } : {}) };
  } catch (err) {
    console.warn(`[packages] reading ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return { error: "Strut isn’t answering just now. Still trying.", retry: true };
  }
}

/**
 * Stop following: `DELETE /packages/subscriptions/:id?uninstall=1`, a
 * bundle's parts with it. What it installed goes too, every part's, as an
 * uninstall does (what people edited here is kept): strut installed it
 * through the distro's door, which alone updates and removes it, so left
 * behind it would be a package nothing updates and no admin can uninstall
 * here. Remove Software is this, on the bundle's row.
 */
export async function unfollow(id: string): Promise<{ uninstalled: string[]; error?: never } | (Failed & { uninstalled?: never })> {
  await requireAdmin();
  if (typeof id !== "string" || !SUBSCRIPTION_ID_RE.test(id)) return { error: "That isn’t something the box follows." };
  try {
    const r = await unfollowPackageSubscription(id);
    changed();
    return r ?? { uninstalled: [] };
  } catch (err) {
    return { error: refusal(err) };
  }
}
