import { isOps, saveStatus, statusSchema } from "@/lib/ops/store";

/** ops says what it is doing, and which requests it answered (ui/src/lib/ops/contract.ts). */
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  if (!isOps(req.headers.get("authorization"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = statusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "bad status" }, { status: 400 });
  await saveStatus(parsed.data);
  return new Response(null, { status: 204 });
}
