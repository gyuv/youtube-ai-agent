import { CronExpressionParser } from "cron-parser";
import type { ProjectStatus } from "@/generated/prisma/enums";

/**
 * Posting schedule maths. A channel posts on a 5-field cron evaluated in its own time zone;
 * a project "fills" a slot when its scheduledFor lands on that slot.
 */

const SAME_SLOT_MS = 60_000;

export function isValidCron(expression: string): boolean {
  if (expression.trim().split(/\s+/).length !== 5) return false; // no seconds field
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function nextPostingTimes(cron: string, timeZone: string, count: number, from: Date = new Date()): Date[] {
  const interval = CronExpressionParser.parse(cron, { tz: timeZone, currentDate: from });
  return Array.from({ length: count }, () => interval.next().toDate());
}

export interface ScheduleChannel {
  id: string;
  name: string;
  postingCron: string | null;
  postingTimezone: string;
  isActive: boolean;
}

export interface ScheduleProject {
  id: string;
  channelId: string;
  title: string | null;
  topic: string;
  status: ProjectStatus;
  scheduledFor: Date | null;
}

export interface ScheduleEntry {
  at: Date;
  channel: Pick<ScheduleChannel, "id" | "name" | "postingTimezone">;
  project: Pick<ScheduleProject, "id" | "title" | "topic" | "status"> | null;
  /** "slot": from the channel's cron; "custom": a project scheduled off-cron. */
  kind: "slot" | "custom";
}

/** Merge channel cron slots with scheduled projects over the next `days`. */
export function buildSchedule(channels: ScheduleChannel[], projects: ScheduleProject[], now: Date, days: number): ScheduleEntry[] {
  const end = now.getTime() + days * 24 * 60 * 60 * 1000;
  const upcoming = projects.filter((p) => p.scheduledFor && p.scheduledFor.getTime() >= now.getTime() && p.scheduledFor.getTime() < end);
  const placed = new Set<string>();
  const entries: ScheduleEntry[] = [];

  for (const channel of channels) {
    if (!channel.isActive || !channel.postingCron || !isValidCron(channel.postingCron)) continue;
    for (const at of nextPostingTimes(channel.postingCron, channel.postingTimezone, 200, now)) {
      if (at.getTime() >= end) break;
      const project = upcoming.find(
        (p) => p.channelId === channel.id && !placed.has(p.id) && Math.abs(p.scheduledFor!.getTime() - at.getTime()) < SAME_SLOT_MS,
      );
      if (project) placed.add(project.id);
      entries.push({ at, channel, project: project ?? null, kind: "slot" });
    }
  }

  const byId = new Map(channels.map((c) => [c.id, c]));
  for (const project of upcoming) {
    const channel = byId.get(project.channelId);
    if (placed.has(project.id) || !channel) continue;
    entries.push({ at: project.scheduledFor!, channel, project, kind: "custom" });
  }
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The first cron slot on this channel that no project has claimed yet. */
export function firstFreeSlot(channel: ScheduleChannel, takenTimes: Date[], now: Date = new Date()): Date | null {
  if (!channel.postingCron || !isValidCron(channel.postingCron)) return null;
  return (
    nextPostingTimes(channel.postingCron, channel.postingTimezone, 200, now).find(
      (at) => !takenTimes.some((t) => Math.abs(t.getTime() - at.getTime()) < SAME_SLOT_MS),
    ) ?? null
  );
}

/** "Wed 30 Sep, 6:00 pm IST" in the channel's own time zone. */
export function formatSlot(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(at);
}
