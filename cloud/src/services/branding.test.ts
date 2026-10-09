import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ brandAsset: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./youtube", () => ({ MANAGE_SCOPE: "manage", getChannelAccessToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/storage", () => ({ uploadObject: vi.fn() }));

import { applyBanner, buildBrandPrompt, canSetBanner } from "./branding";

const asset = (scopes = ["manage"]) => ({
  id: "b1",
  kind: "banner",
  imageUrl: "https://cdn/banner.jpg",
  channel: { id: "c1", name: "Yo Yo AI", oauthScopes: scopes, oauthRefreshTokenEnc: "enc" },
});

beforeEach(() => {
  db.brandAsset.findUnique.mockReset();
  db.brandAsset.update.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("applyBanner", () => {
  it("uploads the banner and keeps the channel's other branding settings", async () => {
    db.brandAsset.findUnique.mockResolvedValue(asset());
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === "https://cdn/banner.jpg") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
        if (url.includes("channelBanners/insert")) return Response.json({ url: "https://yt/banner" });
        if (init?.method === "PUT") return Response.json({});
        return Response.json({ items: [{ id: "UC1", brandingSettings: { channel: { description: "Keep me", keywords: "ai tools" }, image: { other: 1 } } }] });
      }),
    );
    await applyBanner("b1");
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(JSON.parse(put.init!.body as string)).toEqual({
      id: "UC1",
      brandingSettings: { channel: { description: "Keep me", keywords: "ai tools" }, image: { other: 1, bannerExternalUrl: "https://yt/banner" } },
    });
    expect(db.brandAsset.update).toHaveBeenCalled();
  });

  it("asks for a reconnect when the channel lacks the manage permission", async () => {
    db.brandAsset.findUnique.mockResolvedValue(asset(["upload"]));
    await expect(applyBanner("b1")).rejects.toThrow(/Reconnect YouTube/);
  });
});

it("only allows setting the banner with a grant that includes the manage scope", () => {
  expect(canSetBanner({ oauthScopes: ["manage"], oauthRefreshTokenEnc: "x" })).toBe(true);
  expect(canSetBanner({ oauthScopes: ["manage"], oauthRefreshTokenEnc: null })).toBe(false);
});

it("asks for images without text and honest subscribe appeals", () => {
  const { system, prompt } = buildBrandPrompt(
    { name: "Yo Yo AI", niche: "AI tools", targetAudience: null, language: "en", growthGoal: "SUBSCRIBERS", mastermindNotes: null },
    "avatar",
  );
  expect(system).toContain("Grow subscribers");
  expect(system).toContain("no giveaways");
  expect(prompt).toContain("98px");
});
