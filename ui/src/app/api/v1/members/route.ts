import { withApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

/**
 * GET /api/v1/members: the box's people, with role, whether they can run
 * apps yet, and when they joined and were last seen. Emails are included:
 * a key is an admin's to make. Never a token, key or hash.
 */
export const dynamic = "force-dynamic";

export const GET = withApiKey(async () => {
  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true, lastSeenAt: true, mothership: { select: { delegationStatus: true } } },
    orderBy: { createdAt: "asc" },
  });
  return Response.json({
    members: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      joined_at: u.createdAt.toISOString(),
      last_seen_at: u.lastSeenAt?.toISOString() ?? null,
      can_run_apps: u.mothership?.delegationStatus === "fresh" || u.mothership?.delegationStatus === "pushed",
    })),
  });
});
