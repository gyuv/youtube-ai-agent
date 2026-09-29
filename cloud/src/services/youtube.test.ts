import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildYouTubeMetadata, refreshAccessToken } from "./youtube";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const NOW = new Date("2026-10-01T10:00:00Z");
const base = {
  topic: "Why cities never sleep",
  title: "Cities <Never> Sleep",
  description: "The night shift, explained.",
  tags: ["cities", "night"],
  privacy: "PUBLIC" as const,
  format: "SHORT" as const,
  script: null,
  scheduledFor: null,
};
const channel = { language: "hi" };

describe("buildYouTubeMetadata", () => {
  it("tags Shorts, strips angle brackets and discloses synthetic media", () => {
    const meta = buildYouTubeMetadata(base, [], channel, NOW);
    expect(meta.snippet.title).toBe("Cities Never Sleep");
    expect(meta.snippet.description).toBe("The night shift, explained.\n\n#Shorts");
    expect(meta.snippet.defaultAudioLanguage).toBe("hi");
    expect(meta.status).toEqual({ privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  });

  it("schedules future posts as private with publishAt", () => {
    const scheduledFor = new Date("2026-10-02T12:30:00Z");
    const meta = buildYouTubeMetadata({ ...base, scheduledFor }, [], channel, NOW);
    expect(meta.status.privacyStatus).toBe("private");
    expect(meta.status.publishAt).toBe("2026-10-02T12:30:00.000Z");
  });

  it("never schedules private or unlisted videos, since YouTube makes scheduled videos public", () => {
    const scheduledFor = new Date("2026-10-02T12:30:00Z");
    for (const privacy of ["PRIVATE", "UNLISTED"] as const) {
      const meta = buildYouTubeMetadata({ ...base, privacy, scheduledFor }, [], channel, NOW);
      expect(meta.status.privacyStatus).toBe(privacy.toLowerCase());
      expect(meta.status.publishAt).toBeUndefined();
    }
  });

  it("adds chapters to long-form when scenes still match the script", () => {
    const beat = { narration: "n", imagePrompt: "i", stockQuery: "q" };
    const script = {
      title: "t",
      description: "d",
      tags: [],
      hook: beat,
      sections: [
        { heading: "Origins", ...beat },
        { heading: "Today", ...beat },
      ],
      cta: beat,
    };
    const scenes = [12, 40, 40, 6].map((durationSeconds, sceneIndex) => ({ sceneIndex, durationSeconds }));
    const meta = buildYouTubeMetadata({ ...base, format: "LONG_FORM", script }, scenes, channel, NOW);
    expect(meta.snippet.description).toMatch(/Chapters\n0:00 Intro\n0:12 Origins\n0:52 Today$/);
    expect(meta.snippet.description).not.toContain("#Shorts");

    const edited = buildYouTubeMetadata({ ...base, format: "LONG_FORM", script }, scenes.slice(0, 3), channel, NOW);
    expect(edited.snippet.description).toBe("The night shift, explained.");
  });
});

describe("refreshAccessToken", () => {
  it("explains an expired or revoked grant", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    await expect(refreshAccessToken("1//r")).rejects.toThrow(/reconnect the channel[\s\S]*Testing mode/);
  });

  it("returns the new token and its expiry", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    const fetchMock = vi.fn<FetchFn>(
      async () => new Response(JSON.stringify({ access_token: "ya29.new", expires_in: 3599 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { accessToken, expiresAt } = await refreshAccessToken("1//r");
    expect(accessToken).toBe("ya29.new");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 3500_000);
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain("grant_type=refresh_token");
  });
});
