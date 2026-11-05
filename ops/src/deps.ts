import type { Stack } from "./compose.js";
import type { Phase } from "./contract.js";
import type { StrutApi } from "./strut.js";

/** What updates and backups run on. Tests pass fakes. */
export interface Deps {
  stack: Stack;
  strut: StrutApi;
  log: (msg: string) => void;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Say what ops is doing now (stadeum-ui's Updates and Backups pages). Never throws. */
  phase: (phase: Phase, detail?: string) => Promise<void>;
}

const POLL_MS = 5_000;

/**
 * Turn on strut's drain and wait until nothing runs, at most `waitMinutes`.
 * Runs still going then resume after the restart (strut auto-resumes).
 * The drain lifts itself `waitMinutes + 30` after it was turned on, so one
 * whose ops died does not refuse everything for long. A strut that does
 * not answer is not waited on: nothing can be running in it.
 */
export async function drainStrut(d: Deps, reason: string, waitMinutes: number): Promise<boolean> {
  let view;
  try {
    view = await d.strut.drain(reason, waitMinutes + 30);
  } catch (err) {
    d.log(`strut did not take the drain (${(err as Error).message}); going on`);
    return false;
  }
  const deadline = d.now().getTime() + waitMinutes * 60_000;
  while (!view.idle && d.now().getTime() < deadline) {
    const { runs, chats } = view.active;
    await d.phase("draining", `${reason}: waiting on ${runs} run${runs === 1 ? "" : "s"} and ${chats} chat${chats === 1 ? "" : "s"}`);
    await d.sleep(POLL_MS);
    try {
      view = await d.strut.drainView();
    } catch (err) {
      d.log(`strut stopped answering while draining (${(err as Error).message}); going on`);
      return true;
    }
  }
  if (!view.idle) d.log(`strut still busy after ${waitMinutes} min (${view.active.runs} runs): they resume after the restart`);
  return true;
}

/** Lift the drain, if strut still holds one (a restart already lifted it). */
export async function liftDrain(d: Deps): Promise<void> {
  await d.strut.lift().catch((err: Error) => d.log(`could not lift the drain: ${err.message}`));
}

/** How long, said briefly: "45 s", "3 min". */
export function took(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
