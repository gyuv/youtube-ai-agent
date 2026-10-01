import { z } from "zod";
import type { Channel } from "@/generated/prisma/client";
import { ProjectStatus } from "@/generated/prisma/enums";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { generateGeminiJson, parseJsonText, sanitizeSchema, type GeminiClient } from "./gemini";
import { getChannelAccessToken } from "./youtube";

/**
 * The learning loop: once a day the autopilot reads each published video's YouTube statistics
 * (videos.list, 1 quota unit per 50 videos), then asks Gemini what separates the channel's best
 * videos from its weakest. The resulting notes go into every new topic and script prompt.
 */

export const STATS_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Stats on videos younger than this say more about timing than content; keep them out of lessons. */
const MIN_AGE_MS = 48 * 60 * 60 * 1000;
const STATS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_VIDEOS_TO_LEARN = 3;
export const MAX_NOTES_CHARS = 1500;

interface VideoStats {
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
}

const toInt = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Read statistics for up to 50 videos per request. Missing (deleted) videos are left out. */
export async function fetchVideoStats(videoIds: string[], accessToken: string): Promise<Map<string, VideoStats>> {
  const stats = new Map<string, VideoStats>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.map(encodeURIComponent).join(",")}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      throw new PipelineError("PROVIDER", `Could not reach YouTube for statistics: ${errorMessage(error)}`, { cause: error });
    }
    if (!res.ok) throw new PipelineError("PROVIDER", `YouTube statistics request failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const body = (await res.json()) as { items?: Array<{ id?: string; statistics?: Record<string, unknown> }> };
    for (const item of body.items ?? []) {
      const views = toInt(item.statistics?.viewCount);
      if (!item.id || views === null) continue;
      stats.set(item.id, { viewCount: views, likeCount: toInt(item.statistics?.likeCount), commentCount: toInt(item.statistics?.commentCount) });
    }
  }
  return stats;
}

/** Refresh stats for a channel's videos published in the last 90 days. Returns how many were updated. */
export async function refreshChannelStats(channel: Pick<Channel, "id" | "name" | "oauthRefreshTokenEnc">, now: Date = new Date()): Promise<number> {
  const videos = await prisma.videoProject.findMany({
    where: {
      channelId: channel.id,
      status: ProjectStatus.PUBLISHED,
      youtubeVideoId: { not: null },
      publishedAt: { gte: new Date(now.getTime() - STATS_WINDOW_MS) },
    },
    select: { id: true, youtubeVideoId: true },
  });
  if (videos.length === 0) return 0;
  const accessToken = await getChannelAccessToken(channel);
  const stats = await fetchVideoStats(videos.map((v) => v.youtubeVideoId!), accessToken);
  let updated = 0;
  for (const video of videos) {
    const s = stats.get(video.youtubeVideoId!);
    if (!s) continue;
    await prisma.videoProject.update({ where: { id: video.id }, data: { ...s, statsUpdatedAt: now } });
    updated++;
  }
  return updated;
}

export interface PerformanceRow {
  title: string;
  format: string;
  viewsPerDay: number;
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
}

/** Rank by views per day since publishing, so older videos don't win just by age. */
export function rankPerformance(
  videos: Array<{ title: string | null; topic: string; format: string; publishedAt: Date | null; viewCount: number | null; likeCount: number | null; commentCount: number | null }>,
  now: Date,
): PerformanceRow[] {
  return videos
    .filter((v) => v.publishedAt && v.viewCount !== null && now.getTime() - v.publishedAt.getTime() >= MIN_AGE_MS)
    .map((v) => {
      const days = Math.max(1, (now.getTime() - v.publishedAt!.getTime()) / 86_400_000);
      return {
        title: v.title?.trim() || v.topic,
        format: v.format,
        viewsPerDay: Math.round((v.viewCount! / days) * 10) / 10,
        viewCount: v.viewCount!,
        likeCount: v.likeCount,
        commentCount: v.commentCount,
      };
    })
    .sort((a, b) => b.viewsPerDay - a.viewsPerDay);
}

const NotesSchema = z.object({
  notes: z
    .string()
    .min(40)
    .max(MAX_NOTES_CHARS)
    .describe("5-8 short bullet lines starting with '- ': concrete, actionable lessons for future topics, titles, hooks and pacing."),
});
const NOTES_JSON_SCHEMA = sanitizeSchema(z.toJSONSchema(NotesSchema));

const row = (r: PerformanceRow) =>
  `- "${r.title}" (${r.format === "SHORT" ? "Short" : "long-form"}): ${r.viewsPerDay} views/day, ${r.viewCount} views, ${r.likeCount ?? "?"} likes, ${r.commentCount ?? "?"} comments`;

export function buildLearningPrompt(channel: Pick<Channel, "niche" | "targetAudience">, ranked: PerformanceRow[]) {
  const top = ranked.slice(0, 5);
  const bottom = ranked.slice(-5).filter((r) => !top.includes(r));
  return {
    system: [
      `You are a YouTube growth analyst for a faceless channel in the "${channel.niche}" niche.`,
      "From the performance data, find what the stronger videos share that the weaker ones lack: subject, angle, title wording, specificity, emotional pull.",
      "Write lessons the channel's writer can apply to the next video. Be concrete; no generic advice like 'use good thumbnails'.",
      "Small numbers are noisy: state a pattern only when several videos support it.",
    ].join("\n"),
    prompt: [
      channel.targetAudience?.trim() ? `Audience: ${channel.targetAudience.trim()}.` : "",
      `Best performers:\n${top.map(row).join("\n")}`,
      bottom.length ? `Weakest performers:\n${bottom.map(row).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * Rewrite the channel's performance notes from its ranked videos. Returns null when there isn't
 * enough data yet (fewer than 3 videos at least two days old).
 */
export async function learnFromPerformance(
  channel: Pick<Channel, "id" | "niche" | "targetAudience">,
  now: Date = new Date(),
  options: { client?: GeminiClient } = {},
): Promise<string | null> {
  const videos = await prisma.videoProject.findMany({
    where: { channelId: channel.id, status: ProjectStatus.PUBLISHED, viewCount: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: 60,
    select: { title: true, topic: true, format: true, publishedAt: true, viewCount: true, likeCount: true, commentCount: true },
  });
  const ranked = rankPerformance(videos, now);
  if (ranked.length < MIN_VIDEOS_TO_LEARN) return null;

  const { system, prompt } = buildLearningPrompt(channel, ranked);
  const { value } = await generateGeminiJson({
    task: "Performance analysis",
    systemInstruction: system,
    prompt,
    responseJsonSchema: NOTES_JSON_SCHEMA,
    parse: (text) => NotesSchema.parse(parseJsonText(text)).notes.trim(),
    ...options,
  });
  await prisma.channel.update({ where: { id: channel.id }, data: { performanceNotes: value, performanceNotesAt: now } });
  return value;
}

/** A channel whose stats are due for the daily refresh (YouTube connected, learning on). */
export async function findChannelToAnalyze(now: Date = new Date()) {
  return prisma.channel.findFirst({
    where: {
      isActive: true,
      learnFromAnalytics: true,
      oauthRefreshTokenEnc: { not: null },
      projects: { some: { status: ProjectStatus.PUBLISHED, youtubeVideoId: { not: null } } },
      OR: [{ performanceNotesAt: null }, { performanceNotesAt: { lt: new Date(now.getTime() - STATS_INTERVAL_MS) } }],
    },
    orderBy: { performanceNotesAt: { sort: "asc", nulls: "first" } },
  });
}

/** The daily analysis step: refresh stats, then relearn. Always stamps the channel so it waits a day. */
export async function analyzeChannel(channel: Channel, now: Date = new Date()): Promise<{ updated: number; notes: string | null }> {
  try {
    const updated = await refreshChannelStats(channel, now);
    const notes = await learnFromPerformance(channel, now);
    return { updated, notes };
  } finally {
    await prisma.channel.update({ where: { id: channel.id }, data: { performanceNotesAt: now } });
  }
}
