import sharp from "sharp";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("./youtube", () => ({ MANAGE_SCOPE: "manage", getChannelAccessToken: vi.fn() }));
vi.mock("@/lib/storage", () => ({ uploadObject: vi.fn() }));

import { toYoutubeBanner } from "./branding";

it("re-encodes a small WebP into a 2560x1440 JPEG under 6 MB, which YouTube accepts", async () => {
  const webp = await sharp({ create: { width: 1024, height: 576, channels: 3, background: "#3a6" } }).webp().toBuffer();
  const out = await toYoutubeBanner(webp);
  const meta = await sharp(out).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 2560, 1440]);
  expect(out.length).toBeLessThan(6 * 1024 * 1024);
});
