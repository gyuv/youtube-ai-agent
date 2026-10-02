import { beforeEach, describe, expect, it, vi } from "vitest";
import { authConfigError, createSessionToken, safeNextPath, verifySessionToken } from "./session";

describe("operator sessions", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "s".repeat(40));
    vi.stubEnv("STUDIO_PASSWORD", "correct-horse-battery");
  });

  it("refuses to run with a weak configuration", () => {
    expect(authConfigError()).toBeNull();
    vi.stubEnv("STUDIO_PASSWORD", "short");
    expect(authConfigError()).toMatch(/STUDIO_PASSWORD/);
    vi.stubEnv("SESSION_SECRET", "tiny");
    expect(authConfigError()).toMatch(/SESSION_SECRET/);
  });

  it("issues tokens that verify until they expire", async () => {
    const now = Date.UTC(2026, 8, 29);
    const token = await createSessionToken(now);
    expect(await verifySessionToken(token, now + 1000)).toBe(true);
    expect(await verifySessionToken(token, now + 31 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("rejects tampered, malformed and missing tokens", async () => {
    const token = await createSessionToken();
    const [version, expires, signature] = token.split(".");
    expect(await verifySessionToken(`${version}.${Number(expires) + 999}.${signature}`)).toBe(false);
    // Change the first character: the last base64url character carries spare bits, so editing it
    // can leave the decoded signature unchanged.
    const tampered = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(await verifySessionToken(`${version}.${expires}.${tampered}`)).toBe(false);
    expect(await verifySessionToken("v1.garbage")).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
  });

  it("signs everyone out when the password changes", async () => {
    const token = await createSessionToken();
    vi.stubEnv("STUDIO_PASSWORD", "a-brand-new-password");
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("never verifies when auth is unconfigured", async () => {
    const token = await createSessionToken();
    vi.stubEnv("SESSION_SECRET", "");
    expect(await verifySessionToken(token)).toBe(false);
    await expect(createSessionToken()).rejects.toThrow(/SESSION_SECRET/);
  });

  it("only redirects to same-site paths after login", () => {
    expect(safeNextPath("/projects/abc")).toBe("/projects/abc");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
