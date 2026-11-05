import { db } from "@/lib/db";
import type { ModelSettings } from "./plan";

/** The org's model list and default, from the Org row (null until an admin saves them). */
export async function readModelSettings(): Promise<ModelSettings> {
  const org = await db.org.findUnique({ where: { id: "org" }, select: { models: true, defaultModel: true } });
  return { models: parseList(org?.models), defaultModel: org?.defaultModel ?? null };
}

export async function saveModelSettings(s: ModelSettings): Promise<void> {
  const data = { models: s.models === null ? null : JSON.stringify(s.models), defaultModel: s.defaultModel };
  await db.org.upsert({ where: { id: "org" }, create: { id: "org", ...data }, update: data });
}

function parseList(raw: string | null | undefined): string[] | null {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}
