import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { backup, restore } from "./backup.js";
import { ComposeStack, discover } from "./compose.js";
import type { Destination, OpsEvent } from "./contract.js";
import { errorText, type Deps } from "./deps.js";
import { run } from "./exec.js";
import { Ops } from "./ops.js";
import { destinationFromEnv, Restic } from "./restic.js";
import { Stadeum } from "./stadeum.js";
import { Strut } from "./strut.js";
import { handOver, takeOver } from "./update.js";

/**
 * stadeum-ops. No port: it starts every connection itself.
 *
 *   ops run                 the loop (the service's command)
 *   ops check               pull what ops moves and say what is new
 *   ops update              update now, as the admin page's "Update now"
 *   ops backup              back up now
 *   ops snapshots           list the repository's snapshots
 *   ops restore [snapshot]  put a snapshot back (default: latest)
 *   ops hand-over <image>   internal: recreate ops on its new image
 *
 * backup, snapshots and restore take the destination from
 * RESTIC_REPOSITORY + RESTIC_PASSWORD (and the backend's own variables)
 * when they are set, as on a fresh box, else from stadeum-ui.
 */

const TICK_MS = 30_000;
const HEARTBEAT = "/tmp/heartbeat";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

async function main(argv: string[]): Promise<number> {
  const [cmd = "run", arg] = argv;
  const token = process.env.SHARED_API_TOKEN?.trim();
  if (!token) throw new Error("SHARED_API_TOKEN is not set");
  const project = await discover(run);
  const stack = new ComposeStack(project, run);
  const strut = new Strut(process.env.STRUT_URL ?? "http://strut:3000", token);
  const stadeum = new Stadeum(process.env.STADEUM_UI_URL ?? "http://stadeum-ui:3000", token);
  const version = process.env.STADEUM_VERSION ?? "dev";
  const ops = new Ops({
    stack,
    strut,
    stadeum,
    restic: (dest) => new Restic(dest, run),
    log,
    now: () => new Date(),
    sleep: (ms) => sleep(ms),
    version,
    host: project.name,
  });
  const d: Deps = { ...ops.deps, phase: async (phase, detail) => log(`${phase}${detail ? `: ${detail}` : ""}`) };

  const destination = async (): Promise<Destination> => {
    const fromEnv = destinationFromEnv(process.env);
    if (fromEnv) return fromEnv;
    const settings = await stadeum.settings().catch((err: Error) => {
      throw new Error(`no RESTIC_REPOSITORY and RESTIC_PASSWORD here, and stadeum-ui did not answer (${err.message})`);
    });
    if (!settings.backups) throw new Error("no backup destination: pick one on the Backups page, or set RESTIC_REPOSITORY and RESTIC_PASSWORD");
    return settings.backups;
  };
  const say = async (event: OpsEvent) => {
    log(`${event.kind} ${event.outcome}: ${event.detail}`);
    await stadeum.record(event).catch(() => undefined);
    return event.outcome === "ok" ? 0 : 1;
  };

  switch (cmd) {
    case "run": {
      log(`ops ${version} for project ${project.name} (${project.files.join(", ")})`);
      const beat = () => writeFileSync(HEARTBEAT, new Date().toISOString());
      beat();
      setInterval(beat, 15_000);
      for (;;) {
        await ops.tick().catch((err) => log(`tick failed: ${errorText(err)}`));
        await sleep(TICK_MS);
      }
    }
    case "check": {
      const { groups, self } = await ops.check();
      for (const c of [...groups.flatMap((g) => g.checks), ...(self ? [self] : [])]) {
        const state = !c.available ? "not found" : c.available === c.running ? "up to date" : "new image";
        console.log(`${c.service.name.padEnd(16)} ${c.service.image.padEnd(44)} ${state}`);
      }
      return 0;
    }
    case "update": {
      const settings = await stadeum.settings();
      const self = await ops.update(settings, true);
      if (self) await handOver(ops.deps, self);
      return 0;
    }
    case "backup":
      return say(await backup(d, new Restic(await destination(), run), { drainMinutes: 30, host: project.name, envFile: stack.envFiles[0] }));
    case "snapshots": {
      for (const s of await new Restic(await destination(), run).snapshots()) console.log(`${s.id.slice(0, 8)}  ${s.time}`);
      return 0;
    }
    case "restore": {
      const event = await restore(d, new Restic(await destination(), run), arg ?? "latest", { envFile: stack.envFiles[0] });
      log(event.detail);
      const files = project.files.map((f) => `-f ${f}`).join(" ");
      const env = stack.envFiles[0] ? `--env-file ${stack.envFiles[0]} ` : "";
      console.log(`\nStart the stack:\n  docker compose ${env}${files} up -d --wait\n`);
      return 0;
    }
    case "hand-over":
      return say(await takeOver(d, arg || undefined));
    default:
      console.error(`unknown command ${cmd}: run, check, update, backup, snapshots, restore [snapshot]`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`ops: ${errorText(err)}`);
    process.exit(1);
  },
);
