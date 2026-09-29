import { AwsClient } from "aws4fetch";
import { optionalEnv, requireEnv } from "./env";
import { PipelineError } from "./errors";

/**
 * Media storage with two free backends, picked by STORAGE_DRIVER:
 *
 *  - "supabase" (default): Supabase Storage over REST. Free tier caps each object at 50 MB,
 *    plenty for voice clips, images and Shorts, tight for long-form 1080p.
 *  - "r2": Cloudflare R2 over its S3 API. 10 GB free, no egress fees, 5 GB per upload.
 *
 * Buckets are public-read: the runner and the studio fetch assets by plain URL. Object paths
 * embed hashes or run ids, so they are unguessable and safe to cache forever.
 */

type Driver = "supabase" | "r2";

/** A pre-authorised upload the render runner can perform without any storage credentials. */
export interface SignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  publicUrl: string;
}

const IMMUTABLE = "max-age=31536000, immutable";

function driver(): Driver {
  const value = optionalEnv("STORAGE_DRIVER", "supabase");
  if (value !== "supabase" && value !== "r2") throw new PipelineError("CONFIG", `Unknown STORAGE_DRIVER "${value}".`);
  return value;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Largest object the backend accepts, so the renderer can size its bitrate to fit. */
export function maxObjectBytes(): number {
  const overrideMb = Number(optionalEnv("STORAGE_MAX_OBJECT_MB", ""));
  if (overrideMb > 0) return Math.floor(overrideMb * 1024 * 1024);
  return driver() === "supabase" ? 50 * 1024 * 1024 : 5 * 1024 * 1024 * 1024;
}

// ── Supabase ───────────────────────────────────────────────────

function supabase() {
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    base: `${requireEnv("SUPABASE_URL").replace(/\/+$/, "")}/storage/v1`,
    bucket: optionalEnv("SUPABASE_STORAGE_BUCKET", "lumen-media"),
    auth: { Authorization: `Bearer ${key}`, apikey: key },
  };
}

async function supabaseUpload(path: string, body: Uint8Array, contentType: string): Promise<void> {
  const { base, bucket, auth } = supabase();
  const res = await fetch(`${base}/object/${bucket}/${encodePath(path)}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": contentType, "Cache-Control": IMMUTABLE, "x-upsert": "true" },
    body: new Blob([new Uint8Array(body)], { type: contentType }),
  });
  if (!res.ok) await fail(res, `Supabase Storage upload failed for ${path}`);
}

async function supabaseSignedUpload(path: string, contentType: string): Promise<Omit<SignedUpload, "publicUrl">> {
  const { base, bucket, auth } = supabase();
  const res = await fetch(`${base}/object/upload/sign/${bucket}/${encodePath(path)}`, {
    method: "POST",
    headers: { ...auth, "x-upsert": "true" },
  });
  if (!res.ok) await fail(res, `Could not create a Supabase upload URL for ${path}`);
  const { url } = (await res.json()) as { url?: string };
  if (!url) throw new PipelineError("PROVIDER", "Supabase did not return a signed upload URL.");
  return { url: `${base}${url}`, method: "PUT", headers: { "Content-Type": contentType, "Cache-Control": IMMUTABLE, "x-upsert": "true" } };
}

// ── Cloudflare R2 ──────────────────────────────────────────────

function r2() {
  return {
    client: new AwsClient({
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    }),
    objectUrl: (path: string) =>
      `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${requireEnv("R2_BUCKET")}/${encodePath(path)}`,
  };
}

async function r2Upload(path: string, body: Uint8Array, contentType: string): Promise<void> {
  const { client, objectUrl } = r2();
  const res = await client.fetch(objectUrl(path), {
    method: "PUT",
    headers: { "Content-Type": contentType, "Cache-Control": IMMUTABLE },
    body: new Blob([new Uint8Array(body)], { type: contentType }),
  });
  if (!res.ok) await fail(res, `R2 upload failed for ${path}`);
}

async function r2SignedUpload(path: string, contentType: string): Promise<Omit<SignedUpload, "publicUrl">> {
  const { client, objectUrl } = r2();
  const url = new URL(objectUrl(path));
  url.searchParams.set("X-Amz-Expires", String(6 * 60 * 60)); // long renders finish well within this
  const signed = await client.sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } });
  return { url: signed.url, method: "PUT", headers: { "Content-Type": contentType, "Cache-Control": IMMUTABLE } };
}

// ── Public API ─────────────────────────────────────────────────

async function fail(res: Response, message: string): Promise<never> {
  const detail = await res.text().catch(() => "");
  throw new PipelineError("PROVIDER", `${message} (${res.status}): ${detail.slice(0, 300)}`);
}

export function publicObjectUrl(path: string): string {
  if (driver() === "r2") return `${requireEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "")}/${encodePath(path)}`;
  const { base, bucket } = supabase();
  return `${base}/object/public/${bucket}/${encodePath(path)}`;
}

/** Upload (or overwrite) an object and return its public URL. */
export async function uploadObject(path: string, body: Uint8Array, contentType: string): Promise<string> {
  await (driver() === "r2" ? r2Upload(path, body, contentType) : supabaseUpload(path, body, contentType));
  return publicObjectUrl(path);
}

/** A one-off PUT URL for large uploads made elsewhere (the GitHub Actions renderer). */
export async function createSignedUpload(path: string, contentType: string): Promise<SignedUpload> {
  const signed = await (driver() === "r2" ? r2SignedUpload(path, contentType) : supabaseSignedUpload(path, contentType));
  return { ...signed, publicUrl: publicObjectUrl(path) };
}
