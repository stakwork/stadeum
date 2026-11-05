import { spawn } from "node:child_process";

/** Run a program and collect what it says. Never a shell: arguments pass as they are. */

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  /** Written to stdin, then closed. */
  input?: string;
  timeoutMs?: number;
  /** Pass the program's output through to ours (a person watching `ops restore`). */
  inherit?: boolean;
}

export type Exec = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

export class CommandError extends Error {
  constructor(
    readonly cmd: string,
    readonly args: string[],
    readonly result: RunResult,
  ) {
    const said = (result.stderr || result.stdout).trim().split("\n").slice(-3).join(" / ");
    super(`${cmd} ${args.slice(0, 6).join(" ")} exited ${result.code}${said ? `: ${said.slice(0, 400)}` : ""}`);
    this.name = "CommandError";
  }
}

export const run: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: opts.env ?? process.env,
      stdio: [opts.input === undefined ? "ignore" : "pipe", opts.inherit ? "inherit" : "pipe", opts.inherit ? "inherit" : "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs) : undefined;
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 128 : 1), stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });

/** Run it; a non-zero exit throws. */
export async function must(exec: Exec, cmd: string, args: string[], opts?: RunOptions): Promise<string> {
  const result = await exec(cmd, args, opts);
  if (result.code !== 0) throw new CommandError(cmd, args, result);
  return result.stdout;
}
