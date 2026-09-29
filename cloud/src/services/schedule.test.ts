import { describe, expect, it } from "vitest";
import { buildSchedule, firstFreeSlot, isValidCron, isValidTimeZone, nextPostingTimes, type ScheduleChannel } from "./schedule";

const NOW = new Date("2026-09-29T00:00:00Z"); // a Tuesday
const channel: ScheduleChannel = { id: "c1", name: "Money Minute", postingCron: "0 18 * * 1,3,5", postingTimezone: "Asia/Kolkata", isActive: true };

describe("validation", () => {
  it("accepts 5-field cron only", () => {
    expect(isValidCron("0 18 * * 1,3,5")).toBe(true);
    expect(isValidCron("0 0 18 * * 1")).toBe(false); // seconds field
    expect(isValidCron("every day")).toBe(false);
  });

  it("knows IANA time zones", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("nextPostingTimes", () => {
  it("evaluates the cron in the channel's own time zone", () => {
    const [wed, fri] = nextPostingTimes(channel.postingCron!, channel.postingTimezone, 2, NOW);
    expect(wed.toISOString()).toBe("2026-09-30T12:30:00.000Z"); // 6 pm IST
    expect(fri.toISOString()).toBe("2026-10-02T12:30:00.000Z");
  });
});

describe("buildSchedule", () => {
  const project = (id: string, at: string, channelId = "c1") => ({
    id,
    channelId,
    title: `Video ${id}`,
    topic: id,
    status: "SCRIPTED" as const,
    scheduledFor: new Date(at),
  });

  it("fills cron slots with matching projects and lists off-slot projects separately", () => {
    const entries = buildSchedule(
      [channel, { ...channel, id: "c2", name: "Paused", isActive: false }],
      [project("a", "2026-09-30T12:30:00Z"), project("b", "2026-10-01T09:00:00Z"), project("far", "2026-12-01T12:30:00Z")],
      NOW,
      7,
    );
    expect(entries.map((e) => [e.at.toISOString(), e.kind, e.project?.id ?? null])).toEqual([
      ["2026-09-30T12:30:00.000Z", "slot", "a"],
      ["2026-10-01T09:00:00.000Z", "custom", "b"],
      ["2026-10-02T12:30:00.000Z", "slot", null],
      ["2026-10-05T12:30:00.000Z", "slot", null],
    ]);
  });
});

describe("firstFreeSlot", () => {
  it("skips slots already taken", () => {
    const slot = firstFreeSlot(channel, [new Date("2026-09-30T12:30:00Z")], NOW);
    expect(slot?.toISOString()).toBe("2026-10-02T12:30:00.000Z");
  });

  it("returns null without a schedule", () => {
    expect(firstFreeSlot({ ...channel, postingCron: null }, [], NOW)).toBeNull();
  });
});
