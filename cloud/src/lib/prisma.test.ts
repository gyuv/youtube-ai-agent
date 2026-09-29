import { describe, expect, it, vi } from "vitest";

describe("prisma (lazy client)", () => {
  it("imports without DATABASE_URL and explains the problem on first use", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { prisma } = await import("./prisma");
    expect(() => prisma.scene).toThrow(/DATABASE_URL is not set/);
  });

  it("builds the client on first use without opening a connection", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@127.0.0.1:1/db");
    const { prisma } = await import("./prisma");
    expect(typeof prisma.scene.findMany).toBe("function");
    expect(typeof prisma.$transaction).toBe("function");
  });
});
