import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ channel: { findUnique: vi.fn(), update: vi.fn() } }));
const youtube = vi.hoisted(() => ({ revokeGoogleGrant: vi.fn(), CLEARED_GRANT: { oauthRefreshTokenEnc: null } }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (value: string) => value.replace(/^enc:/, "") }));
vi.mock("./youtube", () => youtube);

import { disconnectChannel, setFullAutomation } from "./channels";

beforeEach(() => {
  db.channel.findUnique.mockReset();
  db.channel.update.mockReset();
  youtube.revokeGoogleGrant.mockReset();
});

describe("disconnectChannel", () => {
  it("revokes the grant at Google, then deletes the stored tokens", async () => {
    db.channel.findUnique.mockResolvedValue({ id: "c1", oauthRefreshTokenEnc: "enc:1//refresh" });
    youtube.revokeGoogleGrant.mockResolvedValue(true);
    await disconnectChannel("c1");
    expect(youtube.revokeGoogleGrant).toHaveBeenCalledWith("1//refresh");
    expect(db.channel.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: youtube.CLEARED_GRANT });
  });

  it("still deletes the tokens when Google can't confirm the revocation", async () => {
    db.channel.findUnique.mockResolvedValue({ id: "c1", oauthRefreshTokenEnc: "enc:1//refresh" });
    youtube.revokeGoogleGrant.mockResolvedValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await disconnectChannel("c1");
    expect(db.channel.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: youtube.CLEARED_GRANT });
  });

  it("skips Google for a channel that was never connected", async () => {
    db.channel.findUnique.mockResolvedValue({ id: "c1", oauthRefreshTokenEnc: null });
    await disconnectChannel("c1");
    expect(youtube.revokeGoogleGrant).not.toHaveBeenCalled();
    expect(db.channel.update).toHaveBeenCalled();
  });
});

describe("setFullAutomation", () => {
  it("turns on autopilot, auto-publish, public posting and learning, keeping an existing schedule", async () => {
    const channel = { id: "c1", name: "Ch", oauthRefreshTokenEnc: "enc", postingCron: "0 9 * * *" };
    db.channel.findUnique.mockResolvedValue(channel);
    db.channel.update.mockImplementation(async ({ data }) => ({ ...channel, ...data }));
    const updated = await setFullAutomation("c1", true);
    expect(updated).toMatchObject({ autopilot: true, autoPublish: true, autopilotReview: false, learnFromAnalytics: true, defaultPrivacy: "PUBLIC", postingCron: "0 9 * * *" });
  });

  it("adds a daily 7 am slot when there is no schedule, and refuses without YouTube", async () => {
    db.channel.findUnique.mockResolvedValue({ id: "c1", name: "Ch", oauthRefreshTokenEnc: "enc", postingCron: null });
    db.channel.update.mockImplementation(async ({ data }) => data);
    expect(await setFullAutomation("c1", true)).toMatchObject({ postingCron: "0 7 * * *" });
    db.channel.findUnique.mockResolvedValue({ id: "c1", name: "Ch", oauthRefreshTokenEnc: null });
    await expect(setFullAutomation("c1", true)).rejects.toThrow(/Connect "Ch" to YouTube/);
  });

  it("switching off stops the autopilot and auto-publish only", async () => {
    db.channel.findUnique.mockResolvedValue({ id: "c1", name: "Ch" });
    db.channel.update.mockImplementation(async ({ data }) => data);
    expect(await setFullAutomation("c1", false)).toEqual({ autopilot: false, autoPublish: false });
  });
});
