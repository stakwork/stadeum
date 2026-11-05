import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/**
 * A release's stack files. stadeum-ops's image carries them, from the
 * commit it was built from: `stack/` minus what is the box's or a
 * laptop's (local.yml, dev.yml), with `.env.example` and
 * `scripts/init-env.sh` beside it for scripts/install.sh. ops writes the
 * `stack/` files into the box; `.env` and `stack/local.yml` stay the box's.
 */

/** Where ops's image keeps its release (ops/Dockerfile). */
export const RELEASE = "/usr/local/share/stadeum";
export const RELEASE_STACK = `${RELEASE}/stack`;

/** Files by their path under the stack directory (`caddy/Caddyfile`). */
export type Files = Map<string, Buffer>;

/** The box's own files in the stack directory: a release never brings or writes them. */
const OWN = new Set(["local.yml"]);

/** Every file under `dir`, by its path there. None when it is not there. */
export function readFiles(dir: string): Files {
  const files: Files = new Map();
  if (!existsSync(dir)) return files;
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(dir, path).split(sep).join("/"), readFileSync(path));
    }
  };
  walk(dir);
  for (const own of OWN) files.delete(own);
  return files;
}

/** What `dir` holds at these paths: null where it has none. */
export function pick(dir: string, paths: Iterable<string>): Map<string, Buffer | null> {
  const out = new Map<string, Buffer | null>();
  for (const p of paths) {
    const path = join(dir, p);
    out.set(p, existsSync(path) && statSync(path).isFile() ? readFileSync(path) : null);
  }
  return out;
}

/**
 * Put files in place: each written beside itself and renamed over the
 * old, so a reader never sees half a file; null removes one (and the
 * directories it leaves empty). Never one of the box's own.
 */
export function writeFiles(dir: string, files: Map<string, Buffer | null>): void {
  for (const [p, content] of files) {
    if (OWN.has(p) || p.startsWith("/") || p.split("/").includes("..")) throw new Error(`a release does not write ${p}`);
    const path = join(dir, p);
    if (content === null) {
      rmSync(path, { force: true });
      for (let d = dirname(path); d !== dir && d.startsWith(dir) && existsSync(d) && !readdirSync(d).length; d = dirname(d)) rmSync(d, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.ops-${process.pid}`;
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  }
}

/** The paths whose content differs, or that one side has and the other does not. */
export function differs(a: Map<string, Buffer | null>, b: Map<string, Buffer | null>): string[] {
  const out: string[] = [];
  for (const p of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(p) ?? null;
    const y = b.get(p) ?? null;
    if (x === null ? y !== null : y === null || !x.equals(y)) out.push(p);
  }
  return out.sort();
}
