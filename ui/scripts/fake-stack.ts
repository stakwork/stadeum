/**
 * Run the fake stack for local development without bifrost/Strut/neo4j:
 *   npm run fake-stack        # listens on 127.0.0.1:4555
 * Then point .env at it (see README "Local development").
 */
import { startFakeStack } from "../src/test/fake-stack";

const port = Number(process.env.FAKE_STACK_PORT ?? 4555);
const fake = await startFakeStack({ token: process.env.SHARED_API_TOKEN ?? "fake-shared-token" }, port);
console.log(`fake stack on ${fake.base}  (bifrost ${fake.bifrostUrl}, mcp ${fake.mcpUrl}, neo4j ${fake.neo4jUrl})`);
