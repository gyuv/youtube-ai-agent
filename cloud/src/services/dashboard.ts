import { ProjectStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recentAutopilotEvents } from "./autopilot";
import { sceneHasAssets } from "./pipeline";
import { OVERDUE_GRACE_MS, RESCHEDULABLE_STATUSES, countOverdue } from "./overdue";
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
  const missedBy = new Date(now.getTime() - OVERDUE_GRACE_MS);
  const [channels, projects, byStatus, publishedThisMonth, lockedPrivate, scheduled, events, overdue] = await Promise.all([
    prisma.channel.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.videoProject.findMany({
      orderBy: { updatedAt: "desc" },
      take: 150,
      include: {
        channel: { select: { name: true, postingTimezone: true } },
        scenes: { orderBy: { sceneIndex: "asc" }, select: { voiceAudioUrl: true, imageUrl: true, videoClipUrl: true, durationSeconds: true } },
      },
    }),
    prisma.videoProject.groupBy({ by: ["status"], _count: { _all: true } }),
    // Live means uploaded and past its go-live time; scheduled uploads are counted separately.
    prisma.videoProject.count({
      where: { status: ProjectStatus.PUBLISHED, youtubeLocked: false, publishedAt: { gte: monthAgo }, OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
    }),
    prisma.videoProject.count({ where: { status: ProjectStatus.PUBLISHED, youtubeLocked: true } }),
    prisma.videoProject.findMany({
      where: { scheduledFor: { gte: now } },
      select: {
        id: true,
        channelId: true,
        title: true,
        topic: true,
        status: true,
        scheduledFor: true,
        youtubeLocked: true,
        thumbnailUrl: true,
        scenes: { orderBy: { sceneIndex: "asc" }, take: 1, select: { imageUrl: true } },
      },
    }),
    recentAutopilotEvents(20),
    countOverdue(now),
  ]);
  const mastermindAsks = await prisma.mastermindRequest.count({ where: { status: "open" } });

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
      overdue,
      mastermindAsks,
      scheduledOnYouTube: projects.filter((p) => p.status === ProjectStatus.PUBLISHED && !p.youtubeLocked && p.scheduledFor && p.scheduledFor > now).length,
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
      // On YouTube but held until its slot.
      goesLiveAt: p.status === ProjectStatus.PUBLISHED && !p.youtubeLocked && p.scheduledFor && p.scheduledFor > now ? p.scheduledFor : null,
      // Its slot passed before it reached YouTube; the autopilot (or the operator) moves it on.
      missedSlot: Boolean(p.scheduledFor && p.scheduledFor < missedBy && !p.youtubeVideoId && RESCHEDULABLE_STATUSES.includes(p.status)),
      autopilotFailures: p.autopilotFailures,
      channelId: p.channelId,
      thumbnail: thumbnailOf(p),
      renderedVideoUrl: p.renderedVideoUrl,
      youtubeVideoId: p.youtubeVideoId,
      renderStartedAt: p.status === ProjectStatus.RENDERING || p.status === ProjectStatus.QUEUED_FOR_RENDER ? (p.renderStartedAt ?? p.updatedAt) : null,
      viewCount: p.viewCount,
      likeCount: p.likeCount,
      publishedAt: p.publishedAt,
      scenesReady: p.scenes.filter(sceneHasAssets).length,
      sceneCount: p.scenes.length,
    })),
    // How many videos sit at each stage, for the pipeline strip.
    stages: {
      planned: count(ProjectStatus.DRAFT),
      scripted: count(ProjectStatus.SCRIPTED),
      assets: count(ProjectStatus.ASSETS_READY),
      rendering: count(ProjectStatus.QUEUED_FOR_RENDER, ProjectStatus.RENDERING),
      rendered: count(ProjectStatus.RENDERED),
      published: count(ProjectStatus.PUBLISHED),
    },
    schedule: buildSchedule(channels, scheduled, now, scheduleDays),
    /** Thumbnails for the week view, by project id. */
    scheduleThumbs: Object.fromEntries(scheduled.map((p) => [p.id, thumbnailOf(p)])),
    // What is happening right now: renders in flight and the next video to go live.
    now: {
      rendering: projects
        .filter((p) => p.status === ProjectStatus.RENDERING || p.status === ProjectStatus.QUEUED_FOR_RENDER)
        .map((p) => ({ id: p.id, title: p.title ?? p.topic, queued: p.status === ProjectStatus.QUEUED_FOR_RENDER, since: p.renderStartedAt ?? p.updatedAt })),
      nextLive:
        scheduled
          .filter((p) => p.scheduledFor! > now && p.status !== ProjectStatus.FAILED)
          .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime())
          .map((p) => ({ id: p.id, title: p.title ?? p.topic, at: p.scheduledFor!, status: p.status, thumbnail: thumbnailOf(p) }))[0] ?? null,
    },
    performance: performanceByChannel(channels, projects, now),
    autopilot: {
      channelsOn: channels.filter((c) => c.autopilot && c.isActive).length,
      events,
    },
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

interface ThumbSource {
  thumbnailUrl: string | null;
  scenes: { imageUrl: string | null }[];
}

/** The uploaded thumbnail, else the first scene's image. */
function thumbnailOf(p: ThumbSource): string | null {
  return p.thumbnailUrl ?? p.scenes[0]?.imageUrl ?? null;
}

interface PerfProject {
  id: string;
  channelId: string;
  title: string | null;
  topic: string;
  status: ProjectStatus;
  viewCount: number | null;
  likeCount: number | null;
  publishedAt: Date | null;
}

/** Views on each channel's recent uploads, from the stats the autopilot refreshes daily. */
export function performanceByChannel(channels: { id: string; name: string }[], projects: PerfProject[], now: Date) {
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return channels
    .map((channel) => {
      const live = projects
        .filter((p) => p.channelId === channel.id && p.status === ProjectStatus.PUBLISHED && p.publishedAt && p.viewCount !== null)
        .sort((a, b) => a.publishedAt!.getTime() - b.publishedAt!.getTime());
      const recent = live.filter((p) => p.publishedAt!.getTime() >= since);
      const top = [...recent].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))[0];
      return {
        channelId: channel.id,
        name: channel.name,
        views30d: recent.reduce((sum, p) => sum + (p.viewCount ?? 0), 0),
        likes30d: recent.reduce((sum, p) => sum + (p.likeCount ?? 0), 0),
        videos30d: recent.length,
        // Last 12 uploads, oldest first, for the sparkline.
        series: live.slice(-12).map((p) => p.viewCount ?? 0),
        top: top ? { id: top.id, title: top.title ?? top.topic, views: top.viewCount ?? 0 } : null,
      };
    })
    .filter((c) => c.series.length > 0);
}
