import { optionalEnv, requireEnv } from "./env";
import { PipelineError } from "./errors";

/**
 * Supabase Storage over its REST API (no SDK needed). The bucket must be public: the GitHub
 * runner and the studio's <audio>/<img> tags fetch assets by plain URL. Object paths embed a
 * content hash, so they are effectively unguessable and safe to cache forever.
 */
function storageConfig() {
  return {
    baseUrl: requireEnv("SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: optionalEnv("SUPABASE_STORAGE_BUCKET", "lumen-media"),
  };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function publicObjectUrl(path: string): string {
  const { baseUrl, bucket } = storageConfig();
  return `${baseUrl}/storage/v1/object/public/${bucket}/${encodePath(path)}`;
}

/** Upload (or overwrite) an object and return its public URL. */
export async function uploadObject(path: string, body: Uint8Array, contentType: string): Promise<string> {
  const { baseUrl, serviceKey, bucket } = storageConfig();
  const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${encodePath(path)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": contentType,
      "Cache-Control": "max-age=31536000, immutable",
      "x-upsert": "true",
    },
    body: new Blob([new Uint8Array(body)], { type: contentType }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PipelineError("PROVIDER", `Supabase Storage upload failed (${res.status}) for ${path}: ${detail.slice(0, 300)}`);
  }
  return publicObjectUrl(path);
}
