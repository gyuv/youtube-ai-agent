import { ProjectStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recentAutopilotEvents } from "./autopilot";
import { sceneHasAssets } from "./pipeline";
import { buildSchedule } from "./schedule";

export const ACTIVE_STATUSES: ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.SCRIPTED,
  ProjectStatus.ASSETS_READY,
  ProjectStatus.QUEUED_FOR_RENDER,
  ProjectStatus.RENDERING,
  ProjectStatus.RENDERED,
];

export async function getDashboard(now: Date = new Date(), scheduleDays = 7) {
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [channels, projects, byStatus, publishedThisMonth, lockedPrivate, scheduled, events] = await Promise.all([
    prisma.channel.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.videoProject.findMany({
      orderBy: { updatedAt: "desc" },
      take: 60,
      include: {
        channel: { select: { name: true, postingTimezone: true } },
        scenes: { select: { voiceAudioUrl: true, imageUrl: true, videoClipUrl: true, durationSeconds: true } },
      },
    }),
    prisma.videoProject.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.videoProject.count({ where: { status: ProjectStatus.PUBLISHED, publishedAt: { gte: monthAgo } } }),
    prisma.videoProject.count({ where: { status: ProjectStatus.PUBLISHED, youtubeLocked: true } }),
    prisma.videoProject.findMany({
      where: { scheduledFor: { gte: now } },
      select: { id: true, channelId: true, title: true, topic: true, status: true, scheduledFor: true },
    }),
    recentAutopilotEvents(8),
  ]);

  const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])) as Partial<Record<ProjectStatus, number>>;
  const count = (...statuses: ProjectStatus[]) => statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  return {
    channels,
    stats: {
      inProgress: count(ProjectStatus.DRAFT, ProjectStatus.SCRIPTED, ProjectStatus.ASSETS_READY),
      rendering: count(ProjectStatus.QUEUED_FOR_RENDER, ProjectStatus.RENDERING),
      // Failed videos, and published ones YouTube kept private.
      needsAttention: count(ProjectStatus.FAILED) + lockedPrivate,
      publishedThisMonth,
    },
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      topic: p.topic,
      status: p.status,
      format: p.format,
      channelName: p.channel.name,
      timeZone: p.channel.postingTimezone,
      updatedAt: p.updatedAt,
      scheduledFor: p.scheduledFor,
      lastError: p.lastError,
      autopilot: p.autopilot,
      youtubeLocked: p.status === ProjectStatus.PUBLISHED && p.youtubeLocked,
      scenesReady: p.scenes.filter(sceneHasAssets).length,
      sceneCount: p.scenes.length,
    })),
    schedule: buildSchedule(channels, scheduled, now, scheduleDays),
    autopilot: {
      channelsOn: channels.filter((c) => c.autopilot && c.isActive).length,
      events,
    },
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
