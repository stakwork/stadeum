/**
 * What a tag names now, asked of its registry, without pulling it. The
 * Updates page says an image is current only when ops asked just that.
 *
 * The registry's own v2 API, anonymously: a request the registry refuses
 * (401) names where to get a token (`WWW-Authenticate: Bearer realm=…`),
 * ops gets one and asks again. `HEAD /v2/<repository>/manifests/<tag>`,
 * accepting a multi-arch index as well as a single manifest, answers with
 * `Docker-Content-Digest`: the digest `docker pull` records in the image's
 * RepoDigests (and, on Docker's containerd image store, its ID). So an
 * image runs what the tag names when its digests hold that one.
 *
 * A HEAD is not a pull: Docker Hub does not count it against its pull
 * limit (a manifest GET does). ghcr.io publishes none for public images.
 * Only when the tag names another image does ops read that one's manifest
 * for this box's platform (two small GETs) for its commit and build time.
 */

export interface Reference {
  /** Where the API is: `ghcr.io`, `registry-1.docker.io`. */
  host: string;
  /** As people name it: `ghcr.io`, `Docker Hub`. */
  registry: string;
  /** `stakwork/strut`, `library/neo4j`. */
  repository: string;
  tag?: string;
  /** A reference that names a digest (`…@sha256:…`) names it for good. */
  digest?: string;
}

const DOCKER_HUB = "registry-1.docker.io";

/** `ghcr.io/stakwork/strut:stable`, `neo4j:5.26.32`, `redis`, `localhost:5000/x:y`, `x@sha256:…`. */
export function parseReference(ref: string): Reference {
  let rest = ref.trim();
  let digest: string | undefined;
  const at = rest.indexOf("@");
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  let tag: string | undefined;
  const colon = rest.lastIndexOf(":");
  if (colon > rest.lastIndexOf("/")) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }
  const slash = rest.indexOf("/");
  const first = slash >= 0 ? rest.slice(0, slash) : "";
  const isHost = slash >= 0 && (first.includes(".") || first.includes(":") || first === "localhost");
  let host = isHost ? first : "docker.io";
  let repository = isHost ? rest.slice(slash + 1) : rest;
  if (host === "docker.io" || host === "index.docker.io") {
    host = DOCKER_HUB;
    if (!repository.includes("/")) repository = `library/${repository}`;
  }
  if (!repository) throw new Error(`not an image reference: ${ref}`);
  return {
    host,
    registry: host === DOCKER_HUB ? "Docker Hub" : host,
    repository,
    ...(tag || !digest ? { tag: tag ?? "latest" } : {}),
    ...(digest ? { digest } : {}),
  };
}

/** The digests an image's RepoDigests hold (`ghcr.io/stakwork/strut@sha256:…` → `sha256:…`). */
export function digestsOf(repoDigests: string[] | null | undefined): string[] {
  return [...new Set((repoDigests ?? []).map((r) => r.slice(r.indexOf("@") + 1)).filter((d) => d.startsWith("sha256:")))];
}

/** What a newer image says of itself: its labels, read from the registry. */
export interface ImageInfo {
  revision?: string;
  created?: string;
}

export interface RegistryApi {
  /** The digest `ref`'s tag names now: a multi-arch image's index. */
  digest(ref: string): Promise<string>;
  /** The commit and build time of the image `digest` names in `ref`'s repository, for this box's platform. */
  info(ref: string, digest: string): Promise<ImageInfo>;
}

const INDEX_TYPES = ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"];
const MANIFEST_TYPES = ["application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"];
const ACCEPT = [...INDEX_TYPES, ...MANIFEST_TYPES].join(", ");

const REVISION = "org.opencontainers.image.revision";
const CREATED = "org.opencontainers.image.created";

/** A `WWW-Authenticate: Bearer realm="…",service="…",scope="…"` challenge. */
export function parseChallenge(header: string | null): { realm: string; params: Record<string, string> } | null {
  if (!header || !/^bearer\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  for (const m of header.slice(7).matchAll(/(\w+)="([^"]*)"/g)) params[m[1]!.toLowerCase()] = m[2]!;
  const { realm, ...rest } = params;
  return realm ? { realm, params: rest } : null;
}

/** Docker's names for this machine's platform: ops runs on the box's. */
export function platform(arch: string = process.arch): { os: string; architecture: string } {
  const map: Record<string, string> = { x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386", ppc64: "ppc64le", s390x: "s390x" };
  return { os: "linux", architecture: map[arch] ?? arch };
}

interface Index {
  mediaType?: string;
  manifests?: Array<{ digest: string; platform?: { os?: string; architecture?: string }; annotations?: Record<string, string> }>;
  annotations?: Record<string, string>;
  config?: { digest: string };
}

const TIMEOUT_MS = 20_000;

export class Registry implements RegistryApi {
  /** Tokens by `host/repository`, kept until the registry refuses one. */
  private tokens = new Map<string, string>();

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly arch: { os: string; architecture: string } = platform(),
  ) {}

  async digest(ref: string): Promise<string> {
    const r = parseReference(ref);
    if (r.digest) return r.digest;
    const res = await this.request(r, `manifests/${r.tag}`, "HEAD");
    const digest = res.headers.get("docker-content-digest");
    if (!digest) throw new Error(`${r.registry} did not say which image ${r.repository}:${r.tag} is`);
    return digest;
  }

  async info(ref: string, digest: string): Promise<ImageInfo> {
    const r = parseReference(ref);
    let doc = (await (await this.request(r, `manifests/${digest}`)).json()) as Index;
    let labels = { ...doc.annotations };
    if (doc.manifests) {
      const mine = doc.manifests.find((m) => m.platform?.os === this.arch.os && m.platform?.architecture === this.arch.architecture);
      if (!mine) return pick(labels);
      labels = { ...labels, ...mine.annotations };
      doc = (await (await this.request(r, `manifests/${mine.digest}`)).json()) as Index;
      labels = { ...labels, ...doc.annotations };
    }
    if ((!labels[REVISION] || !labels[CREATED]) && doc.config?.digest) {
      const config = (await (await this.request(r, `blobs/${doc.config.digest}`)).json()) as { created?: string; config?: { Labels?: Record<string, string> } };
      labels = { ...config.config?.Labels, ...(config.created ? { [CREATED]: config.created } : {}), ...labels };
    }
    return pick(labels);
  }

  /** Ask; on a 401, get the token the registry names and ask once more. */
  private async request(r: Reference, path: string, method: "GET" | "HEAD" = "GET"): Promise<Response> {
    const key = `${r.host}/${r.repository}`;
    const url = `https://${r.host}/v2/${r.repository}/${path}`;
    const ask = (token?: string) =>
      this.call(r, url, { method, headers: { Accept: ACCEPT, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    let res = await ask(this.tokens.get(key));
    if (res.status === 401) {
      const challenge = parseChallenge(res.headers.get("www-authenticate"));
      if (!challenge) throw new Error(`${r.registry} refused ${r.repository} and said no way in`);
      const token = await this.token(r, challenge);
      this.tokens.set(key, token);
      res = await ask(token);
      if (res.status === 401 || res.status === 403) throw new Error(`${r.registry} asks for credentials to read ${r.repository}`);
    }
    if (res.ok) return res;
    if (res.status === 404) throw new Error(`${r.registry} has no ${r.repository}:${path.startsWith("manifests/") ? path.slice(10) : path}`);
    if (res.status === 429) throw new Error(`${r.registry} is limiting this box's requests (429)`);
    throw new Error(`${r.registry} answered ${res.status} for ${r.repository}`);
  }

  private async token(r: Reference, challenge: { realm: string; params: Record<string, string> }): Promise<string> {
    const url = new URL(challenge.realm);
    for (const [k, v] of Object.entries(challenge.params)) url.searchParams.set(k, v);
    if (!challenge.params.scope) url.searchParams.set("scope", `repository:${r.repository}:pull`);
    const res = await this.call(r, url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`${r.registry} gave no token for ${r.repository} (${res.status})`);
    const body = (await res.json()) as { token?: string; access_token?: string };
    const token = body.token ?? body.access_token;
    if (!token) throw new Error(`${r.registry} gave no token for ${r.repository}`);
    return token;
  }

  private async call(r: Reference, url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const e = err as Error & { cause?: { code?: string; message?: string } };
      const why = e.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : (e.cause?.code ?? e.cause?.message ?? e.message);
      throw new Error(`could not reach ${r.registry}: ${why}`);
    }
  }
}

function pick(labels: Record<string, string | undefined>): ImageInfo {
  const revision = labels[REVISION];
  const created = labels[CREATED];
  return { ...(revision ? { revision } : {}), ...(created ? { created } : {}) };
}
