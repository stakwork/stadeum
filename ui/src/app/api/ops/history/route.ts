import { eventSchema, isOps, recordEvent } from "@/lib/ops/store";

/** ops records what it did: an update, a rollback, a backup, a restore (ui/src/lib/ops/contract.ts). */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isOps(req.headers.get("authorization"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = eventSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "bad event" }, { status: 400 });
  await recordEvent(parsed.data);
  return new Response(null, { status: 201 });
}
