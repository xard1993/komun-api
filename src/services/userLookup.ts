import { publicDb } from "../db/index.js";
import { users } from "../db/schema/public.js";
import { eq, inArray } from "drizzle-orm";

export interface PublicUserInfo {
  id: number;
  email: string;
  name: string | null;
}

/**
 * Get one user's public info (name, email) by id. Returns null if not found.
 */
export async function getPublicUser(userId: number): Promise<PublicUserInfo | null> {
  const [row] = await publicDb
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Get multiple users' public info. Returns a map of userId -> { id, email, name }.
 */
export async function getPublicUsers(userIds: number[]): Promise<Record<number, PublicUserInfo>> {
  if (userIds.length === 0) return {};
  const rows = await publicDb
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  return Object.fromEntries(rows.map((u) => [u.id, u]));
}
