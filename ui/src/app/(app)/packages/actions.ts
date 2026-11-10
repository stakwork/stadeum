"use server";

import { revalidatePath } from "next/cache";

import {
  DIGEST_RE,
  explainRefusal,
  hostOf,
  INDEX_ID_RE,
  indexIdOf,
  INSTALL_ID_RE,
  installWatch,
  PACKAGE_NAME_RE,
  settableSecret,
  Z32_KEY_RE,
  type InstallWatch,
} from "@/lib/packages";
import { requireAdmin } from "@/lib/session";
import {
  followPackageIndex,
  getPackageInstall,
  listPackageIndexes,
  listPackages,
  putDeploymentSetting,
  searchPackages,
  startPackageInstall,
  StrutHttpError,
  uninstallPackage,
  unfollowPackageIndex,
  type PackageHit,
  type PackageIndex,
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
 * package declares; the value goes to strut and nowhere else.
 */
export async function setSecret(name: string, value: string): Promise<{ error?: string }> {
  await requireAdmin();
  value = typeof value === "string" ? value.trim() : "";
  if (!value) return { error: "Paste the value first." };
  if (value.length > 64 * 1024) return { error: "That is longer than any key." };
  try {
    if (typeof name !== "string" || !settableSecret(name, await listPackages())) return { error: "No package installed here reads that secret." };
    await putDeploymentSetting(name, value);
  } catch (err) {
    return { error: refusal(err) };
  }
  revalidatePath("/packages");
  return {};
}
