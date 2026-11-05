import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/** A fresh SQLite file with every migration applied. */
export default function setup() {
  const root = path.resolve(import.meta.dirname, "../..");
  for (const f of ["test.db", "test.db-journal"]) rmSync(path.join(root, "prisma", f), { force: true });
  execSync("npx prisma migrate deploy", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
