import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVideoVisibility, isLockedPrivate, readVisibility } from "./youtubeVisibility";

const NOW = new Date("2026-09-29T12:00:00Z");
const at = (offsetMinutes: number) => new Date(NOW.getTime() + offsetMinutes * 60_000).toISOString();

afterEach(() => vi.unstubAllGlobals());

describe("readVisibility", () => {
  it("reads privacy and schedule from a video resource", () => {
    expect(readVisibility({ id: "x", status: { privacyStatus: "private", publishAt: "2026-09-30T18:00:00.000Z" } })).toEqual({
      privacyStatus: "private",
      publishAt: "2026-09-30T18:00:00.000Z",
    });
    expect(readVisibility({ status: { privacyStatus: "public" } })).toEqual({ privacyStatus: "public", publishAt: null });
    expect(readVisibility({ status: { privacyStatus: "private", publishAt: "2026-09-30T23:30:00+05:30" } })?.publishAt).toBe("2026-09-30T18:00:00.000Z");
    expect(readVisibility({ status: { privacyStatus: "private", publishAt: "soon" } })?.publishAt).toBeNull();
  });

  it("returns null when the resource has no usable status", () => {
    expect(readVisibility({ id: "x" })).toBeNull();
    expect(readVisibility({ status: { privacyStatus: "secret" } })).toBeNull();
    expect(readVisibility(null)).toBeNull();
  });
});

describe("isLockedPrivate", () => {
  it("flags a private video that should be public or unlisted", () => {
    expect(isLockedPrivate("public", { privacyStatus: "private", publishAt: null }, NOW)).toBe(true);
    expect(isLockedPrivate("unlisted", { privacyStatus: "private", publishAt: null }, NOW)).toBe(true);
  });

  it("accepts what was asked for", () => {
    expect(isLockedPrivate("public", { privacyStatus: "public", publishAt: null }, NOW)).toBe(false);
    expect(isLockedPrivate("unlisted", { privacyStatus: "unlisted", publishAt: null }, NOW)).toBe(false);
    expect(isLockedPrivate("private", { privacyStatus: "private", publishAt: null }, NOW)).toBe(false);
  });

  it("waits for a scheduled video's slot, with some grace, before calling it locked", () => {
    expect(isLockedPrivate("public", { privacyStatus: "private", publishAt: at(60) }, NOW)).toBe(false);
    expect(isLockedPrivate("public", { privacyStatus: "private", publishAt: at(-10) }, NOW)).toBe(false);
    expect(isLockedPrivate("public", { privacyStatus: "private", publishAt: at(-45) }, NOW)).toBe(true);
  });
});

describe("fetchVideoVisibility", () => {
  it("reads the status with videos.list", async () => {
    const fetchMock = vi.fn(async () => Response.json({ items: [{ id: "abc", status: { privacyStatus: "unlisted" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchVideoVisibility("abc", "ya29.t")).resolves.toEqual({ privacyStatus: "unlisted", publishAt: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/youtube/v3/videos?part=status&id=abc");
    expect(init.headers).toEqual({ Authorization: "Bearer ya29.t" });
  });

  it("returns null for a deleted video and explains API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [] })));
    await expect(fetchVideoVisibility("abc", "t")).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Request had insufficient authentication scopes." } }, { status: 403 })));
    await expect(fetchVideoVisibility("abc", "t")).rejects.toThrow(/403.*insufficient authentication scopes/);
  });
});
