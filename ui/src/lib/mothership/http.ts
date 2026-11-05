import { BIFROST_HTTP_TIMEOUT_MS } from "./constants";

/** Ported from Hive `BifrostClient.ts` (`BifrostHttpError`). */
export class BifrostHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "BifrostHttpError";
  }
}

export interface JsonClientOptions {
  baseUrl: string;
  authHeader: string;
  label: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The request loop both Hive Bifrost clients share: timeout, JSON in and
 * out, non-2xx → `BifrostHttpError` carrying the parsed body.
 */
export function jsonClient(opts: JsonClientOptions) {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? BIFROST_HTTP_TIMEOUT_MS;

  return async function request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: opts.authHeader, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      const name = (err as Error).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new BifrostHttpError(0, undefined, `${opts.label} ${method} ${path} timed out after ${timeoutMs}ms`);
      }
      throw new BifrostHttpError(
        0,
        undefined,
        `${opts.label} ${method} ${path} network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Plain-text error body; surfaced through the message below.
      }
    }
    if (!response.ok) {
      const detail = extractErrorMessage(parsed) ?? text.slice(0, 200);
      throw new BifrostHttpError(
        response.status,
        parsed,
        `${opts.label} ${method} ${path} failed: ${response.status} ${detail}`,
      );
    }
    return parsed as T;
  };
}

function extractErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const v = (body as { error: unknown }).error;
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && "message" in v && typeof (v as { message: unknown }).message === "string") {
      return (v as { message: string }).message;
    }
  }
  return undefined;
}
