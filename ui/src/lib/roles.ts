/** Admins manage members and see Status; members get everything else. */
export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);
export const isAdmin = (r: string) => r === "admin";

export const roleLabel: Record<Role, string> = { admin: "Admin", member: "Member" };
