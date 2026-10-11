import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ brandAsset: { findFirst: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const branding = vi.hoisted(() => ({
  canSetBanner: vi.fn(() => true),
  generateBrandAsset: vi.fn(async (_id: string, kind: string) => ({ id: `${kind}1`, imageUrl: `https://cdn/${kind}.jpg`, text: null })),
  applyBanner: vi.fn(async () => {}),
}));
vi.mock("./branding", () => branding);

import { BANNER_REFRESH_MS, autoBrand, brandDue } from "./brandAutopilot";

const NOW = new Date("2026-10-11T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const channel = (autopilot = true) => ({ id: "c1", autopilot, oauthScopes: ["manage"], oauthRefreshTokenEnc: "x" });

beforeEach(() => {
  db.brandAsset.findFirst.mockReset().mockResolvedValue(null);
  Object.values(branding).forEach((f) => f.mockClear());
});

describe("autoBrand", () => {
  it("sets a banner and prepares a profile picture on an autopilot channel with none", async () => {
    const r = await autoBrand(channel(), { banner: false, avatar: false }, NOW);
    expect(branding.applyBanner).toHaveBeenCalledWith("banner1", NOW);
    expect([...r.handled]).toEqual(["banner", "avatar"]);
    expect(r.avatarRequest?.body).toContain("https://cdn/avatar.jpg");
  });

  it("does nothing with autopilot off", async () => {
    const r = await autoBrand(channel(false), { banner: true, avatar: true }, NOW);
    expect(branding.generateBrandAsset).not.toHaveBeenCalled();
    expect(r.handled.size).toBe(0);
  });

  it("leaves a recent banner alone", async () => {
    db.brandAsset.findFirst.mockResolvedValue({ createdAt: ago(86_400_000), appliedAt: ago(86_400_000) });
    await autoBrand(channel(), { banner: true, avatar: false }, NOW);
    expect(branding.generateBrandAsset).not.toHaveBeenCalled();
  });
});

it("refreshes monthly, or weekly when asked", () => {
  expect(brandDue(null, false, NOW)).toBe(true);
  expect(brandDue(ago(BANNER_REFRESH_MS), false, NOW)).toBe(true);
  expect(brandDue(ago(8 * 86_400_000), false, NOW)).toBe(false);
  expect(brandDue(ago(8 * 86_400_000), true, NOW)).toBe(true);
});
