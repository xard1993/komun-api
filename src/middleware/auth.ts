import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { publicDb } from "../db/index.js";
import { tenantUsers, users, tenants } from "../db/schema/public.js";
import { eq } from "drizzle-orm";

export interface AuthUser {
  userId: number;
  email: string;
  name: string | null;
  tenantSlugs: string[];
  roleByTenant: Record<string, string>;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      tenantSlug?: string;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters");
}
const secret: string = JWT_SECRET;

export function signToken(payload: {
  sub: number;
  email: string;
  tenantSlugs: string[];
}): string {
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export function verifyToken(token: string): { sub: number; email: string; tenantSlugs: string[] } | null {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === "object" && decoded !== null && "sub" in decoded && "email" in decoded && "tenantSlugs" in decoded) {
      return decoded as unknown as { sub: number; email: string; tenantSlugs: string[] };
    }
    return null;
  } catch {
    return null;
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const [user] = await publicDb
    .select()
    .from(users)
    .where(eq(users.id, decoded.sub))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  const tenantUserRows = await publicDb
    .select({
      slug: tenants.slug,
      role: tenantUsers.role,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
    .where(eq(tenantUsers.userId, decoded.sub));
  const tenantSlugs = tenantUserRows.map((r) => r.slug);
  const roleByTenant: Record<string, string> = {};
  for (const r of tenantUserRows) {
    roleByTenant[r.slug] = r.role;
  }
  req.user = {
    userId: user.id,
    email: user.email,
    name: user.name,
    tenantSlugs,
    roleByTenant,
  };
  next();
}

export async function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const tenantSlug = (req.headers["x-tenant"] as string) || req.body?.tenantSlug;
  if (!tenantSlug) {
    res.status(400).json({ error: "X-Tenant header required" });
    return;
  }
  if (!req.user.tenantSlugs.includes(tenantSlug)) {
    res.status(403).json({ error: "Access denied to this tenant" });
    return;
  }
  req.tenantSlug = tenantSlug;
  next();
}

/** Sets req.tenantSlug from X-Tenant and verifies tenant exists. Does not require auth. For public approval links. */
export async function setTenantFromHeader(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tenantSlug = (req.headers["x-tenant"] as string)?.trim();
  if (!tenantSlug) {
    res.status(400).json({ error: "X-Tenant header required" });
    return;
  }
  const [tenant] = await publicDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  req.tenantSlug = tenantSlug;
  next();
}
