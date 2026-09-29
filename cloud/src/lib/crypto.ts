import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { requireEnv } from "./env";
import { PipelineError } from "./errors";

/**
 * AES-256-GCM for OAuth tokens at rest. Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).
 * TOKEN_ENCRYPTION_KEY is 32 random bytes, base64-encoded (`openssl rand -base64 32`).
 */
const VERSION = "v1";

function key(): Buffer {
  const raw = Buffer.from(requireEnv("TOKEN_ENCRYPTION_KEY"), "base64");
  if (raw.length !== 32) {
    throw new PipelineError("CONFIG", "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  }
  return raw;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

export function decryptSecret(token: string): string {
  const [version, payload] = token.split(":", 2);
  if (version !== VERSION || !payload) throw new PipelineError("CONFIG", "Unrecognised encrypted token format.");
  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new PipelineError("CONFIG", "Could not decrypt a stored token; was TOKEN_ENCRYPTION_KEY changed?");
  }
}

/** Constant-time comparison that doesn't leak the secret's length. */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
