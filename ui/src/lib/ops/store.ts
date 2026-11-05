import { randomBytes, timingSafeEqual } from "node:crypto";
import type { OpsSettings as SettingsRow } from "@prisma/client";
import { z } from "zod";

import { decryptField, encryptField } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { OpsEvent, OpsSettings, OpsStatus, RequestKind } from "./contract";
import { build, isKind, restoreKit, validate, type Kind, type Values } from "./destination";

/**
 * The box's upkeep as stadeum-ui keeps it: the settings ops reads, the
 * status and history it posts back, and the admin's requests. The backup
 * credentials and restic's password are encrypted under
 * STADEUM_ENCRYPTION_KEY, as the org key is; ops gets them, decrypted,
 * only through `/api/ops/settings` with the deployment key.
 */

const ID = "ops";

// ── who may call the internal routes ────────────────────────────────────

/** `Authorization: Bearer <SHARED_API_TOKEN>`, compared in constant time. */
export function isOps(authorization: string | null): boolean {
  const token = env.sharedToken();
  const given = /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
  if (!token || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── settings ────────────────────────────────────────────────────────────

export async function settingsRow(): Promise<SettingsRow> {
  return db.opsSettings.upsert({ where: { id: ID }, create: { id: ID }, update: {} });
}

const parseValues = (s: string | null): Values => (s ? (JSON.parse(s) as Values) : {});

function secretsOf(row: SettingsRow): Values {
  return row.backupSecretsEnc ? (JSON.parse(decryptField("backupSecrets", row.backupSecretsEnc)) as Values) : {};
}

/** What ops reads every tick. */
export async function settingsForOps(): Promise<OpsSettings> {
  const row = await settingsRow();
  const [requests, status, failed] = await Promise.all([
    db.opsRequest.findMany({ where: { doneAt: null }, orderBy: { createdAt: "asc" } }),
    db.opsStatus.findUnique({ where: { id: ID } }),
    db.opsEvent.findMany({ where: { kind: "update", outcome: "rolled-back" }, orderBy: { endedAt: "desc" }, take: 50 }),
  ]);
  const kind = row.backupKind;
  const backups =
    kind && isKind(kind) && row.resticPasswordEnc
      ? {
          enabled: row.backupsEnabled,
          ...build(kind, parseValues(row.backupFields), secretsOf(row)),
          password: decryptField("resticPassword", row.resticPasswordEnc),
        }
      : null;
  return {
    window: { start: row.windowStart, end: row.windowEnd, timeZone: row.timeZone },
    drainMinutes: row.drainMinutes,
    updates: { enabled: row.updatesEnabled },
    backups,
    requests: requests.map((r) => ({ id: r.id, kind: r.kind as RequestKind, at: r.createdAt.toISOString() })),
    lastCycle: status?.lastCycle ?? null,
    failedImages: [...new Set(failed.flatMap((e) => changesOf(e.changes).map((c) => c.to.id)))],
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type Saved = { ok: true } | { ok: false; error: string };

export async function saveUpdates(input: { start: string; end: string; timeZone: string; drainMinutes: number; enabled: boolean }): Promise<Saved> {
  if (!HHMM.test(input.start) || !HHMM.test(input.end)) return { ok: false, error: "Times are HH:MM, like 03:00." };
  if (!isTimeZone(input.timeZone)) return { ok: false, error: `${input.timeZone} is not a time zone.` };
  if (!Number.isInteger(input.drainMinutes) || input.drainMinutes < 1 || input.drainMinutes > 600) {
    return { ok: false, error: "The wait is a whole number of minutes, from 1 to 600." };
  }
  const data = {
    windowStart: input.start,
    windowEnd: input.end,
    timeZone: input.timeZone,
    drainMinutes: input.drainMinutes,
    updatesEnabled: input.enabled,
  };
  await db.opsSettings.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
  return { ok: true };
}

/** The destination as the Backups page shows it: no secret, only which are saved. */
export async function destinationForPage(): Promise<{
  kind: Kind | null;
  fields: Values;
  savedSecrets: string[];
  enabled: boolean;
  repository: string | null;
  passwordPending: boolean;
}> {
  const row = await settingsRow();
  const kind = row.backupKind && isKind(row.backupKind) ? row.backupKind : null;
  const fields = parseValues(row.backupFields);
  const secrets = kind ? secretsOf(row) : {};
  return {
    kind,
    fields,
    savedSecrets: Object.keys(secrets),
    enabled: row.backupsEnabled,
    repository: kind ? build(kind, fields, secrets).repository : null,
    passwordPending: !!row.resticPasswordEnc && !row.passwordKeptAt,
  };
}

/**
 * Save where backups go. A secret left blank keeps the one saved for the
 * same kind. The restic password is made with the first destination and
 * never changes: a new destination is a new repository with the same one.
 */
export async function saveDestination(kindRaw: unknown, values: Values, enabled: boolean): Promise<Saved> {
  if (!isKind(kindRaw)) return { ok: false, error: "Choose where the backups go." };
  const kind = kindRaw;
  const row = await settingsRow();
  const kept = row.backupKind === kind ? secretsOf(row) : {};
  const merged: Values = { ...values };
  for (const [k, v] of Object.entries(kept)) if (!merged[k]?.trim()) merged[k] = v;
  const checked = validate(kind, merged);
  if (!checked.ok) return checked;
  const data = {
    backupKind: kind,
    backupFields: JSON.stringify(checked.fields),
    backupSecretsEnc: encryptField("backupSecrets", JSON.stringify(checked.secrets)),
    backupsEnabled: enabled,
    ...(row.resticPasswordEnc ? {} : { resticPasswordEnc: encryptField("resticPassword", randomBytes(24).toString("base64url")), passwordKeptAt: null }),
  };
  await db.opsSettings.update({ where: { id: ID }, data });
  return { ok: true };
}

export async function setBackupsEnabled(enabled: boolean): Promise<void> {
  await db.opsSettings.upsert({ where: { id: ID }, create: { id: ID, backupsEnabled: enabled }, update: { backupsEnabled: enabled } });
}

/** The password and the restore kit, while the admin has not said they keep it off the box; null after. */
export async function pendingPassword(): Promise<{ password: string; kit: string } | null> {
  const row = await settingsRow();
  if (!row.resticPasswordEnc || row.passwordKeptAt || !row.backupKind || !isKind(row.backupKind)) return null;
  const password = decryptField("resticPassword", row.resticPasswordEnc);
  const built = build(row.backupKind, parseValues(row.backupFields), secretsOf(row));
  return { password, kit: restoreKit(row.backupKind, built, password) };
}

export async function markPasswordKept(): Promise<void> {
  await db.opsSettings.updateMany({ where: { id: ID, passwordKeptAt: null }, data: { passwordKeptAt: new Date() } });
}

// ── requests ────────────────────────────────────────────────────────────

/** Ask ops for something; it picks it up within its next tick. One open request of a kind is enough. */
export async function request(kind: RequestKind): Promise<void> {
  if (await db.opsRequest.findFirst({ where: { kind, doneAt: null } })) return;
  await db.opsRequest.create({ data: { kind } });
}

export async function openRequests(): Promise<RequestKind[]> {
  return (await db.opsRequest.findMany({ where: { doneAt: null } })).map((r) => r.kind as RequestKind);
}

// ── what ops says ───────────────────────────────────────────────────────

const imageRef = z.object({ id: z.string().max(200), revision: z.string().max(100).optional(), created: z.string().max(60).optional() });
const snapshot = z.object({ id: z.string().max(100), time: z.string().max(60), added: z.number().optional() });

export const statusSchema = z.object({
  phase: z.enum(["idle", "checking", "draining", "backing-up", "updating", "rolling-back", "restoring"]),
  detail: z.string().max(2000).optional(),
  version: z.string().max(100),
  services: z
    .array(
      z.object({
        service: z.string().max(100),
        image: z.string().max(300),
        group: z.string().max(100).optional(),
        built: z.boolean().optional(),
        running: imageRef.optional(),
        available: imageRef.optional(),
      }),
    )
    .max(50),
  checkedAt: z.string().max(60).optional(),
  lastCycle: z.string().max(20).optional(),
  snapshots: z.array(snapshot).max(100).optional(),
  done: z.array(z.string().max(100)).max(100).optional(),
});

export const eventSchema = z.object({
  kind: z.enum(["update", "backup", "restore"]),
  outcome: z.enum(["ok", "failed", "rolled-back", "skipped"]),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  detail: z.string().max(4000),
  changes: z.array(z.object({ service: z.string().max(100), from: imageRef.optional(), to: imageRef })).max(20).optional(),
  snapshot: snapshot.optional(),
});

export async function saveStatus(status: OpsStatus): Promise<void> {
  const { done, ...state } = status;
  const previous = await db.opsStatus.findUnique({ where: { id: ID } });
  // A status without snapshots keeps the last list ops sent.
  const kept = previous && !state.snapshots ? (JSON.parse(previous.state) as OpsStatus).snapshots : undefined;
  const data = {
    state: JSON.stringify({ ...state, ...(kept ? { snapshots: kept } : {}) }),
    lastCycle: state.lastCycle ?? previous?.lastCycle ?? null,
    reportedAt: new Date(),
  };
  await db.$transaction([
    db.opsStatus.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data }),
    ...(done?.length ? [db.opsRequest.updateMany({ where: { id: { in: done }, doneAt: null }, data: { doneAt: new Date() } })] : []),
  ]);
}

export async function readStatus(): Promise<{ status: OpsStatus; reportedAt: Date } | null> {
  const row = await db.opsStatus.findUnique({ where: { id: ID } });
  return row ? { status: JSON.parse(row.state) as OpsStatus, reportedAt: row.reportedAt } : null;
}

export async function recordEvent(e: OpsEvent): Promise<void> {
  await db.opsEvent.create({
    data: {
      kind: e.kind,
      outcome: e.outcome,
      startedAt: new Date(e.startedAt),
      endedAt: new Date(e.endedAt),
      detail: e.detail,
      changes: e.changes ? JSON.stringify(e.changes) : null,
      snapshotId: e.snapshot?.id ?? null,
    },
  });
}

export type HistoryEntry = Omit<OpsEvent, "startedAt" | "endedAt" | "snapshot"> & { id: string; startedAt: Date; endedAt: Date; snapshotId: string | null };

function changesOf(s: string | null): NonNullable<OpsEvent["changes"]> {
  try {
    return s ? (JSON.parse(s) as NonNullable<OpsEvent["changes"]>) : [];
  } catch {
    return [];
  }
}

export async function history(kinds: OpsEvent["kind"][], take = 20): Promise<HistoryEntry[]> {
  const rows = await db.opsEvent.findMany({ where: { kind: { in: kinds } }, orderBy: { endedAt: "desc" }, take });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as OpsEvent["kind"],
    outcome: r.outcome as OpsEvent["outcome"],
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    detail: r.detail,
    changes: changesOf(r.changes),
    snapshotId: r.snapshotId,
  }));
}
