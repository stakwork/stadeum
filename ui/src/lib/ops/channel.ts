import type { Tone } from "@/components/state";
import { absoluteTime, relativeTime } from "@/lib/format";
import type { Latest, ServiceImage } from "@/lib/ops/contract";

/**
 * What the Updates page says of a service that follows a channel. It
 * calls an image current only when ops asked its registry, and says when:
 * ops asks every 10 minutes, so an answer older than STALE_MS means ops
 * has not been asking, and the page says "when checked", not "current".
 */

/** Three missed checks. */
export const STALE_MS = 30 * 60_000;

export interface ChannelLine {
  tone: Tone;
  label: string;
  /** A sentence under it. */
  note?: string;
  /** On hover: when, and which digest. */
  title?: string;
}

/** Where the image comes from, as people name it: `ghcr.io`, `Docker Hub`. */
export function registryOf(image: string): string {
  const slash = image.indexOf("/");
  const first = slash >= 0 ? image.slice(0, slash) : "";
  const host = slash >= 0 && (first.includes(".") || first.includes(":") || first === "localhost") ? first : "docker.io";
  return host === "docker.io" || host === "index.docker.io" ? "Docker Hub" : host;
}

/** An image the registry named, as people tell them apart: its commit, else its digest. */
export function shortLatest(l: Latest): string {
  return l.revision ? l.revision.slice(0, 7) : (l.digest ?? "").replace(/^sha256:/, "").slice(0, 12);
}

/** ops's words as they are (they may start with a registry's name, `ghcr.io`), ended. */
const sentence = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);

export function channelLine(
  s: Pick<ServiceImage, "image" | "release" | "latest">,
  o: { failed: ReadonlySet<string>; held: boolean; now?: Date },
): ChannelLine {
  const now = o.now ?? new Date();
  const where = registryOf(s.image);
  const l = s.latest;
  if (!l || (!l.checkedAt && !l.problem)) return { tone: "muted", label: "Not checked yet", note: `ops asks ${where} every 10 minutes.` };

  const when = l.checkedAt ? relativeTime(l.checkedAt, now) : "";
  const title = l.checkedAt ? `Checked against ${where} ${absoluteTime(l.checkedAt)}${l.digest ? ` · ${l.digest}` : ""}` : undefined;
  const stale = !l.checkedAt || now.getTime() - new Date(l.checkedAt).getTime() > STALE_MS;
  const newer = l.current === false ? shortLatest(l) : null;

  if (l.problem) {
    const before = !l.checkedAt
      ? ""
      : l.current
        ? ` It was current ${when}.`
        : newer
          ? ` ${newer} was out ${when}.`
          : "";
    return { tone: "attention", label: `Could not check ${relativeTime(l.triedAt, now)}`, note: `${sentence(l.problem)}${before}`, ...(title ? { title } : {}) };
  }

  if (l.current) {
    return stale ? { tone: "muted", label: `Current when checked ${when}`, ...(title ? { title } : {}) } : { tone: "ok", label: `Current · checked ${when}`, ...(title ? { title } : {}) };
  }

  const built = l.created ? `, built ${relativeTime(l.created, now)}` : "";
  if (stale) return { tone: "muted", label: `${newer} was out when checked ${when}`, ...(title ? { title } : {}) };
  const label = `${newer} is out${built}`;
  const line: ChannelLine =
    l.digest && o.failed.has(l.digest)
      ? { tone: "attention", label: `${label}, held back: it failed its health check` }
      : s.release && o.held
        ? { tone: "attention", label: `${label}, waiting for you: it upgrades Neo4j` }
        : { tone: "pending", label: `${label}: next window, or Update now` };
  return { ...line, ...(title ? { title } : {}) };
}
