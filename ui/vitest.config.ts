import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      STADEUM_ENCRYPTION_KEY: "0".repeat(64),
    },
    fileParallelism: false,
  },
});
