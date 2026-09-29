import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, secretsMatch } from "./crypto";

describe("token encryption", () => {
  beforeEach(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64")));

  it("round-trips and never repeats ciphertext", () => {
    const a = encryptSecret("1//refresh-token");
    const b = encryptSecret("1//refresh-token");
    expect(a).toMatch(/^v1:/);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("1//refresh-token");
  });

  it("detects tampering and a rotated key", () => {
    const token = encryptSecret("secret");
    const raw = Buffer.from(token.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`)).toThrow(/Could not decrypt/);

    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(() => decryptSecret(token)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("rejects keys that are not 32 bytes", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.from("short").toString("base64"));
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});

describe("secretsMatch", () => {
  it("compares in constant time regardless of length", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("", "abc")).toBe(false);
  });
});
