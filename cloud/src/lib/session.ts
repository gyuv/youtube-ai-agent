/**
 * Operator sessions: a single studio password (STUDIO_PASSWORD) and an HMAC-signed cookie.
 * Uses Web Crypto only, so the same code runs in proxy.ts, route handlers and server actions.
 *
 * The signing key mixes SESSION_SECRET with STUDIO_PASSWORD, so changing the password signs
 * every browser out.
 */

export const SESSION_COOKIE = "lumen_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const MIN_SECRET_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 12;
const encoder = new TextEncoder();

/** Why the studio can't accept logins yet, or null when auth is configured. */
export function authConfigError(): string | null {
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  const password = process.env.STUDIO_PASSWORD ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return `Set SESSION_SECRET to at least ${MIN_SECRET_LENGTH} random characters.`;
  if (password.length < MIN_PASSWORD_LENGTH) return `Set STUDIO_PASSWORD to at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signingKey(): Promise<CryptoKey | null> {
  if (authConfigError()) return null;
  const material = encoder.encode(`${process.env.SESSION_SECRET!.trim()}\u0000${process.env.STUDIO_PASSWORD}`);
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSessionToken(now: number = Date.now()): Promise<string> {
  const key = await signingKey();
  if (!key) throw new Error(authConfigError() ?? "Studio auth is not configured");
  const payload = `v1.${Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS}`;
  return `${payload}.${toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)))}`;
}

export async function verifySessionToken(token: string | undefined, now: number = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [version, expires, signature] = token.split(".");
  if (version !== "v1" || !/^\d+$/.test(expires ?? "") || !signature) return false;
  if (Number(expires) * 1000 <= now) return false;
  const key = await signingKey();
  const sig = fromBase64Url(signature);
  if (!key || !sig) return false;
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, sig, encoder.encode(`${version}.${expires}`));
}

/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
