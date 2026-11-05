import type { OpsEvent, OpsSettings, OpsStatus } from "./contract.js";

/**
 * ops's stadeum-ui client (`src/contract.ts`). stadeum-ui is restarted by
 * the very updates and backups ops reports on, so a status that cannot be
 * sent is dropped (the next one replaces it) and an event waits in memory
 * until stadeum-ui answers again.
 */

export interface StadeumApi {
  settings(): Promise<OpsSettings>;
  status(status: OpsStatus): Promise<void>;
  record(event: OpsEvent): Promise<void>;
}

const TIMEOUT_MS = 10_000;

export class Stadeum implements StadeumApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}`);
    return res;
  }

  async settings(): Promise<OpsSettings> {
    return (await (await this.call("GET", "/api/ops/settings")).json()) as OpsSettings;
  }

  async status(status: OpsStatus): Promise<void> {
    await this.call("PUT", "/api/ops/status", status);
  }

  async record(event: OpsEvent): Promise<void> {
    await this.call("POST", "/api/ops/history", event);
  }
}

/** Events kept until stadeum-ui takes them, oldest first. */
export class Outbox {
  private queue: OpsEvent[] = [];

  constructor(
    private readonly api: StadeumApi,
    private readonly log: (msg: string) => void,
  ) {}

  async record(event: OpsEvent): Promise<void> {
    this.queue.push(event);
    await this.flush();
  }

  async flush(): Promise<void> {
    while (this.queue[0]) {
      try {
        await this.api.record(this.queue[0]);
        this.queue.shift();
      } catch (err) {
        this.log(`history not sent yet (${this.queue.length} waiting): ${(err as Error).message}`);
        return;
      }
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}
