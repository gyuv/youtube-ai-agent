import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadObject } from "./storage";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

describe("uploadObject", () => {
  beforeEach(() => {
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
});
