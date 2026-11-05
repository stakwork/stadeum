import { db } from "@/lib/db";

/** The container's healthcheck (stack/stadeum.yml): serving, and the database answers. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
