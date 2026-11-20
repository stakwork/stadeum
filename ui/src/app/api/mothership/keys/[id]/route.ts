import { hasDeploymentKey } from "@/lib/deployment-key";
import { deleteGrantKey, grantKeyRefusal } from "@/lib/mothership/grant-key";

/**
 * A grant's model key, deleted when strut releases the grant. The
 * deployment key alone: whoever releases it need not be the person it was
 * for. Only a grant's key: any other id is a 404.
 */
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasDeploymentKey(req.headers.get("authorization"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    if (!(await deleteGrantKey(id))) return Response.json({ error: "no such key" }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (err) {
    return grantKeyRefusal(err);
  }
}
