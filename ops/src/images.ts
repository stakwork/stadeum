import type { ServiceDef, Stack } from "./compose.js";
import type { ImageRef } from "./contract.js";
import { errorText } from "./deps.js";

/**
 * Old images. strut and strut-browser are 3.5 GB or more each, and every
 * update leaves the image it replaced behind, so a box would fill. ops
 * removes what it no longer needs after each update and each rollback.
 *
 * It removes only images it moved a name off, because nothing else says
 * whose an image is: once a channel's tag moves, Docker's containerd store
 * keeps no name on the old image at all, and labels do not tell strut's
 * images from strut-browser's. So ops keeps a name on each image it wants:
 *
 *   the service's reference         what runs (`…/strut:stable`)
 *   <repository>:ops-previous       what ran before, for a rollback by hand
 *   <repository>:ops-channel        what the channel had at the last check:
 *                                   a release not yet applied, or one held
 *                                   back (kept, so a held-back image is not
 *                                   downloaded again every night)
 *
 * An image ops moved one of these names off goes, unless a container on
 * this machine uses it (any project, running or not), it still carries one
 * of these names, or it has a name ops does not own (a person's tag, or
 * another stack's). Images ops never named are never touched. Removing an
 * image frees its layers that nothing else shares.
 */

export const PREVIOUS = "ops-previous";
export const CHANNEL = "ops-channel";

/** `ghcr.io/stakwork/strut:stable` → `ghcr.io/stakwork/strut`; `neo4j@sha256:…` → `neo4j`. */
export function repoOf(ref: string): string {
  const at = ref.indexOf("@");
  const name = at >= 0 ? ref.slice(0, at) : ref;
  const colon = name.lastIndexOf(":");
  return colon > name.lastIndexOf("/") ? name.slice(0, colon) : name;
}

const isOps = (name: string) => name.endsWith(`:${PREVIOUS}`) || name.endsWith(`:${CHANNEL}`);

export interface Removed {
  service: string;
  image: ImageRef;
}

export interface Pruned {
  removed: Removed[];
  /** Bytes freed: each removed image's layers no other image shared (`docker system df -v`). */
  freed?: number;
}

export class Images {
  /** Image IDs ops moved a name off, by the service they were; removed at the next prune. */
  private pending = new Map<string, string>();
  /** Names ops may take away with them: a pin the stack no longer names. */
  private droppable = new Set<string>();

  constructor(
    private readonly stack: Stack,
    private readonly log: (msg: string) => void,
  ) {}

  /** An image that lost a name ops gave it: removed at the next prune unless something keeps it. */
  candidate(id: string | undefined, service: string, dropName?: string): void {
    if (!id) return;
    this.pending.set(id, service);
    if (dropName) this.droppable.add(dropName);
  }

  /** Point one of ops's names at an image; what it named before becomes a candidate. */
  private async name(service: string, ref: string, kind: string, id: string): Promise<void> {
    const name = `${repoOf(ref)}:${kind}`;
    const old = await this.stack.imageId(name);
    if (old === id) return;
    await this.stack.tag(id, name);
    this.candidate(old, service);
  }

  /** After a check: what each service's channel has now is `ops-channel`. */
  async channel(service: ServiceDef, available: string | undefined, before?: string, running?: string): Promise<void> {
    if (before && before !== running && before !== available) this.candidate(before, service.name);
    if (available) await this.name(service.name, service.image, CHANNEL, available);
  }

  /**
   * A service moved off `from`, which ran under `ref`: it is `ops-previous`
   * now. A pin the stack no longer names (`caddy:2.11.8-alpine` after a
   * release moved Caddy) loses that name too, so it can go in its turn,
   * unless a container on this machine still runs it: then the name is
   * another project's as well, and stays.
   */
  async moved(service: string, ref: string, from: string, stillNamed: boolean): Promise<void> {
    await this.name(service, ref, PREVIOUS, from);
    if (stillNamed || isOps(ref) || (await this.stack.imageId(ref)) !== from) return;
    if (!(await this.stack.imagesInUse()).has(from)) await this.stack.untag(ref);
  }

  /**
   * Remove each candidate nothing keeps. `defs`: the stack's services, whose
   * references and ops names keep their images.
   */
  async prune(defs: ServiceDef[], keep: Iterable<string> = []): Promise<Pruned> {
    if (!this.pending.size) return { removed: [] };
    const kept = new Set<string>(keep);
    try {
      for (const id of await this.stack.imagesInUse()) kept.add(id);
      for (const s of defs) {
        if (!s.image) continue;
        for (const ref of [s.image, `${repoOf(s.image)}:${PREVIOUS}`, `${repoOf(s.image)}:${CHANNEL}`]) {
          const id = await this.stack.imageId(ref);
          if (id) kept.add(id);
        }
      }
    } catch (err) {
      this.log(`not removing old images: ${errorText(err)}`);
      return { removed: [] };
    }

    const go: Array<[string, string]> = [];
    for (const [id, service] of this.pending) {
      this.pending.delete(id);
      if (!kept.has(id)) go.push([id, service]);
    }
    if (!go.length) return { removed: [] };

    const sizes = await this.stack.uniqueSizes().catch(() => new Map<string, number>());
    const removed: Removed[] = [];
    let freed = 0;
    for (const [id, service] of go) {
      try {
        if (!(await this.stack.imageId(id))) continue;
        const names = await this.stack.names(id);
        const others = names.filter((n) => !isOps(n) && !this.droppable.has(n));
        if (others.length) {
          this.log(`keeping ${id.slice(7, 19)} (${service}): it is also ${others.join(", ")}`);
          continue;
        }
        const image = await this.stack.describe(id);
        for (const n of names) await this.stack.untag(n);
        if ((await this.stack.imageId(id)) && !(await this.stack.removeImage(id))) {
          this.log(`could not remove ${id.slice(7, 19)} (${service})`);
          continue;
        }
        removed.push({ service, image });
        freed += sizes.get(id) ?? 0;
      } catch (err) {
        this.log(`could not remove ${id.slice(7, 19)} (${service}): ${errorText(err)}`);
      }
    }
    this.droppable.clear();
    for (const r of removed) this.log(`removed ${r.service}'s old image ${short(r.image)}`);
    return { removed, ...(sizes.size ? { freed } : {}) };
  }
}

const short = (r: ImageRef) => (r.revision ?? r.id.replace(/^sha256:/, "")).slice(0, 7);

const bytes = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} kB` : n < 1e9 ? `${Math.round(n / 1e6)} MB` : `${(n / 1e9).toFixed(1)} GB`);

/** "Removed 2 old images (strut 2fe953a, strut-browser ff5b896): 7.1 GB freed." Empty when none. */
export function describePruned(p: Pruned): string {
  if (!p.removed.length) return "";
  const n = p.removed.length;
  const which = p.removed.map((r) => `${r.service} ${short(r.image)}`).join(", ");
  return `Removed ${n} old image${n === 1 ? "" : "s"} (${which})${p.freed !== undefined ? `: ${bytes(p.freed)} freed` : ""}.`;
}
