import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSignedUpload, maxObjectBytes, uploadObject } from "./storage";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

describe("Supabase storage (default driver)", () => {
  beforeEach(() => {
    vi.stubEnv("STORAGE_DRIVER", "");
    vi.stubEnv("STORAGE_MAX_OBJECT_MB", "");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co/");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "media");
  });

  it("upserts into the bucket and returns the public URL", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const url = await uploadObject("projects/p1/scenes/s 1/voice.mp3", new Uint8Array([1, 2, 3]), "audio/mpeg");

    expect(url).toBe("https://abc.supabase.co/storage/v1/object/public/media/projects/p1/scenes/s%201/voice.mp3");
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://abc.supabase.co/storage/v1/object/media/projects/p1/scenes/s%201/voice.mp3");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer service-key", "x-upsert": "true", "Content-Type": "audio/mpeg" });
    expect((init?.body as Blob).size).toBe(3);
  });

  it("reports storage errors with the response detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"Bucket not found"}', { status: 404 })));
    await expect(uploadObject("a.mp3", new Uint8Array([1]), "audio/mpeg")).rejects.toThrow(/404.*Bucket not found/);
  });

  it("creates a signed upload URL the runner can PUT to without credentials", async () => {
    const fetchMock = vi.fn<FetchFn>(
      async () => new Response(JSON.stringify({ url: "/object/upload/sign/media/projects/p1/renders/run-7.mp4?token=abc" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const signed = await createSignedUpload("projects/p1/renders/run-7.mp4", "video/mp4");

    expect(fetchMock.mock.calls[0][0]).toBe("https://abc.supabase.co/storage/v1/object/upload/sign/media/projects/p1/renders/run-7.mp4");
    expect(signed).toEqual({
      url: "https://abc.supabase.co/storage/v1/object/upload/sign/media/projects/p1/renders/run-7.mp4?token=abc",
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Cache-Control": "max-age=31536000, immutable", "x-upsert": "true" },
      publicUrl: "https://abc.supabase.co/storage/v1/object/public/media/projects/p1/renders/run-7.mp4",
    });
    expect(JSON.stringify(signed)).not.toContain("service-key");
  });

  it("reports the free-tier object limit, overridable for paid plans", () => {
    expect(maxObjectBytes()).toBe(50 * 1024 * 1024);
    vi.stubEnv("STORAGE_MAX_OBJECT_MB", "500");
    expect(maxObjectBytes()).toBe(500 * 1024 * 1024);
  });
});

describe("Cloudflare R2 driver", () => {
  beforeEach(() => {
    vi.stubEnv("STORAGE_DRIVER", "r2");
    vi.stubEnv("STORAGE_MAX_OBJECT_MB", "");
    vi.stubEnv("R2_ACCOUNT_ID", "acct123");
    vi.stubEnv("R2_BUCKET", "lumen");
    vi.stubEnv("R2_ACCESS_KEY_ID", "AKIDEXAMPLE");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "r2-secret");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com/");
  });

  it("presigns a PUT that expires and serves from the public domain", async () => {
    const signed = await createSignedUpload("projects/p1/renders/run-7.mp4", "video/mp4");
    const url = new URL(signed.url);
    expect(url.host).toBe("acct123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/lumen/projects/p1/renders/run-7.mp4");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("21600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.url).not.toContain("r2-secret");
    expect(signed.publicUrl).toBe("https://media.example.com/projects/p1/renders/run-7.mp4");
    expect(maxObjectBytes()).toBe(5 * 1024 * 1024 * 1024);
  });

  it("uploads small assets with a signed S3 request", async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.method).toBe("PUT");
      expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadObject("a/b.jpg", new Uint8Array([1]), "image/jpeg")).resolves.toBe("https://media.example.com/a/b.jpg");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
