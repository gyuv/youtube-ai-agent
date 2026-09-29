import { describe, expect, it, vi } from "vitest";
import {
  buildPollinationsUrl,
  canvasFor,
  findStockVisual,
  generatePollinationsImage,
  pickVideoFile,
  searchPexelsVideo,
  type PexelsVideoFile,
} from "./visualFetcher";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<FetchFn>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const file = (id: number, width: number, height: number, type = "video/mp4"): PexelsVideoFile => ({
  id,
  quality: "hd",
  file_type: type,
  width,
  height,
  link: `https://videos.pexels.com/${id}.mp4`,
});

const video = (id: number, duration: number, files: PexelsVideoFile[]) => ({
  id,
  width: 1080,
  height: 1920,
  duration,
  url: `https://www.pexels.com/video/${id}/`,
  image: `https://images.pexels.com/videos/${id}/preview.jpg`,
  user: { name: `Creator ${id}` },
  video_files: files,
});

describe("canvasFor", () => {
  it("maps formats to 1080p canvases", () => {
    expect(canvasFor("SHORT")).toEqual({ width: 1080, height: 1920, orientation: "portrait" });
    expect(canvasFor("LONG_FORM")).toEqual({ width: 1920, height: 1080, orientation: "landscape" });
  });
});

describe("Pollinations", () => {
  it("builds a keyless URL with size, seed and an encoded prompt", () => {
    const url = new URL(buildPollinationsUrl("a fox / at dawn?", { width: 1080, height: 1920, seed: 42 }));
    expect(url.origin).toBe("https://image.pollinations.ai");
    expect(url.pathname).toBe("/prompt/a%20fox%20%2F%20at%20dawn%3F");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ width: "1080", height: "1920", seed: "42", nologo: "true" });
  });

  it("downloads the image and sends the optional token", async () => {
    vi.stubEnv("POLLINATIONS_TOKEN", "tok");
    const fetchMock = stubFetch(new Response(new Uint8Array(4096), { headers: { "content-type": "image/jpeg" } }));
    const image = await generatePollinationsImage("a fox", { width: 1080, height: 1920, seed: 7 });
    expect(image.bytes.length).toBe(4096);
    expect(image.seed).toBe(7);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("explains rate limits and rejects non-image responses", async () => {
    stubFetch(new Response("slow down", { status: 429, headers: { "content-type": "text/plain" } }));
    await expect(generatePollinationsImage("a fox", { width: 64, height: 64 })).rejects.toThrow(/rate limited/);

    stubFetch(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(generatePollinationsImage("a fox", { width: 64, height: 64 })).rejects.toThrow(/Pollinations returned 200/);
  });
});

describe("pickVideoFile", () => {
  it("prefers the 1080p rendition in the right orientation over 4K and SD", () => {
    const files = [file(1, 2160, 3840), file(2, 540, 960), file(3, 1080, 1920), file(4, 1920, 1080), file(5, 1080, 1920, "video/webm")];
    expect(pickVideoFile(files, "portrait")?.id).toBe(3);
    expect(pickVideoFile(files, "landscape")?.id).toBe(4);
  });

  it("falls back to the closest smaller file when no 1080p exists", () => {
    expect(pickVideoFile([file(1, 360, 640), file(2, 720, 1280)], "portrait")?.id).toBe(2);
    expect(pickVideoFile([file(1, 1920, 1080)], "portrait")).toBeNull();
  });
});

describe("Pexels search", () => {
  it("prefers clips that cover the narration and skips the current clip", async () => {
    vi.stubEnv("PEXELS_API_KEY", "px-key");
    const fetchMock = stubFetch(
      json({
        videos: [
          video(10, 20, [file(100, 1080, 1920)]), // current clip, excluded
          video(11, 3, [file(110, 1080, 1920)]), // too short
          video(12, 15, [file(120, 1080, 1920)]),
        ],
      }),
    );
    const result = await searchPexelsVideo("rainy street", {
      orientation: "portrait",
      minDurationSeconds: 8,
      excludeUrls: ["https://videos.pexels.com/100.mp4"],
    });
    expect(result).toMatchObject({ kind: "video", pexelsId: 12, url: "https://videos.pexels.com/120.mp4", credit: "Creator 12" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/videos/search?query=rainy+street&orientation=portrait");
    expect(init?.headers).toMatchObject({ Authorization: "px-key" });
  });

  it("falls back to a cropped stock photo when no clip matches", async () => {
    vi.stubEnv("PEXELS_API_KEY", "px-key");
    stubFetch(
      json({ videos: [] }),
      json({
        photos: [{ id: 5, width: 4000, height: 6000, url: "https://www.pexels.com/photo/5/", photographer: "Ana", src: { original: "https://images.pexels.com/photos/5/a.jpeg", medium: "m.jpg" } }],
      }),
    );
    const result = await findStockVisual("rainy street", { orientation: "portrait" });
    expect(result).toMatchObject({ kind: "photo", pexelsId: 5, credit: "Ana" });
    expect(result?.url).toBe("https://images.pexels.com/photos/5/a.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1920");
  });

  it("surfaces quota errors and a missing key", async () => {
    vi.stubEnv("PEXELS_API_KEY", "px-key");
    stubFetch(json({}, 429));
    await expect(searchPexelsVideo("x", { orientation: "portrait" })).rejects.toThrow(/hourly quota/);

    vi.stubEnv("PEXELS_API_KEY", "");
    await expect(searchPexelsVideo("x", { orientation: "portrait" })).rejects.toThrow(/PEXELS_API_KEY is not set/);
  });
});
