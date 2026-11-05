// Install-time org identity. Run by the `bootstrap` one-shot service in
// stack/stadeum.yml; safe to re-run (every step is idempotent).
//
//   1. Make the org's secp256k1 macaroon signing key once and store it in the
//      `org` volume as /org/org-key.json (contract: docs/mothership-spec.md,
//      "Org identity file"). The private key is AES-256-GCM encrypted with
//      STADEUM_ENCRYPTION_KEY in the same format stadeum-ui uses at rest.
//   2. Register the pubkey with bifrost's trust registry and set realm_id.
//   3. Seed the agent catalog (best-effort; not needed to accept a macaroon).
//
// No npm dependencies: node:crypto does secp256k1 and AES-GCM.

import { createCipheriv, createDecipheriv, createECDH, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const env = (name, fallback) => {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
};
const need = (name) => {
  const v = env(name);
  if (!v) throw new Error(`${name} is not set (run scripts/init-env.sh)`);
  return v;
};

const KEY_FILE = env("STADEUM_ORG_KEY_FILE", "/org/org-key.json");
const BIFROST_URL = env("BIFROST_URL", "http://bifrost:8181").replace(/\/+$/, "");
const TOKEN = need("SHARED_API_TOKEN");
const SLUG = env("STADEUM_ORG_SLUG", "org");
const ORG_ID = `stadeum_${SLUG}`;
const REALM_ID = SLUG;
// Empty is accepted by the registry (validated only when non-empty).
const ISSUER_URL = env("STADEUM_ISSUER_URL", "");
const REVOCATION_POLL_SECONDS = 60;
const AGENTS = ["strut-agent", "strut-assistant"];

// ── AES-256-GCM, wire-compatible with ui/src/lib/crypto.ts ──────────────
// `v1:<iv b64url>:<tag b64url>:<ciphertext b64url>`, field name as AAD.
function encKey() {
  const raw = need("STADEUM_ENCRYPTION_KEY");
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("STADEUM_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)");
  return buf;
}
function encryptField(field, plaintext) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  c.setAAD(Buffer.from(field, "utf8"));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}
function decryptField(field, stored) {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error(`encrypted ${field} has an unknown format`);
  const d = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(field, "utf8"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

// ── secp256k1: 32-byte private, 33-byte compressed public, hex ──────────
function compressedPubkey(privHex) {
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(privHex, "hex"));
  return ecdh.getPublicKey("hex", "compressed");
}
function generateOrgKey() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const d = Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url");
  const privHex = d.toString("hex").padStart(64, "0");
  return { privHex, pubkey: compressedPubkey(privHex) };
}

function writeAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  const tmp = `${path}.tmp`;
  // 0644: stadeum-ui reads it as a non-root user. The private half is encrypted.
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode: 0o644 });
  renameSync(tmp, path);
}

function ensureOrgKey() {
  if (existsSync(KEY_FILE)) {
    const file = JSON.parse(readFileSync(KEY_FILE, "utf8"));
    if (file.v !== 1 || file.alg !== "secp256k1" || !file.pubkey || !file.privkey_enc) {
      throw new Error(`${KEY_FILE} is not a v1 secp256k1 org key file`);
    }
    // Decrypting proves STADEUM_ENCRYPTION_KEY still matches; deriving proves the pair.
    const privHex = decryptField("orgPrivkey", file.privkey_enc);
    if (compressedPubkey(privHex) !== file.pubkey.toLowerCase()) {
      throw new Error(`${KEY_FILE}: private key does not match pubkey`);
    }
    // A slug change keeps the key (the org id is a label, the key is the trust).
    if (file.org_id !== ORG_ID || file.realm_id !== REALM_ID) {
      writeAtomic(KEY_FILE, { ...file, org_id: ORG_ID, realm_id: REALM_ID });
      console.log(`org key: relabelled ${file.org_id} -> ${ORG_ID}`);
    } else {
      console.log(`org key: kept ${ORG_ID} ${file.pubkey}`);
    }
    return { orgId: ORG_ID, pubkey: file.pubkey.toLowerCase() };
  }
  const { privHex, pubkey } = generateOrgKey();
  writeAtomic(KEY_FILE, {
    v: 1,
    org_id: ORG_ID,
    realm_id: REALM_ID,
    alg: "secp256k1",
    pubkey,
    privkey_enc: encryptField("orgPrivkey", privHex),
    created_at: new Date().toISOString(),
  });
  console.log(`org key: generated ${ORG_ID} ${pubkey}`);
  return { orgId: ORG_ID, pubkey };
}

// ── bifrost /_plugin/* (Bearer SHARED_API_TOKEN) ─────────────────────────
async function plugin(method, path, body) {
  const res = await fetch(`${BIFROST_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function waitForBifrost() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BIFROST_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`bifrost at ${BIFROST_URL} did not become healthy`);
}

async function ensureTrust({ orgId, pubkey }) {
  const status = await plugin("GET", "/_plugin/trust/status");
  if ((status.realm_id ?? "") !== REALM_ID) {
    await plugin("PUT", "/_plugin/trust/realm_id", { realm_id: REALM_ID });
    console.log(`trust: realm_id ${status.realm_id || "(none)"} -> ${REALM_ID}`);
  } else {
    console.log(`trust: realm_id ${REALM_ID}`);
  }
  const row = status.orgs?.includes(orgId) ? await plugin("GET", `/_plugin/trust/${encodeURIComponent(orgId)}`) : null;
  // Pubkey match = done, as in stadeum-ui's ensureOrgTrust, so the two never
  // fight over issuer_url.
  if (row && row.pubkey?.toLowerCase() === pubkey) {
    console.log(`trust: ${orgId} already registered`);
  } else {
    await plugin("POST", "/_plugin/trust", {
      org_id: orgId,
      pubkey,
      issuer_url: ISSUER_URL,
      revocation_poll_seconds: REVOCATION_POLL_SECONDS,
    });
    console.log(`trust: ${orgId} ${row ? "updated" : "registered"}`);
  }
}

async function seedAgents() {
  try {
    await plugin("POST", "/_plugin/agents", { source: "stadeum", agents: AGENTS.map((name) => ({ name })) });
    console.log(`agents: seeded ${AGENTS.join(", ")}`);
  } catch (err) {
    console.warn(`agents: seed skipped (${err.message})`);
  }
}

const keys = ensureOrgKey();
await waitForBifrost();
await ensureTrust(keys);
await seedAgents();
console.log("bootstrap: done");
