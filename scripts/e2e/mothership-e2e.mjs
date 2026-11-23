// Phase 2 end-to-end proof: the mothership is mandatory.
//
// Runs inside a container on the stack network (scripts/mothership-e2e.sh),
// so it talks to bifrost and strut the way stadeum-ui does. It does what stadeum-ui's ensureDelegation does (docs/mothership-spec.md)
// for one test person, then proves:
//
//   1. a Strut LLM step run as that person goes through bifrost and is
//      billed to them (spend by macaroon user, bifrost customer, VK log);
//   2. bifrost holds the provider key: the upstream sees bifrost's key,
//      never the VK;
//   3. no delegation -> refused (Strut), and bifrost itself refuses a call
//      with no VK or with a VK but no macaroon;
//   4. a run over its cap is stopped by bifrost (402 run_cost_exceeded);
//   5. a person over their delegation ceiling cannot start another call;
//   6. an OpenAI-compatible provider the gateway holds as a custom provider
//      (what the Models page adds for Maple, Numes and Other): its model,
//      `<provider>/<id>`, is routed to it with the gateway's key, billed to
//      the person, and priced from the gateway's runtime price table. For
//      the run it sets strut's STRUT_MODELS (strut routes a provider aieo
//      does not know only when the host lists its model) and then removes
//      it; stadeum-ui writes the org's list back on its next pass.
//   7. a grant's key, as stadeum-ui makes one for a machine outside the box
//      (a pod): through Caddy's mothership.$HOST, the joined
//      `<virtual key>.<macaroon>` works in `x-api-key` and in
//      `Authorization: Bearer`, billed to the person; the site has nothing
//      but the providers' endpoints; the gateway stops the key at its own
//      budget, after its expiry, and once it is deleted. The macaroon is a
//      grant as strut makes one (a third block off the delegation), and
//      with that block stripped the gateway refuses it.
//
// The macaroon is v2 (a signed block chain with a proof key): a run's
// spend lands on its own counter and on block 0's (the person's grant),
// and a token with its last block dropped is refused (`invalid_proof`).
//
// Provider: real when bifrost holds an Anthropic key (set on stadeum's
// Models page); otherwise a fake Anthropic upstream served from this
// container, wired into bifrost's anthropic provider for the run and removed
// afterwards. Exit code 0 only if every assertion passed.

import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { attenuate, bytesToHex, decodeToken, ed25519PublicKey, encodeToken, hexToBytes, signRoot, verify } from "gatekey";

const BIFROST = "http://bifrost:8181";
const STRUT = "http://strut:3000";
const T = must("SHARED_API_TOKEN");
const ADMIN_PASS = must("BIFROST_ADMIN_PASS");
// Set in main: whether bifrost holds an Anthropic key.
let REAL = false;
const MODEL = process.env.E2E_MODEL || "claude-haiku-4-5";
const FAKE_HOST = "fake-llm";
const FAKE_PORT = 9999;
const FAKE_KEY = `fake-upstream-${randomBytes(4).toString("hex")}`;
// The custom provider of section 6, its model and its price (USD per million tokens).
const COMPAT = "e2e-compat";
const COMPAT_MODEL = `${COMPAT}/fake-1`;
const COMPAT_KEY = `fake-compat-${randomBytes(4).toString("hex")}`;
const COMPAT_PRICE = { input_per_mtok: 10, output_per_mtok: 30 };
const ALICE = "alice@acme.test"; // delegated
const BOB = "bob@acme.test"; // never delegated
const CAROL = "carol@acme.test"; // delegated with a tiny ceiling
const CAROL_CEILING_USD = 0.00001;
// alice's delegation ceiling (block 1's max_cost_usd). Must be >= Strut's
// default per-run cap ($100, STRUT_RUN_MAX_COST_USD), or every uncapped
// workflow fails with "workflow cap $100 exceeds the delegation ceiling".
const CEILING_USD = 1000;
const RUN_CAP_USD = 0.00001; // per-run cap on the capped workflow
// Section 7: the gateway's public route, and the grants' keys made there.
const MOTHERSHIP = `mothership.${must("HOST")}`;
const grantKeys = [];

function must(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// ── output ──────────────────────────────────────────────────────────────
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
}
/** bifrost writes logs, spend and budget usage asynchronously: poll. */
async function eventually(fn, ms = 20_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const section = (s) => console.log(`\n== ${s}`);
const show = (label, v) => console.log(`  ${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

// ── http ────────────────────────────────────────────────────────────────
const basic = `Basic ${Buffer.from(`admin:${ADMIN_PASS}`).toString("base64")}`;
async function http(method, url, { headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {}
  return { status: res.status, json, text };
}
async function ok(method, url, opts) {
  const r = await http(method, url, opts);
  if (r.status < 200 || r.status >= 300) throw new Error(`${method} ${url} -> ${r.status}: ${r.text.slice(0, 300)}`);
  return r.json;
}
const gov = (method, path, body) => ok(method, `${BIFROST}${path}`, { headers: { Authorization: basic }, body });
const plugin = (method, path, body) => ok(method, `${BIFROST}${path}`, { headers: { Authorization: `Bearer ${T}` }, body });
// The deployment key; beside it, x-strut-actor names who a request is for.
const strutAdmin = { Authorization: `Bearer ${T}` };
const as = (actor) => ({ ...strutAdmin, "x-strut-actor": actor });

// ── fake Anthropic upstream ─────────────────────────────────────────────
const upstreamSeen = [];
function startFakeUpstream() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {}
      if (req.url === "/v1/chat/completions") return openaiReply(req, res, body);
      upstreamSeen.push({
        path: req.url,
        xApiKey: req.headers["x-api-key"] ?? null,
        authorization: req.headers.authorization ?? null,
        macaroonForwarded: "x-macaroon" in req.headers,
        model: body.model,
      });
      const model = body.model || MODEL;
      const usage = { input_tokens: 1000, output_tokens: 100 };
      const text = "pong";
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev("message_start", { message: { id: "msg_e2e", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: usage.input_tokens, output_tokens: 0 } } });
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
        ev("content_block_stop", { index: 0 });
        ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
        ev("message_stop", {});
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: `msg_${randomUUID()}`, type: "message", role: "assistant", model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage }));
    });
  });
  return new Promise((resolve) => server.listen(FAKE_PORT, "0.0.0.0", () => resolve(server)));
}

// The OpenAI-compatible upstream behind section 6's custom provider: bifrost
// appends /v1/chat/completions to the provider's root.
const compatSeen = [];
function openaiReply(req, res, body) {
  compatSeen.push({ authorization: req.headers.authorization ?? null, macaroonForwarded: "x-macaroon" in req.headers, model: body.model });
  const usage = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 };
  const id = `chatcmpl-${randomUUID()}`;
  if (body.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (o) => res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model: body.model, ...o })}\n\n`);
    chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "pong" }, finish_reason: null }] });
    chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    chunk({ choices: [], usage });
    res.end("data: [DONE]\n\n");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id, object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }], usage }));
}

let fakeKeyId = null;
let savedNetworkConfig = null;
async function wireFakeProvider() {
  const cur = await gov("GET", "/api/providers/anthropic");
  savedNetworkConfig = cur.network_config;
  await gov("PUT", "/api/providers/anthropic", {
    // The fake lives on the docker network; bifrost's SSRF guard needs leave.
    network_config: { ...cur.network_config, base_url: `http://${FAKE_HOST}:${FAKE_PORT}`, allow_private_network: true },
    concurrency_and_buffer_size: cur.concurrency_and_buffer_size,
  });
  const key = await gov("POST", "/api/providers/anthropic/keys", { name: "e2e-fake", value: FAKE_KEY, models: ["*"], weight: 1 });
  fakeKeyId = key.id;
}
async function unwireFakeProvider() {
  if (fakeKeyId) await gov("DELETE", `/api/providers/anthropic/keys/${fakeKeyId}`).catch((e) => console.warn(`restore: ${e.message}`));
  if (savedNetworkConfig) {
    const cur = await gov("GET", "/api/providers/anthropic");
    const { base_url, allow_private_network, ...rest } = savedNetworkConfig;
    await gov("PUT", "/api/providers/anthropic", { network_config: rest, concurrency_and_buffer_size: cur.concurrency_and_buffer_size }).catch((e) =>
      console.warn(`restore: ${e.message}`),
    );
  }
}

// ── org key (written by stack/bootstrap/org-identity.mjs) ───────────────
function loadOrgKey() {
  const file = JSON.parse(readFileSync("/org/org-key.json", "utf8"));
  const raw = must("STADEUM_ENCRYPTION_KEY");
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  const [, iv, tag, ct] = file.privkey_enc.split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from("orgPrivkey"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  const privHex = Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  return { orgId: file.org_id, pubkey: file.pubkey, privkey: hexToBytes(privHex) };
}

// ── customer + VK (Hive reconciler shape, as stadeum-ui does) ───────────
async function ensureCustomerAndVk(name) {
  const found = (await gov("GET", `/api/governance/customers?search=${encodeURIComponent(name)}&limit=50`)).customers?.find((c) => c.name === name);
  const customer =
    found ??
    (
      await gov("POST", "/api/governance/customers", {
        name,
        budget: { max_limit: 1000, reset_duration: "1d" },
        rate_limit: { request_max_limit: 1000, request_reset_duration: "1m" },
      })
    ).customer;
  const vks = await gov("GET", `/api/governance/virtual-keys?search=${encodeURIComponent(name)}&customer_id=${customer.id}&limit=50`);
  const vk =
    vks.virtual_keys?.find((v) => v.name === name && v.customer_id === customer.id) ??
    (
      await gov("POST", "/api/governance/virtual-keys", {
        name,
        description: `stadeum ${name}`,
        customer_id: customer.id,
        provider_configs: [{ provider: "anthropic", allowed_models: ["*"], key_ids: ["*"] }],
      })
    ).virtual_key;
  return { customer, vk };
}

/** A grant's key, as stadeum-ui makes one (ui/src/lib/mothership/grant-key.ts). */
async function grantKey(customer, { capUsd = 50, seconds = 3600 } = {}) {
  const vk = (
    await gov("POST", "/api/governance/virtual-keys", {
      name: `grant:e2e:${randomBytes(4).toString("hex")}`,
      description: "stadeum grant e2e",
      customer_id: customer.id,
      provider_configs: [{ provider: "anthropic", allowed_models: ["*"], key_ids: ["*"] }],
      budgets: [{ max_limit: capUsd, reset_duration: "1w" }],
      expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
    })
  ).virtual_key;
  grantKeys.push(vk.id);
  return vk;
}

/**
 * A request to Caddy as a machine outside the box sends it: to
 * mothership.$HOST. Plain http locally (stack/dev.yml); on a box Caddy
 * redirects that to https, so it goes again over TLS with the name.
 */
function viaCaddy(method, path, headers = {}, body) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const opts = (port) => ({
    host: "caddy",
    port,
    path,
    method,
    servername: MOTHERSHIP,
    headers: { host: MOTHERSHIP, ...(data ? { "content-type": "application/json" } : {}), ...headers },
  });
  const send = (req, port) =>
    new Promise((resolve, reject) => {
      const r = req(opts(port), (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      });
      r.on("error", reject);
      r.setTimeout(60_000, () => r.destroy(new Error(`${method} ${path} timed out`)));
      if (data) r.write(data);
      r.end();
    });
  return send(httpRequest, 80).then((r) => (r.status >= 300 && r.status < 400 ? send(httpsRequest, 443) : r));
}

// ── macaroon (docs/mothership-spec.md §d) ───────────────────────────────
// What stadeum-ui's mint.ts does: block 0 (the org grants the person),
// block 1 (the person hands strut the run, with the ceiling), proof = a
// fresh key of strut's.
const nonce = () => bytesToHex(new Uint8Array(randomBytes(16)));
function mintDelegation(org, actor, ceilingUsd) {
  const userPriv = new Uint8Array(randomBytes(32));
  const now = new Date();
  const iat = now.toISOString();
  const exp = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
  const grant = signRoot(
    org.orgId,
    { run_id: `ua_${randomUUID()}`, user_id: actor, agents: ["strut-agent"], iat, exp, nonce: nonce() },
    { alg: "ed25519", key: bytesToHex(ed25519PublicKey(userPriv)) },
    { alg: "ecdsa-secp256k1-sha256", priv: org.privkey },
  );
  const runId = randomUUID();
  const token = encodeToken(
    attenuate(
      { v: 2, org_id: org.orgId, blocks: [grant], proof: bytesToHex(userPriv) },
      { run_id: runId, agent: "strut-agent", max_cost_usd: ceilingUsd, iat, exp, nonce: nonce() },
    ),
  );
  verify(token, { type: "single", key: { alg: "ecdsa-secp256k1-sha256", key: org.pubkey } }, now);
  return { token, delegationId: runId, grantRunId: grant.caveats.run_id };
}

/**
 * The gateway's `invalid_proof` refusal. Its provider-shaped error body
 * carries the message, not the code (the code is in its log: `verify FAIL
 * … code=invalid_proof`); mothership `auth/go/verify.go`, ErrInvalidProof.
 */
const INVALID_PROOF = /proof is not the private key of the last block's next_key|invalid_proof/;

/** A token with its last block dropped and the proof kept: what a holder would try to reach the block above. */
function dropLastBlock(token) {
  const t = decodeToken(token);
  return encodeToken({ ...t, blocks: t.blocks.slice(0, -1) });
}

/** A grant as strut makes one (strut src/mothership.ts, `grant`): one more block off the delegation, with a key of its own. */
function grantMacaroon(delegationToken, { name = "e2e.grant", capUsd = 50, seconds = 3600 } = {}) {
  const now = new Date();
  return encodeToken(
    attenuate(decodeToken(delegationToken), {
      run_id: `grant-${nonce()}`,
      agent: name,
      max_cost_usd: capUsd,
      iat: now.toISOString(),
      exp: new Date(now.getTime() + seconds * 1000).toISOString(),
      nonce: nonce(),
    }),
  );
}

// ── Strut ───────────────────────────────────────────────────────────────
/** Publish, or publish a new version over a previous run's. */
async function putWorkflow(name, yaml) {
  const have = await http("GET", `${STRUT}/workflows/${name}`, { headers: strutAdmin });
  if (have.status === 404) await ok("POST", `${STRUT}/workflows`, { headers: strutAdmin, body: { name, yaml } });
  else await ok("POST", `${STRUT}/workflows/${name}`, { headers: strutAdmin, body: { version: `v${Date.now()}`, yaml } });
}
async function runAs(workflow, auth) {
  const { runId } = await ok("POST", `${STRUT}/workflows/${workflow}/run`, { headers: auth, body: { input: {} } });
  for (let i = 0; i < 120; i++) {
    const r = await http("GET", `${STRUT}/workflows/${workflow}/runs/${runId}`, { headers: strutAdmin });
    // The run record appears a moment after the 202.
    if (r.status === 404 && i < 15) {
      await new Promise((res) => setTimeout(res, 1000));
      continue;
    }
    if (r.status !== 200) throw new Error(`GET run ${workflow}/${runId} -> ${r.status}: ${r.text.slice(0, 300)}`);
    const run = r.json;
    if (run.status && !["running", "pending", "queued"].includes(run.status)) return { runId, run };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`run ${workflow}/${runId} did not finish`);
}
/** The run's step errors, from its event log. */
async function runErrors(workflow, runId) {
  const r = await http("GET", `${STRUT}/workflows/${workflow}/runs/${runId}/events`, { headers: strutAdmin });
  const events = Array.isArray(r.json) ? r.json : (r.json?.events ?? []);
  const msgs = events.map((e) => e.error ?? e.data?.error ?? e.payload?.error).filter(Boolean);
  return [...new Set(msgs.map((m) => (typeof m === "string" ? m : (m.message ?? JSON.stringify(m)))))];
}
const text = (e) => (typeof e === "string" ? e : (e?.message ?? JSON.stringify(e)));
const errorsOf = async (wf, { runId, run }) =>
  [...new Set([run.error, ...(await runErrors(wf, runId))].filter(Boolean).map(text))].join(" | ");
const stepOk = (run, id) => run.steps?.[id]?.status ?? run.stepStatus?.[id] ?? undefined;

const LLM_STEP = (id) => `  - id: ${id}\n    type: llm\n    config:\n      prompt: "Reply with the single word: pong"\n      model: ${MODEL}\n`;
const ONE = `name: e2e-llm\ndescription: Phase 2 e2e. One LLM step.\nsteps:\n${LLM_STEP("ask")}`;
const CEIL = `name: e2e-llm-ceiling\ndescription: Phase 2 e2e. One LLM step, run cap under carol's ceiling.\nsteps:\n${LLM_STEP("ask")}`;
const TWO = `name: e2e-llm-capped\ndescription: Phase 2 e2e. Two LLM steps under a tiny run cap.\nsteps:\n${LLM_STEP("ask1")}${LLM_STEP("ask2")}`;
const COMPAT_FLOW = `name: e2e-compat\ndescription: Models e2e. One LLM step on a custom provider.\nsteps:\n  - id: ask\n    type: llm\n    config:\n      prompt: "Reply with the single word: pong"\n      model: ${COMPAT_MODEL}\n`;

// ── main ────────────────────────────────────────────────────────────────
let server;
// What section 6 changed, put back in `finally`.
let compatAdded = false;
let savedPricing = null;
let strutModelsSet = false;
try {
  section("setup");
  // A key's redacted value is a masked preview, or `{ value }` for an env slot ("" when unset).
  const anthropicKeys = (await gov("GET", "/api/providers/anthropic/keys")).keys ?? [];
  REAL = anthropicKeys.some((k) => (typeof k.value === "string" ? k.value : k.value?.value));
  show("provider", REAL ? "real (the Anthropic key bifrost holds)" : `fake upstream http://${FAKE_HOST}:${FAKE_PORT} (bifrost holds no Anthropic key)`);
  show("model", MODEL);

  const creds = await plugin("GET", "/_plugin/admin-credentials");
  check("bifrost /_plugin/admin-credentials exists and matches BIFROST_ADMIN_PASS", creds.admin_username === "admin" && creds.admin_password === ADMIN_PASS);

  const enforcing = await http("POST", `${BIFROST}/anthropic/v1/messages`, {
    headers: { "x-api-key": "nobody", "anthropic-version": "2023-06-01" },
    body: { model: MODEL, max_tokens: 8, messages: [{ role: "user", content: "hi" }] },
  });
  show("bifrost, unknown key, no macaroon", `${enforcing.status} ${enforcing.text.slice(0, 160)}`);

  const org = loadOrgKey();
  const trust = await plugin("GET", `/_plugin/trust/${encodeURIComponent(org.orgId)}`);
  check("org key in /org/org-key.json is the one bifrost trusts", trust.pubkey === org.pubkey, `${org.orgId} ${org.pubkey}`);

  if (!REAL) {
    server = await startFakeUpstream();
    await wireFakeProvider();
  }

  const { customer, vk } = await ensureCustomerAndVk(ALICE);
  show("alice customer", { id: customer.id, name: customer.name });
  show("alice VK", { id: vk.id, value: `${vk.value.slice(0, 8)}…` });

  const del = mintDelegation(org, ALICE, CEILING_USD);
  const pushed = await ok("PUT", `${STRUT}/llm/delegations/${encodeURIComponent(ALICE)}`, {
    headers: strutAdmin,
    body: { macaroon: del.token, apiKey: vk.value, baseUrl: BIFROST },
  });
  show("PUT /llm/delegations/alice", pushed);
  await http("DELETE", `${STRUT}/llm/delegations/${encodeURIComponent(BOB)}`, { headers: strutAdmin });

  await putWorkflow("e2e-llm", ONE);
  await putWorkflow("e2e-llm-capped", TWO);
  await ok("PUT", `${STRUT}/workflows/e2e-llm-capped/run-cap`, { headers: strutAdmin, body: { maxRunCostUsd: RUN_CAP_USD } });
  await putWorkflow("e2e-llm-ceiling", CEIL);
  // Strut refuses a run cap above the delegation ceiling, so it sits under carol's.
  await ok("PUT", `${STRUT}/workflows/e2e-llm-ceiling/run-cap`, { headers: strutAdmin, body: { maxRunCostUsd: CAROL_CEILING_USD / 2 } });

  section("1. delegated run, billed to alice");
  const usageBefore = (await gov("GET", `/api/governance/customers/${customer.id}`)).customer?.budgets?.[0]?.current_usage ?? 0;
  const a = await runAs("e2e-llm", as(ALICE));
  show("run", { runId: a.runId, status: a.run.status, actor: a.run.actor, output: a.run.output?.text ?? a.run.output });
  check("alice's run succeeds", a.run.status === "success", a.run.status === "success" ? "" : await errorsOf("e2e-llm", a));
  check("the run's actor is alice", a.run.actor === ALICE);

  // bifrost's own request log: the call, under alice's VK and customer, with
  // the macaroon's claims stamped as metadata.
  const log = await eventually(async () =>
    ((await gov("GET", "/api/logs?limit=50")).logs ?? []).find((l) => l.metadata?.["run-id"] === a.runId),
  );
  show(
    "bifrost log for the run",
    log && {
      model: log.model,
      status: log.status,
      cost: log.token_usage?.cost?.total_cost ?? log.cost,
      customer: log.customer_name,
      virtual_key: log.virtual_key_name,
      provider_key: log.selected_key_name,
      macaroon_user: log.metadata?.["user-id"],
      org: log.metadata?.["org-id"],
      run: log.metadata?.["run-id"],
    },
  );
  check(
    "bifrost logged the call under alice's customer, VK and macaroon user",
    !!log && log.status === "success" && log.customer_name === ALICE && log.virtual_key_id === vk.id && log.metadata?.["user-id"] === ALICE,
  );
  const userUrl = `/_plugin/users/${encodeURIComponent(ALICE)}`;
  const user =
    (await eventually(async () => {
      const u = await plugin("GET", userUrl);
      return u.recent_runs?.some((r) => r.run_id === a.runId) ? u : null;
    })) ?? (await plugin("GET", userUrl));
  show(`GET /_plugin/users/${ALICE}`, { total_cost: user.total_cost, request_count: user.request_count, runs: user.recent_runs?.map((r) => r.run_id) });
  check("bifrost's per-person spend includes the run", !!user.recent_runs?.some((r) => r.run_id === a.runId) && user.total_cost > 0);
  const budgetOf = async () => (await gov("GET", `/api/governance/customers/${customer.id}`)).customer?.budgets?.[0];
  const usageAfter = (await eventually(async () => {
    const b = await budgetOf();
    return (b?.current_usage ?? 0) > usageBefore ? b : null;
  })) ?? (await budgetOf());
  show("alice customer budget", { max_limit: usageAfter?.max_limit, reset: usageAfter?.reset_duration, current_usage_before: usageBefore, current_usage_after: usageAfter?.current_usage });
  check("alice's customer budget was charged", (usageAfter?.current_usage ?? 0) > usageBefore);

  // v2: every block is a layer with its own counter. The run's spend lands
  // on strut's run block and on block 0, alice's grant (`ua_…`).
  const runState = async (id) => (await http("GET", `${BIFROST}/_plugin/runs/${encodeURIComponent(id)}/state`, { headers: { Authorization: `Bearer ${T}` } })).json;
  const spent = async (id) => eventually(async () => ((await runState(id))?.cost_usd > 0 ? runState(id) : null));
  const [runSpent, grantSpent, delegationSpent] = [await spent(a.runId), await spent(del.grantRunId), await spent(del.delegationId)];
  show("gateway counters", {
    run: runSpent && { id: a.runId, cost_usd: runSpent.cost_usd },
    "block 0": grantSpent && { id: del.grantRunId, cost_usd: grantSpent.cost_usd },
    "block 1": delegationSpent && { id: del.delegationId, cost_usd: delegationSpent.cost_usd },
  });
  check("the run's spend is on its own counter", (runSpent?.cost_usd ?? 0) > 0);
  check("and on block 0's, alice's grant (ua_…)", del.grantRunId.startsWith("ua_") && (grantSpent?.cost_usd ?? 0) > 0);

  if (!REAL) {
    const calls = upstreamSeen.filter((u) => u.path?.includes("/messages"));
    const keys = [...new Set(calls.map((u) => u.xApiKey))];
    show("upstream /v1/messages calls", calls.length);
    show("upstream saw x-api-key", keys);
    check(
      "the provider key came from bifrost (not the VK)",
      calls.length > 0 && keys.every((k) => k === FAKE_KEY),
    );
    check("the macaroon is not forwarded to the provider", upstreamSeen.every((u) => !u.macaroonForwarded));
  }

  section("2. no delegation, no model call");
  const before = upstreamSeen.length;
  const b = await runAs("e2e-llm", as(BOB));
  const bErr = await errorsOf("e2e-llm", b);
  show("bob's run", { status: b.run.status, actor: b.run.actor, error: bErr });
  check("bob (no delegation) is refused by Strut", b.run.status !== "success" && /no Mothership authorization/i.test(bErr));
  const n = await runAs("e2e-llm", strutAdmin);
  const nErr = await errorsOf("e2e-llm", n);
  show("run with no actor", { status: n.run.status, actor: n.run.actor ?? null, error: nErr });
  check("a run with no actor is refused by Strut", n.run.status !== "success" && /nobody to bill/i.test(nErr));
  if (!REAL) check("neither refused run reached the provider", upstreamSeen.length === before);

  const msg = { model: MODEL, max_tokens: 8, messages: [{ role: "user", content: "hi" }] };
  const noVk = await http("POST", `${BIFROST}/anthropic/v1/messages`, { headers: { "x-api-key": "not-a-virtual-key", "anthropic-version": "2023-06-01" }, body: msg });
  show("bifrost, a key it never issued", `${noVk.status} ${noVk.text.slice(0, 200)}`);
  check("bifrost refuses a key it never issued (no model call around it)", noVk.status === 401 || noVk.status === 403);
  const vkOnly = await http("POST", `${BIFROST}/anthropic/v1/messages`, { headers: { "x-api-key": vk.value, "anthropic-version": "2023-06-01" }, body: msg });
  show("bifrost, alice's VK without a macaroon", `${vkOnly.status} ${vkOnly.text.slice(0, 200)}`);
  check("bifrost refuses a VK without a macaroon", vkOnly.status === 401);
  const shortened = await http("POST", `${BIFROST}/anthropic/v1/messages`, {
    headers: { "x-api-key": vk.value, "x-macaroon": dropLastBlock(del.token), "anthropic-version": "2023-06-01" },
    body: msg,
  });
  show("bifrost, alice's VK with her macaroon's last block dropped", `${shortened.status} ${shortened.text.slice(0, 200)}`);
  check("bifrost refuses a macaroon with its last block dropped (invalid_proof)", shortened.status === 401 && INVALID_PROOF.test(shortened.text));
  if (!REAL) check("neither refused gateway call reached the provider", upstreamSeen.length === before);

  section("3. over the cap");
  const beforeCap = upstreamSeen.length;
  const c = await runAs("e2e-llm-capped", as(ALICE));
  const cErr = await errorsOf("e2e-llm-capped", c);
  show("capped run", { runId: c.runId, status: c.run.status, cap: RUN_CAP_USD, error: cErr });
  check("the run is stopped once it is over its cap", c.run.status !== "success" && /run_cost_exceeded|spent \$|cap/i.test(cErr));
  const state = await http("GET", `${BIFROST}/_plugin/runs/${c.runId}/state`, { headers: { Authorization: `Bearer ${T}` } });
  show(`GET /_plugin/runs/${c.runId}/state`, state.json ?? `${state.status} ${state.text.slice(0, 200)}`);
  const root = await http("GET", `${BIFROST}/_plugin/runs/${del.delegationId}/state`, { headers: { Authorization: `Bearer ${T}` } });
  show(`alice's delegation ${del.delegationId} state`, root.json ?? `${root.status} ${root.text.slice(0, 200)}`);
  if (!REAL) check("only the first step reached the provider", upstreamSeen.filter((u) => u.path?.includes("/messages")).length - upstreamSeen.slice(0, beforeCap).filter((u) => u.path?.includes("/messages")).length === 1);

  section("4. over the person's delegation ceiling");
  const carol = await ensureCustomerAndVk(CAROL);
  const cdel = mintDelegation(org, CAROL, CAROL_CEILING_USD);
  await ok("PUT", `${STRUT}/llm/delegations/${encodeURIComponent(CAROL)}`, {
    headers: strutAdmin,
    body: { macaroon: cdel.token, apiKey: carol.vk.value, baseUrl: BIFROST },
  });
  const carolAuth = as(CAROL);
  const c1 = await runAs("e2e-llm-ceiling", carolAuth);
  show("carol run 1", { status: c1.run.status, ceiling: CAROL_CEILING_USD });
  check("carol's first run is allowed (nothing spent yet)", c1.run.status === "success", c1.run.status === "success" ? "" : await errorsOf("e2e-llm-ceiling", c1));
  const c2 = await runAs("e2e-llm-ceiling", carolAuth);
  const c2Err = await errorsOf("e2e-llm-ceiling", c2);
  show("carol run 2", { status: c2.run.status, error: c2Err });
  check("carol's next run is stopped: her delegation ceiling is spent", c2.run.status !== "success" && c2Err.includes(cdel.delegationId));
  const cstate = await plugin("GET", `/_plugin/runs/${cdel.delegationId}/state`);
  show(`carol's delegation ${cdel.delegationId} state`, { cost_usd: cstate.cost_usd, max_cost_usd: cstate.max_cost_usd, steps: cstate.steps });

  section("5. an OpenAI-compatible provider through the gateway, billed to alice");
  if (!server) server = await startFakeUpstream();
  // As the Models page adds one: the provider, then its key (bifrost drops a key sent with the provider).
  await http("DELETE", `${BIFROST}/api/providers/${COMPAT}`, { headers: { Authorization: basic } });
  await gov("POST", "/api/providers", {
    provider: COMPAT,
    network_config: { base_url: `http://${FAKE_HOST}:${FAKE_PORT}`, allow_private_network: true },
    custom_provider_config: { base_provider_type: "openai" },
  });
  compatAdded = true;
  await gov("POST", `/api/providers/${COMPAT}/keys`, { name: `${COMPAT}-key-1`, value: COMPAT_KEY, models: ["*"], weight: 1 });
  savedPricing = await plugin("GET", "/_plugin/pricing");
  await plugin("PUT", "/_plugin/pricing", { ...savedPricing, [COMPAT_MODEL]: COMPAT_PRICE });
  // alice's key gets the provider, as stadeum-ui's grant sync does.
  const akey = (await gov("GET", `/api/governance/virtual-keys/${vk.id}`)).virtual_key;
  const carried = (akey.provider_configs ?? [])
    .filter((pc) => pc.provider !== COMPAT)
    .map((pc) => ({ id: pc.id, provider: pc.provider, allowed_models: pc.allowed_models ?? ["*"], key_ids: ["*"] }));
  await gov("PUT", `/api/governance/virtual-keys/${vk.id}`, {
    provider_configs: [...carried, { provider: COMPAT, allowed_models: ["fake-1"], key_ids: ["*"] }],
  });
  await ok("PUT", `${STRUT}/secrets/STRUT_MODELS`, { headers: strutAdmin, body: { value: JSON.stringify([COMPAT_MODEL]) } });
  strutModelsSet = true;
  await putWorkflow("e2e-compat", COMPAT_FLOW);

  const compatBefore = compatSeen.length;
  const x = await runAs("e2e-compat", as(ALICE));
  show("run", { runId: x.runId, status: x.run.status, output: x.run.output?.text ?? x.run.output });
  check(`alice's run on ${COMPAT_MODEL} succeeds`, x.run.status === "success", x.run.status === "success" ? "" : await errorsOf("e2e-compat", x));
  const xcalls = compatSeen.slice(compatBefore);
  show("upstream /v1/chat/completions calls", xcalls.map((c) => ({ model: c.model, auth: c.authorization === `Bearer ${COMPAT_KEY}` ? "the gateway's key" : c.authorization })));
  check("the custom provider got the model id without its prefix, with the gateway's key", xcalls.length > 0 && xcalls.every((c) => c.model === "fake-1" && c.authorization === `Bearer ${COMPAT_KEY}`));
  check("the macaroon is not forwarded to the custom provider", xcalls.every((c) => !c.macaroonForwarded));
  const xlog = await eventually(async () =>
    ((await gov("GET", "/api/logs?limit=50")).logs ?? []).find((l) => l.metadata?.["run-id"] === x.runId),
  );
  show("bifrost log for the run", xlog && { provider: xlog.provider, model: xlog.model, status: xlog.status, customer: xlog.customer_name });
  check("bifrost logged the call under alice, on the custom provider", !!xlog && xlog.status === "success" && xlog.customer_name === ALICE && xlog.provider === COMPAT);
  const xwant = (1000 * COMPAT_PRICE.input_per_mtok + 100 * COMPAT_PRICE.output_per_mtok) / 1e6;
  const xrun = await eventually(async () => {
    const st = await plugin("GET", `/_plugin/runs/${x.runId}/state`).catch(() => null);
    return st && st.cost_usd > 0 ? st : null;
  });
  show("the run's spend at the gateway", { cost_usd: xrun?.cost_usd, priced_at: xwant });
  check("the gateway priced it from its runtime price table", !!xrun && Math.abs(xrun.cost_usd - xwant) < 1e-9);

  section(`6. a grant's key, from outside the box: ${MOTHERSHIP}`);
  const gk = await grantKey(customer);
  const granted = grantMacaroon(del.token);
  const joined = `${gk.value}.${granted}`;
  check("a virtual key holds no '.', so the gateway's split finds the macaroon", /^sk-bf-[A-Za-z0-9_-]+$/.test(gk.value) && !granted.includes("."));
  const anthropicCall = (key) => viaCaddy("POST", "/anthropic/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" }, msg);
  const seenBefore = upstreamSeen.length;
  const g1 = await anthropicCall(joined);
  show("POST /anthropic/v1/messages, x-api-key: the joined key", `${g1.status} ${g1.text.slice(0, 160)}`);
  check("the joined key in x-api-key is answered", g1.status === 200);
  const g2 = await viaCaddy("POST", "/openai/v1/chat/completions", { authorization: `Bearer ${joined}` }, {
    model: `anthropic/${MODEL}`,
    max_tokens: 8,
    messages: [{ role: "user", content: "hi" }],
  });
  show("POST /openai/v1/chat/completions, Authorization: Bearer the joined key", `${g2.status} ${g2.text.slice(0, 160)}`);
  check("the joined key as a Bearer token is answered", g2.status === 200);
  if (!REAL) {
    const seen = upstreamSeen.slice(seenBefore);
    check("the provider saw the gateway's key, never the grant's key or the macaroon", seen.length === 2 && seen.every((u) => u.xApiKey === FAKE_KEY && !u.macaroonForwarded));
  }
  const glog = await eventually(async () => ((await gov("GET", "/api/logs?limit=50")).logs ?? []).find((l) => l.virtual_key_id === gk.id));
  show("bifrost log for the grant's call", glog && { customer: glog.customer_name, virtual_key: glog.virtual_key_name, user: glog.metadata?.["user-id"] });
  check("bifrost logged it under alice's customer and the grant's key", !!glog && glog.customer_name === ALICE && glog.metadata?.["user-id"] === ALICE);

  const shut = [];
  for (const path of ["/", "/api/governance/virtual-keys", "/_plugin/health", "/_plugin/admin-credentials", "/openai/%2e%2e/api/governance/virtual-keys", "/anthropic/..%2f_plugin/health"]) {
    const r = await viaCaddy("GET", path, { authorization: basic });
    shut.push(`${path} ${r.status}`);
  }
  show("other paths on the site, with the admin's credentials", shut);
  check("the site has nothing but the providers' endpoints", shut.every((l) => l.endsWith(" 404")));

  const stripped = await anthropicCall(`${gk.value}.${dropLastBlock(granted)}`);
  show("the grant's key with the grant's block stripped from its macaroon", `${stripped.status} ${stripped.text.slice(0, 160)}`);
  check("a grant stripped back to strut's delegation is refused (invalid_proof)", stripped.status === 401 && INVALID_PROOF.test(stripped.text));

  const alone = await anthropicCall(gk.value);
  show("the grant's key without the macaroon", `${alone.status} ${alone.text.slice(0, 120)}`);
  check("the grant's key alone is refused", alone.status === 401);

  const capped = await grantKey(customer, { capUsd: 0.000001 });
  const cappedKey = `${capped.value}.${granted}`;
  const k1 = await anthropicCall(cappedKey);
  const k2 = (await eventually(async () => {
    const r = await anthropicCall(cappedKey);
    return r.status === 200 ? null : r;
  })) ?? { status: 200, text: "" };
  show("a grant's key over its budget", { first: k1.status, later: `${k2.status} ${k2.text.slice(0, 160)}` });
  check("the gateway stops a grant's key at its own budget", k1.status === 200 && k2.status === 402);

  const brief = await grantKey(customer, { seconds: 3 });
  const briefKey = `${brief.value}.${granted}`;
  await new Promise((r) => setTimeout(r, 5000));
  const late = await anthropicCall(briefKey);
  show("a grant's key past its expiry", `${late.status} ${late.text.slice(0, 160)}`);
  check("the gateway refuses a grant's key past its expiry", late.status === 403 || late.status === 401);

  await gov("DELETE", `/api/governance/virtual-keys/${gk.id}`);
  const gone = await anthropicCall(joined);
  show("a deleted grant's key", `${gone.status} ${gone.text.slice(0, 120)}`);
  check("a deleted grant's key is refused", gone.status === 401);
} catch (err) {
  check("e2e script ran to completion", false, err.stack ?? String(err));
} finally {
  for (const who of [ALICE, CAROL]) {
    await http("DELETE", `${STRUT}/llm/delegations/${encodeURIComponent(who)}`, { headers: strutAdmin }).catch(() => {});
  }
  if (!REAL) await unwireFakeProvider();
  if (compatAdded) await http("DELETE", `${BIFROST}/api/providers/${COMPAT}`, { headers: { Authorization: basic } }).catch(() => {});
  if (savedPricing) await http("PUT", `${BIFROST}/_plugin/pricing`, { headers: { Authorization: `Bearer ${T}` }, body: savedPricing }).catch(() => {});
  if (strutModelsSet) await http("DELETE", `${STRUT}/secrets/STRUT_MODELS`, { headers: strutAdmin }).catch(() => {});
  for (const id of grantKeys) await http("DELETE", `${BIFROST}/api/governance/virtual-keys/${id}`, { headers: { Authorization: basic } }).catch(() => {});
  server?.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${REAL ? "" : " (fake provider upstream)"}`);
process.exit(failed.length ? 1 : 0);
