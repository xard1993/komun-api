import { describe, it, expect, vi, beforeEach } from "vitest";
import { tenantSchemaName } from "./tenantDb.js";

describe("tenantSchemaName", () => {
  it("returns tenant_ prefix plus slug for valid slug", () => {
    expect(tenantSchemaName("foo")).toBe("tenant_foo");
    expect(tenantSchemaName("my-condo")).toBe("tenant_my-condo");
    expect(tenantSchemaName("abc123")).toBe("tenant_abc123");
    expect(tenantSchemaName("a")).toBe("tenant_a");
  });

  it("throws for invalid slug", () => {
    expect(() => tenantSchemaName("")).toThrow("Invalid tenant slug");
    expect(() => tenantSchemaName("UPPER")).toThrow("Invalid tenant slug");
    expect(() => tenantSchemaName("has space")).toThrow("Invalid tenant slug");
    expect(() => tenantSchemaName("invalid!")).toThrow("Invalid tenant slug");
  });
});

describe("tenantDb", () => {
  it("throws invalid slug when callback is run", async () => {
    const { tenantDb: runTenantDb } = await import("./tenantDb.js");
    await expect(runTenantDb("", async () => 1)).rejects.toThrow("Invalid tenant slug");
    await expect(runTenantDb("Bad!", async () => 1)).rejects.toThrow("Invalid tenant slug");
  });
});
