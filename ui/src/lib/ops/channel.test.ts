import { describe, expect, it } from "vitest";

import { channelLine, registryOf } from "./channel";
import type { Latest } from "./contract";

const now = new Date("2026-11-05T12:00:00Z");
const NEW = "sha256:1e90a2f195ef6f2095b8bafc50e6761ec6efd5424195d13e6cf13c4226f7e948";
const strut = (latest?: Latest) => ({ image: "ghcr.io/stakwork/strut:stable", ...(latest ? { latest } : {}) });
const line = (latest?: Latest, o: { failed?: string[]; held?: boolean; release?: boolean } = {}) =>
  channelLine({ ...strut(latest), ...(o.release ? { release: true } : {}) }, { failed: new Set(o.failed ?? []), held: o.held ?? false, now });

describe("what the Updates page says of a channel", () => {
  it("says current only with when it was checked", () => {
    expect(line({ checkedAt: "2026-11-05T11:56:00Z", digest: NEW, current: true })).toEqual({
      tone: "ok",
      label: "Current · checked 4 minutes ago",
      title: expect.stringMatching(/^Checked against ghcr\.io .+ · sha256:1e90a2f1/),
    });
    expect(line({ checkedAt: "2026-11-05T11:59:50Z", digest: NEW, current: true }).label).toBe("Current · checked just now");
  });

  it("says a newer image is out: its commit and when it was built", () => {
    expect(line({ checkedAt: "2026-11-05T11:56:00Z", digest: NEW, current: false, revision: "c15177a1afa2", created: "2026-11-05T10:00:00Z" })).toMatchObject({
      tone: "pending",
      label: "c15177a is out, built 2 hours ago: next window, or Update now",
    });
    // Without labels, its digest.
    expect(line({ checkedAt: "2026-11-05T11:56:00Z", digest: NEW, current: false }).label).toBe("1e90a2f195ef is out: next window, or Update now");
  });

  it("says a newer image is held back, or waits for an admin", () => {
    const out = { checkedAt: "2026-11-05T11:56:00Z", digest: NEW, current: false, revision: "c15177a" };
    expect(line(out, { failed: [NEW] })).toMatchObject({ tone: "attention", label: "c15177a is out, held back: it failed its health check" });
    expect(line(out, { release: true, held: true })).toMatchObject({ tone: "attention", label: "c15177a is out, waiting for you: it upgrades Neo4j" });
    // Neo4j holds the release, not strut.
    expect(line(out, { held: true }).tone).toBe("pending");
  });

  it("says when it has not been checked", () => {
    expect(line()).toEqual({ tone: "muted", label: "Not checked yet", note: "ops asks ghcr.io every 10 minutes." });
  });

  it("does not call an old answer current", () => {
    expect(line({ checkedAt: "2026-11-05T09:00:00Z", digest: NEW, current: true })).toMatchObject({ tone: "muted", label: "Current when checked 3 hours ago" });
    expect(line({ checkedAt: "2026-11-05T09:00:00Z", digest: NEW, current: false, revision: "c15177a" })).toMatchObject({
      tone: "muted",
      label: "c15177a was out when checked 3 hours ago",
    });
    // Within three missed checks it still counts.
    expect(line({ checkedAt: "2026-11-05T11:31:00Z", digest: NEW, current: true }).tone).toBe("ok");
  });

  it("says why a check failed, and what the last answer was", () => {
    expect(line({ problem: "could not reach ghcr.io: ENOTFOUND", triedAt: "2026-11-05T11:58:00Z" })).toEqual({
      tone: "attention",
      label: "Could not check 2 minutes ago",
      note: "could not reach ghcr.io: ENOTFOUND.",
    });
    expect(line({ checkedAt: "2026-11-05T09:00:00Z", digest: NEW, current: true, problem: "ghcr.io is limiting this box's requests (429)", triedAt: "2026-11-05T11:58:00Z" })).toMatchObject({
      tone: "attention",
      note: "ghcr.io is limiting this box's requests (429). It was current 3 hours ago.",
    });
    expect(line({ checkedAt: "2026-11-05T09:00:00Z", digest: NEW, current: false, revision: "c15177a", problem: "x", triedAt: "2026-11-05T11:58:00Z" }).note).toBe(
      "x. c15177a was out 3 hours ago.",
    );
  });

  it("says when what runs cannot be compared", () => {
    expect(
      line({ checkedAt: "2026-11-05T11:58:00Z", digest: NEW, problem: "the image that runs has no digest from ghcr.io: it was built or loaded on this box", triedAt: "2026-11-05T11:58:00Z" }),
    ).toMatchObject({ tone: "attention", note: "the image that runs has no digest from ghcr.io: it was built or loaded on this box." });
  });

  it("names registries as people do", () => {
    expect(registryOf("ghcr.io/stakwork/strut:stable")).toBe("ghcr.io");
    expect(registryOf("neo4j:5.26.32")).toBe("Docker Hub");
    expect(registryOf("someone/thing:1")).toBe("Docker Hub");
    expect(registryOf("localhost:5000/x:y")).toBe("localhost:5000");
  });
});
