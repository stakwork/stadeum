/**
 * Run the fake stack for local development without bifrost, strut or neo4j:
 *   npm run fake-stack        # listens on 127.0.0.1:4555
 * Then point .env at it (see README "Local development").
 */
import { startFakeStack } from "../src/test/fake-stack";

const port = Number(process.env.FAKE_STACK_PORT ?? 4555);
// The five providers the real gateway has, each with its empty env key slot.
const fake = await startFakeStack(
  { token: process.env.SHARED_API_TOKEN ?? "fake-shared-token", providers: ["anthropic", "openai", "gemini", "xai", "openrouter"] },
  port,
);
console.log(`fake stack on ${fake.base}  (bifrost ${fake.bifrostUrl}, strut ${fake.strutUrl}, neo4j ${fake.neo4jUrl})`);
