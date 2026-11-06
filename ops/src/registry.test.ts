import { describe, expect, it } from "vitest";

import { digestsOf, parseChallenge, parseReference, platform, Registry, type RegistryApi } from "./registry.js";
import { svc } from "./test/fakes.js";
import { lookUp } from "./update.js";

const INDEX = "sha256:1e90a2f195ef6f2095b8bafc50e6761ec6efd5424195d13e6cf13c4226f7e948";
const AMD64 = "sha256:75b0a5b66853";
const ARM64 = "sha256:612540718540";

describe("references", () => {
  it("name their registry, repository and tag as docker does", () => {
    expect(parseReference("ghcr.io/stakwork/strut:stable")).toEqual({ host: "ghcr.io", registry: "ghcr.io", repository: "stakwork/strut", tag: "stable" });
    expect(parseReference("neo4j:5.26.32")).toEqual({ host: "registry-1.docker.io", registry: "Docker Hub", repository: "library/neo4j", tag: "5.26.32" });
    expect(parseReference("redis")).toMatchObject({ repository: "library/redis", tag: "latest" });
    expect(parseReference("docker.io/someone/thing:1")).toMatchObject({ host: "registry-1.docker.io", repository: "someone/thing", tag: "1" });
    expect(parseReference("localhost:5000/x/y:z")).toMatchObject({ host: "localhost:5000", repository: "x/y", tag: "z" });
    expect(parseReference(`ghcr.io/stakwork/strut@${INDEX}`)).toEqual({ host: "ghcr.io", registry: "ghcr.io", repository: "stakwork/strut", digest: INDEX });
  });

  it("read an image's digests from its RepoDigests", () => {
    expect(digestsOf([`ghcr.io/stakwork/strut@${INDEX}`, `ghcr.io/stakwork/strut@${INDEX}`, "other@sha256:ab"])).toEqual([INDEX, "sha256:ab"]);
    expect(digestsOf(null)).toEqual([]);
  });

  it("read a bearer challenge, and this machine's platform", () => {
    expect(parseChallenge('Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:stakwork/strut:pull"')).toEqual({
      realm: "https://ghcr.io/token",
      params: { service: "ghcr.io", scope: "repository:stakwork/strut:pull" },
    });
    expect(parseChallenge('Basic realm="x"')).toBeNull();
    expect(parseChallenge(null)).toBeNull();
    expect(platform("x64")).toEqual({ os: "linux", architecture: "amd64" });
    expect(platform("arm64")).toEqual({ os: "linux", architecture: "arm64" });
  });
});

/** A registry that wants a token, as ghcr.io does. */
function fakeRegistry(routes: Record<string, () => Response>) {
  const calls: Array<{ method: string; url: string; auth: string | null; accept: string | null }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? "GET", url, auth: headers.get("authorization"), accept: headers.get("accept") });
    if (url.startsWith("https://ghcr.io/token")) return Response.json({ token: "tok" });
    if (headers.get("authorization") !== "Bearer tok") {
      return new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:stakwork/strut:pull"' } });
    }
    const route = routes[`${init?.method ?? "GET"} ${url}`];
    return route ? route() : new Response(null, { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

const V2 = "https://ghcr.io/v2/stakwork/strut";

describe("asking a registry", () => {
  it("HEADs the tag's manifest, accepting an index, with the token its challenge names, kept for the next ask", async () => {
    const { calls, fetcher } = fakeRegistry({ [`HEAD ${V2}/manifests/stable`]: () => new Response(null, { headers: { "docker-content-digest": INDEX } }) });
    const r = new Registry(fetcher);
    expect(await r.digest("ghcr.io/stakwork/strut:stable")).toBe(INDEX);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `HEAD ${V2}/manifests/stable`,
      "GET https://ghcr.io/token?service=ghcr.io&scope=repository%3Astakwork%2Fstrut%3Apull",
      `HEAD ${V2}/manifests/stable`,
    ]);
    expect(calls[0]!.accept).toMatch(/^application\/vnd\.oci\.image\.index\.v1\+json, application\/vnd\.docker\.distribution\.manifest\.list\.v2\+json, /);
    await r.digest("ghcr.io/stakwork/strut:stable");
    expect(calls).toHaveLength(4);
    expect(calls[3]!.auth).toBe("Bearer tok");
  });

  it("says what went wrong in words", async () => {
    const r = (routes: Record<string, () => Response>) => new Registry(fakeRegistry(routes).fetcher);
    await expect(r({}).digest("ghcr.io/stakwork/strut:nope")).rejects.toThrow("ghcr.io has no stakwork/strut:nope");
    await expect(r({ [`HEAD ${V2}/manifests/stable`]: () => new Response(null, { status: 429 }) }).digest("ghcr.io/stakwork/strut:stable")).rejects.toThrow(
      "ghcr.io is limiting this box's requests (429)",
    );
    await expect(r({ [`HEAD ${V2}/manifests/stable`]: () => new Response(null) }).digest("ghcr.io/stakwork/strut:stable")).rejects.toThrow(
      "ghcr.io did not say which image stakwork/strut:stable is",
    );
    const down = new Registry((async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    }) as typeof fetch);
    await expect(down.digest("ghcr.io/stakwork/strut:stable")).rejects.toThrow("could not reach ghcr.io: ENOTFOUND");
    const refuses = new Registry((async () => new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer realm="https://ghcr.io/token"' } })) as typeof fetch);
    await expect(refuses.digest("ghcr.io/stakwork/private:stable")).rejects.toThrow("gave no token");
  });

  it("reads a newer image's commit and build time from this platform's manifest", async () => {
    const { calls, fetcher } = fakeRegistry({
      [`GET ${V2}/manifests/${INDEX}`]: () =>
        Response.json({
          mediaType: "application/vnd.oci.image.index.v1+json",
          manifests: [
            { digest: AMD64, platform: { os: "linux", architecture: "amd64" } },
            { digest: ARM64, platform: { os: "linux", architecture: "arm64" } },
          ],
        }),
      [`GET ${V2}/manifests/${ARM64}`]: () =>
        Response.json({
          config: { digest: "sha256:cfg" },
          annotations: { "org.opencontainers.image.revision": "c15177a1afa2", "org.opencontainers.image.created": "2026-11-06T01:02:32.460Z" },
        }),
    });
    const r = new Registry(fetcher, { os: "linux", architecture: "arm64" });
    expect(await r.info("ghcr.io/stakwork/strut:stable", INDEX)).toEqual({ revision: "c15177a1afa2", created: "2026-11-06T01:02:32.460Z" });
    expect(calls.filter((c) => c.auth).map((c) => c.url)).toEqual([`${V2}/manifests/${INDEX}`, `${V2}/manifests/${ARM64}`]);
  });

  it("falls back to the image's config labels when the manifest has no annotations", async () => {
    const { fetcher } = fakeRegistry({
      [`GET ${V2}/manifests/sha256:single`]: () => Response.json({ config: { digest: "sha256:cfg" } }),
      [`GET ${V2}/blobs/sha256:cfg`]: () => Response.json({ created: "2026-11-05T09:56:34Z", config: { Labels: { "org.opencontainers.image.revision": "ff5b896" } } }),
    });
    expect(await new Registry(fetcher).info("ghcr.io/stakwork/strut:stable", "sha256:single")).toEqual({ revision: "ff5b896", created: "2026-11-05T09:56:34Z" });
  });
});

describe("comparing with what runs", () => {
  const strut = svc("strut", "ghcr.io/stakwork/strut:stable", { group: "strut" });
  const now = "2026-11-05T12:00:00.000Z";
  const registry = (digest: string | Error): RegistryApi & { infos: number } => {
    const r = {
      infos: 0,
      digest: async () => {
        if (digest instanceof Error) throw digest;
        return digest;
      },
      info: async () => {
        r.infos++;
        return { revision: "c15177a1afa2", created: "2026-11-06T01:02:32Z" };
      },
    };
    return r;
  };

  it("is current when the running image was pulled as the digest the tag names", async () => {
    // Docker's containerd store: the ID is the index digest.
    expect(await lookUp(registry(INDEX), strut, { id: INDEX, digests: [INDEX] }, undefined, now)).toEqual({ checkedAt: now, digest: INDEX, current: true });
    // The classic store: the ID is the config's digest, and RepoDigests holds the index's.
    expect(await lookUp(registry(INDEX), strut, { id: "sha256:config", digests: [INDEX] }, undefined, now)).toEqual({ checkedAt: now, digest: INDEX, current: true });
  });

  it("says what the newer image is, reading its labels once", async () => {
    const r = registry(INDEX);
    const first = await lookUp(r, strut, { id: "sha256:old", digests: ["sha256:old"] }, undefined, now);
    expect(first).toEqual({ checkedAt: now, digest: INDEX, current: false, revision: "c15177a1afa2", created: "2026-11-06T01:02:32Z" });
    const later = "2026-11-05T12:10:00.000Z";
    expect(await lookUp(r, strut, { id: "sha256:old", digests: ["sha256:old"] }, first, later)).toEqual({ ...first, checkedAt: later });
    expect(r.infos).toBe(1);
  });

  it("keeps what the registry said last when it does not answer, and says why", async () => {
    const prev = { checkedAt: now, digest: INDEX, current: true };
    expect(await lookUp(registry(new Error("could not reach ghcr.io: ENOTFOUND")), strut, { id: INDEX, digests: [INDEX] }, prev, "2026-11-05T12:10:00.000Z")).toEqual({
      ...prev,
      problem: "could not reach ghcr.io: ENOTFOUND",
      triedAt: "2026-11-05T12:10:00.000Z",
    });
    expect(await lookUp(registry(new Error("x")), strut, undefined, undefined, now)).toEqual({ problem: "x", triedAt: now });
  });

  it("cannot compare an image that has no registry digest", async () => {
    expect(await lookUp(registry(INDEX), strut, { id: "sha256:built" }, undefined, now)).toEqual({
      checkedAt: now,
      digest: INDEX,
      problem: "the image that runs has no digest from ghcr.io: it was built or loaded on this box",
      triedAt: now,
    });
  });

  it("names a newer image when nothing runs", async () => {
    expect(await lookUp(registry(INDEX), strut, undefined, undefined, now)).toMatchObject({ digest: INDEX, current: false });
  });
});
