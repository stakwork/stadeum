/**
 * ops's strut client: the drain and the health check (strut `specs/API.md`
 * §8 and §8.1), with the deployment key as Bearer. A drain refuses new
 * work and `idle` says when nothing is left running; the next boot starts
 * undrained, and `minutes` lifts it by itself if ops dies first.
 */

export interface DrainView {
  draining: boolean;
  since?: string;
  reason?: string;
  until?: string;
  idle: boolean;
  active: { runs: number; chats: number };
  runs: Array<{ workflow: string; runId: string; state: string }>;
}

export interface StrutHealth {
  ok: boolean;
  /** Present only when the key was accepted. */
  workspace?: { backend: string };
  drain?: { since: string; reason?: string; idle: boolean };
}

export interface StrutApi {
  health(): Promise<StrutHealth>;
  drain(reason: string, minutes: number): Promise<DrainView>;
  drainView(): Promise<DrainView>;
  lift(): Promise<void>;
}

export class StrutHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StrutHttpError";
  }
}

const TIMEOUT_MS = 10_000;

export class Strut implements StrutApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      throw new StrutHttpError(res.status, `${method} ${path} returned ${res.status}${text ? `: ${text}` : ""}`);
    }
    return (await res.json()) as T;
  }

  health() {
    return this.call<StrutHealth>("GET", "/health");
  }

  drain(reason: string, minutes: number) {
    return this.call<DrainView>("PUT", "/drain", { reason: reason.slice(0, 200), minutes: Math.min(1440, Math.max(1, Math.ceil(minutes))) });
  }

  drainView() {
    return this.call<DrainView>("GET", "/drain");
  }

  async lift() {
    await this.call<DrainView>("DELETE", "/drain");
  }
}
