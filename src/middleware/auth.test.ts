import { describe, it, expect, vi, beforeEach } from "vitest";

describe("requireTenant middleware", () => {
  const mockReq = (tenantHeader: string | undefined, user: { tenantSlugs: string[] } | undefined) =>
    ({
      headers: { "x-tenant": tenantHeader },
      user,
      body: {},
    }) as any;
  const mockRes = () => {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };
  const mockNext = vi.fn();

  beforeEach(() => {
    mockNext.mockClear();
  });

  it("rejects when user is missing", async () => {
    const { requireTenant } = await import("./auth.js");
    const req = mockReq("foo", undefined);
    const res = mockRes();
    await requireTenant(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("rejects when X-Tenant header is missing", async () => {
    const { requireTenant } = await import("./auth.js");
    const req = mockReq(undefined, { tenantSlugs: ["foo"] });
    const res = mockRes();
    await requireTenant(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "X-Tenant header required" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("rejects when user has no access to tenant", async () => {
    const { requireTenant } = await import("./auth.js");
    const req = mockReq("other-tenant", { tenantSlugs: ["foo"] });
    const res = mockRes();
    await requireTenant(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Access denied to this tenant" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("calls next and sets tenantSlug when user has access", async () => {
    const { requireTenant } = await import("./auth.js");
    const req = mockReq("my-tenant", { tenantSlugs: ["my-tenant", "other"] });
    const res = mockRes();
    await requireTenant(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(req.tenantSlug).toBe("my-tenant");
  });
});
