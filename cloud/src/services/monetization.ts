import type { Channel, Prisma } from "@/generated/prisma/client";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ANALYTICS_SCOPE, getChannelAccessToken } from "./youtube";

/**
 * Progress toward the YouTube Partner Program, per channel.
 *
 * Two tiers (YouTube's published thresholds, which it can change):
 *  - Fan funding (memberships, Super Thanks): 500 subscribers + 3 public uploads in 90 days, and
 *    3,000 public watch hours in 12 months or 3M Shorts views in 90 days.
 *  - Ad revenue: 1,000 subscribers, and 4,000 public watch hours in 12 months or 10M Shorts views
 *    in 90 days.
 * Subscribers come from the Data API (youtube.readonly); watch hours and Shorts views need the
 * YouTube Analytics API (yt-analytics.readonly), so channels connected without it show subscribers
 * only. Shorts watch time does not count toward watch hours, so hours exclude the Shorts feed.
 */

export const TIERS = {
  fanFunding: { label: "Fan funding", subs: 500, uploads90d: 3, hours: 3000, shortsViews: 3_000_000 },
  adRevenue: { label: "Ad revenue", subs: 1000, uploads90d: 0, hours: 4000, shortsViews: 10_000_000 },
} as const;
export type TierKey = keyof typeof TIERS;

export const CHANNEL_STATS_INTERVAL_MS = 12 * 60 * 60 * 1000;
const HISTORY_POINTS = 60;

export interface StatsPoint {
  at: string;
  subs: number | null;
  views: number | null;
  hours: number | null;
  shorts: number | null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function getJson(url: string, token: string, what: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new PipelineError("PROVIDER", `Could not reach YouTube for ${what}: ${errorMessage(error)}`, { cause: error });
  }
  if (!res.ok) throw new PipelineError("PROVIDER", `YouTube ${what} request failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as Record<string, unknown>;
}

/** channels.list statistics (1 quota unit). Hidden subscriber counts come back as null. */
export async function fetchChannelStatistics(token: string) {
  const body = await getJson("https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true", token, "channel statistics");
  const stats = ((body.items as Array<{ statistics?: Record<string, unknown> }> | undefined)?.[0]?.statistics ?? {}) as Record<string, unknown>;
  return {
    subscriberCount: stats.hiddenSubscriberCount ? null : num(stats.subscriberCount),
    totalViews: num(stats.viewCount),
    youtubeVideoCount: num(stats.videoCount),
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * YouTube Analytics split by content type: watch hours outside the Shorts feed over 365 days, and
 * Shorts views over 90 days. Analytics data lags 2-3 days, which the windows absorb.
 */
export async function fetchMonetizationAnalytics(token: string, now: Date) {
  const report = async (days: number) => {
    const params = new URLSearchParams({
      ids: "channel==MINE",
      startDate: day(new Date(now.getTime() - days * 86_400_000)),
      endDate: day(now),
      metrics: "views,estimatedMinutesWatched",
      dimensions: "creatorContentType",
    });
    const body = await getJson(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, token, "analytics");
    return (body.rows as Array<[string, number, number]> | undefined) ?? [];
  };
  const [year, quarter] = await Promise.all([report(365), report(90)]);
  const isShorts = (type: string) => type.toUpperCase() === "SHORTS";
  const watchMinutes = year.filter(([type]) => !isShorts(type)).reduce((sum, [, , minutes]) => sum + (Number(minutes) || 0), 0);
  const shortsViews = quarter.filter(([type]) => isShorts(type)).reduce((sum, [, views]) => sum + (Number(views) || 0), 0);
  return { watchHours12m: Math.round((watchMinutes / 60) * 10) / 10, shortsViews90d: Math.round(shortsViews) };
}

export function hasAnalyticsScope(channel: Pick<Channel, "oauthScopes">): boolean {
  return channel.oauthScopes.includes(ANALYTICS_SCOPE);
}

/** Refresh the channel's numbers and append a point to its history (one per day). */
export async function refreshMonetizationStats(
  channel: Pick<Channel, "id" | "name" | "oauthRefreshTokenEnc" | "oauthScopes" | "statsHistory">,
  now: Date = new Date(),
) {
  const token = await getChannelAccessToken(channel);
  const stats = await fetchChannelStatistics(token);
  let analytics: { watchHours12m: number | null; shortsViews90d: number | null } = { watchHours12m: null, shortsViews90d: null };
  if (hasAnalyticsScope(channel)) {
    // Analytics failing (API not enabled in the Google project) must not lose the subscriber count.
    analytics = await fetchMonetizationAnalytics(token, now).catch((error) => {
      console.error(`Analytics for ${channel.name} failed`, error);
      return analytics;
    });
  }
  const history = ((channel.statsHistory as unknown as StatsPoint[] | null) ?? []).filter((p) => p.at.slice(0, 10) !== day(now));
  history.push({ at: now.toISOString(), subs: stats.subscriberCount, views: stats.totalViews, hours: analytics.watchHours12m, shorts: analytics.shortsViews90d });
  const data = {
    ...stats,
    ...(analytics.watchHours12m !== null ? analytics : {}),
    channelStatsAt: now,
    statsHistory: history.slice(-HISTORY_POINTS) as unknown as Prisma.InputJsonValue,
  };
  await prisma.channel.update({ where: { id: channel.id }, data });
  return data;
}

export interface Requirement {
  key: "subs" | "uploads" | "hours" | "shorts";
  label: string;
  current: number | null;
  target: number;
  progress: number; // 0..1
  /** Days to reach the target at the recent pace; null when unknown or not growing. */
  etaDays: number | null;
}

export interface TierProgress {
  key: TierKey;
  label: string;
  eligible: boolean;
  /** Subscribers (+ uploads) are required; watch hours OR Shorts views complete it. */
  required: Requirement[];
  eitherOf: Requirement[];
  /** The closer of the two either-or paths. */
  bestPath: Requirement["key"] | null;
  progress: number;
  etaDays: number | null;
}

/** Recent daily growth of one metric from the history, using up to the last 14 days. */
export function dailyPace(history: StatsPoint[], field: "subs" | "hours" | "shorts", now: Date): number | null {
  const points = history.filter((p) => p[field] !== null && now.getTime() - new Date(p.at).getTime() <= 15 * 86_400_000);
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const days = (new Date(last.at).getTime() - new Date(first.at).getTime()) / 86_400_000;
  if (days < 0.9) return null;
  return (last[field]! - first[field]!) / days;
}

function requirement(key: Requirement["key"], label: string, current: number | null, target: number, pace: number | null): Requirement {
  const progress = current === null ? 0 : Math.min(1, current / target);
  const remaining = current === null ? null : Math.max(0, target - current);
  const etaDays = remaining === 0 ? 0 : remaining !== null && pace && pace > 0 ? Math.ceil(remaining / pace) : null;
  return { key, label, current, target, progress, etaDays };
}

export function monetizationProgress(
  channel: Pick<Channel, "subscriberCount" | "watchHours12m" | "shortsViews90d" | "statsHistory">,
  uploads90d: number,
  now: Date = new Date(),
): TierProgress[] {
  const history = (channel.statsHistory as unknown as StatsPoint[] | null) ?? [];
  const pace = { subs: dailyPace(history, "subs", now), hours: dailyPace(history, "hours", now), shorts: dailyPace(history, "shorts", now) };
  return (Object.keys(TIERS) as TierKey[]).map((key) => {
    const tier = TIERS[key];
    const required = [requirement("subs", "Subscribers", channel.subscriberCount, tier.subs, pace.subs)];
    if (tier.uploads90d) required.push(requirement("uploads", "Uploads, 90 days", uploads90d, tier.uploads90d, null));
    const eitherOf = [
      requirement("hours", "Watch hours, 12 months", channel.watchHours12m, tier.hours, pace.hours),
      requirement("shorts", "Shorts views, 90 days", channel.shortsViews90d, tier.shortsViews, pace.shorts),
    ];
    const best = [...eitherOf].sort((a, b) => b.progress - a.progress)[0];
    const parts = [...required, best];
    const eligible = parts.every((r) => r.progress >= 1);
    const etas = parts.map((r) => r.etaDays);
    return {
      key,
      label: tier.label,
      eligible,
      required,
      eitherOf,
      bestPath: best.current === null ? null : best.key,
      progress: parts.reduce((sum, r) => sum + r.progress, 0) / parts.length,
      etaDays: eligible ? 0 : etas.some((e) => e === null) ? null : Math.max(...(etas as number[])),
    };
  });
}

/** A short plain-text summary for the mastermind's prompt. */
export function describeProgress(tiers: TierProgress[]): string {
  return tiers
    .map((t) => {
      const parts = [...t.required, ...t.eitherOf].map((r) => `${r.label}: ${r.current ?? "unknown"} / ${r.target}`);
      return `${t.label}${t.eligible ? " (ELIGIBLE)" : ""}: ${parts.join("; ")}`;
    })
    .join("\n");
}
