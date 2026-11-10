/**
 * Run the fake stack for local development without bifrost, strut or neo4j:
 *   npm run fake-stack        # listens on 127.0.0.1:4555
 * Then point .env at it (see README "Local development").
 *
 * A call (`/voice/calls`) answers with a token for `livekit-server --dev`
 * on this machine, or for LIVEKIT_URL with LIVEKIT_API_KEY and
 * LIVEKIT_API_SECRET when they are set (the box's .env names). No agent
 * joins the room. FAKE_VOICE=402 or 503 makes every call refused that way;
 * FAKE_VOICE=off answers as a strut with no voice service. With
 * STRUT_VOICE_URL (and STRUT_VOICE_TOKEN), calls go to that voice service
 * instead, as strut hands them on. FAKE_READY_AFTER=<ms> holds the framed
 * app page's `strut:ready` that long, as a slow app would: how the frame's
 * "Opening…" is seen.
 *
 * Strut follows no package index at first; the fake knows one, Stakwork's
 * (a made-up key), listing openlaw/legal-desk: the store's Install link it
 * prints opens the Packages page on following it. A package install takes
 * FAKE_INSTALL_MS (default 8000) and walks strut's phases meanwhile, so the
 * page's progress can be seen.
 */
import { DEV_LIVEKIT, startFakeStack } from "../src/test/fake-stack";
import { STAKWORK_INDEX_KEY, STAKWORK_INDEX_URL } from "../src/test/strut-packages";

const port = Number(process.env.FAKE_STACK_PORT ?? 4555);
const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, FAKE_VOICE, FAKE_READY_AFTER, STRUT_VOICE_URL, STRUT_VOICE_TOKEN } = process.env;
const livekit = LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET ? { url: LIVEKIT_URL, apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET } : DEV_LIVEKIT;
// The five providers the real gateway has, each with its empty env key slot.
const fake = await startFakeStack(
  { token: process.env.SHARED_API_TOKEN ?? "fake-shared-token", providers: ["anthropic", "openai", "gemini", "xai", "openrouter"], livekit },
  port,
);
if (FAKE_VOICE === "off") fake.state.voice.livekit = null;
if (FAKE_VOICE === "402") fake.state.voice.refuse = { status: 402, body: { error: "your balance is below the minimum", balance: 120, minimum: 500 } };
if (FAKE_VOICE === "503") fake.state.voice.refuse = { status: 503, body: { error: "the voice service is not answering" } };
if (FAKE_READY_AFTER) fake.state.readyAfter = Number(FAKE_READY_AFTER);
fake.state.installMs = Number(process.env.FAKE_INSTALL_MS ?? 8000);
if (STRUT_VOICE_URL) fake.state.voice.forward = { url: STRUT_VOICE_URL.replace(/\/+$/, ""), token: STRUT_VOICE_TOKEN ?? "" };
console.log(`fake stack on ${fake.base}  (bifrost ${fake.bifrostUrl}, strut ${fake.strutUrl}, neo4j ${fake.neo4jUrl})`);
console.log(
  `the store's Install link: /packages?install=openlaw/legal-desk&index=${STAKWORK_INDEX_KEY}&index_url=${encodeURIComponent(STAKWORK_INDEX_URL)}`,
);
console.log(`calls: ${STRUT_VOICE_URL ? `handed to ${STRUT_VOICE_URL}` : `tokens for ${livekit.url}`}${FAKE_VOICE ? `, FAKE_VOICE=${FAKE_VOICE}` : ""}`);
