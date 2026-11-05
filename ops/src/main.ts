import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { backup, restore } from "./backup.js";
import { ComposeStack, discover } from "./compose.js";
import type { Destination, OpsEvent } from "./contract.js";
import { errorText, type Deps } from "./deps.js";
import { run } from "./exec.js";
import { readFiles, RELEASE_STACK } from "./files.js";
import { Ops } from "./ops.js";
import { applyRelease } from "./release.js";
import { destinationFromEnv, Restic } from "./restic.js";
import { Stadeum } from "./stadeum.js";
import { Strut } from "./strut.js";
import { handOver } from "./update.js";

/**
 * stadeum-ops. No port: it starts every connection itself.
 *
 *   ops run                 the loop (the service's command)
 *   ops check               pull what ops moves and say what is new
 *   ops update              update now, as the admin page's "Update now"
 *   ops backup              back up now
 *   ops snapshots           list the repository's snapshots
 *   ops restore [snapshot]  put a snapshot back (default: latest)
 *   ops hand-over <image> [--confirm <ref,…>]
 *                           internal, in a one-off container on a new
 *                           release's image: apply it (release.ts);
 *                           <image> is the ops image that ran before
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
  const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
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
      const { groups, release } = await ops.check();
      for (const c of [...groups.flatMap((g) => g.checks), ...(release?.checks ?? [])]) {
        const state = !c.available ? "not found" : c.available === c.running ? "up to date" : "new image";
        console.log(`${c.service.name.padEnd(16)} ${c.service.image.padEnd(44)} ${state}`);
      }
      const p = release?.plan;
      if (p) {
        console.log(`\nThe release on the channel changes ${p.files.length ? p.files.join(", ") : "no stack file"}.`);
        for (const m of p.images) console.log(`  ${m.service}: ${m.from ?? "(new)"} → ${m.to ?? "(removed)"}`);
        if (p.held.length) console.log(`Held: ${p.held.map((h) => `${h.service} ${h.from} → ${h.to}`).join(", ")} waits for an admin (Updates page).`);
      }
      if (release?.problem) console.log(`\nThe release: ${release.problem}`);
      return 0;
    }
    case "update": {
      const settings = await stadeum.settings();
      const next = await ops.update(settings, true);
      if (next) await handOver(ops.deps, next.checks, next.confirmed);
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
    case "hand-over": {
      // Let the ops that handed over finish what it was saying; from here it waits for this one.
      await sleep(3_000);
      const drainMinutes = (await stadeum.settings().catch(() => null))?.drainMinutes ?? 30;
      await ops.refresh();
      const event = await applyRelease(ops.deps, {
        next: readFiles(RELEASE_STACK),
        ...(arg && !arg.startsWith("--") ? { previous: arg } : {}),
        confirmed: new Set((flag("--confirm") ?? "").split(",").filter(Boolean)),
        drainMinutes,
        images: ops.images,
      }).catch((err) => {
        const at = new Date().toISOString();
        return { kind: "update" as const, outcome: "failed" as const, startedAt: at, endedAt: at, detail: `Applying the release failed: ${errorText(err)}` };
      });
      await ops.refresh();
      await ops.report({ phase: "idle" });
      if (!event) return 0;
      log(`${event.kind} ${event.outcome}: ${event.detail}`);
      // stadeum-ui may just have been recreated: give it a while to take the history.
      await ops.record(event);
      for (let i = 0; i < 24 && ops.unsent; i++) {
        await sleep(5_000);
        await ops.flush();
      }
      return event.outcome === "ok" ? 0 : 1;
    }
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
