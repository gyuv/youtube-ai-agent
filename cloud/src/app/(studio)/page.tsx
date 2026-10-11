import { Clapperboard, Cog, Youtube } from "lucide-react";
import Link from "next/link";
import { AutomationSwitch } from "@/components/automation-switch";
import { AutopilotPanel } from "@/components/autopilot-panel";
import { NowStrip } from "@/components/dashboard/now-strip";
import { PerformanceCard } from "@/components/dashboard/performance-card";
import { PipelineBoard } from "@/components/dashboard/pipeline-board";
import type { VideoCard, WeekEntry } from "@/components/dashboard/types";
import { WeekBoard } from "@/components/dashboard/week-board";
import { timeAgo } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { ProjectStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { isFullyAutomated } from "@/services/channels";
import { getDashboard } from "@/services/dashboard";
import { formatSlot, isValidCron, nextPostingTimes } from "@/services/schedule";

export const dynamic = "force-dynamic";

function greeting(timeZone: string, now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const now = new Date();
  const data = await getDashboard(now);
  if (data.channels.length === 0) return <Onboarding />;

  const homeZone = data.channels[0].postingTimezone;
  const videos: VideoCard[] = data.projects.map((p) => ({
    id: p.id,
    title: p.title ?? p.topic,
    topic: p.topic,
    status: p.status,
    format: p.format,
    channelId: p.channelId,
    channelName: p.channelName,
    timeZone: p.timeZone,
    thumbnail: p.thumbnail,
    renderedVideoUrl: p.renderedVideoUrl,
    youtubeVideoId: p.youtubeVideoId,
    scheduledFor: p.scheduledFor?.toISOString() ?? null,
    slotLabel: p.scheduledFor ? formatSlot(p.scheduledFor, p.timeZone) : null,
    goesLiveAt: p.goesLiveAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
    updatedAgo: timeAgo(p.updatedAt, now),
    autopilot: p.autopilot,
    missedSlot: p.missedSlot,
    youtubeLocked: p.youtubeLocked,
    lastError: p.lastError,
    scenesReady: p.scenesReady,
    sceneCount: p.sceneCount,
    viewCount: p.viewCount,
  }));

  const week: WeekEntry[] = data.schedule.map((e) => {
    const tz = e.channel.postingTimezone;
    return {
      key: `${e.channel.id}-${e.at.toISOString()}-${e.project?.id ?? "open"}`,
      at: e.at.toISOString(),
      day: new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(e.at),
      time: new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(e.at),
      channelId: e.channel.id,
      channelName: e.channel.name,
      project: e.project
        ? {
            id: e.project.id,
            title: e.project.title ?? e.project.topic,
            status: e.project.status,
            thumbnail: data.scheduleThumbs[e.project.id] ?? null,
            locked: Boolean(e.project.youtubeLocked),
            movable: e.project.status !== ProjectStatus.PUBLISHED,
          }
        : null,
    };
  });

  const next = data.now.nextLive;
  return (
    <div className="grid grid-cols-1 gap-6 [&>*]:min-w-0">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{greeting(homeZone, now)}</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">Mission </span>
            <span className="text-gradient">control</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill label="In production" value={data.stats.inProgress + data.stats.rendering} />
          <Pill label="Scheduled on YouTube" value={data.stats.scheduledOnYouTube} />
          <Pill label="Live, 30 days" value={data.stats.publishedThisMonth} icon={<Youtube className="size-3.5 text-red-400" />} />
          <Pill label="Spent" text="$0.00" />
        </div>
      </header>

      <NowStrip
        data={{
          rendering: data.now.rendering.map((r) => ({ ...r, since: r.since.toISOString() })),
          nextLive: next ? { id: next.id, title: next.title, at: next.at.toISOString(), atLabel: formatSlot(next.at, homeZone), thumbnail: next.thumbnail } : null,
          missed: data.stats.overdue,
          attention: data.stats.needsAttention,
          asks: data.stats.mastermindAsks,
        }}
      />

      <WeekBoard entries={week} />

      <PipelineBoard videos={videos} channels={data.channels.map((c) => ({ id: c.id, name: c.name }))} initialFilter={params.view ?? "all"} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <PerformanceCard channels={data.performance} />
        <AutopilotPanel
          channelsOn={data.autopilot.channelsOn}
          channels={data.channels.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, autopilot: c.autopilot }))}
          events={data.autopilot.events.map((e) => ({ id: e.id, action: e.action, level: e.level, message: e.message, projectId: e.projectId, ago: timeAgo(e.createdAt, now) }))}
        />
        <AutomationSwitch
          channels={data.channels.map((c) => {
            const at = c.postingCron && isValidCron(c.postingCron) ? nextPostingTimes(c.postingCron, c.postingTimezone, 1)[0] : null;
            return {
              id: c.id,
              name: c.name,
              on: isFullyAutomated(c),
              youtubeConnected: Boolean(c.oauthRefreshTokenEnc),
              schedule: at ? `on schedule, next ${formatSlot(at, c.postingTimezone)}` : null,
            };
          })}
        />
      </div>
    </div>
  );
}

function Pill({ label, value, text, icon }: { label: string; value?: number; text?: string; icon?: React.ReactNode }) {
  return (
    <span className="glass inline-flex items-center gap-2 rounded-full border px-3 py-1.5">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", text ? "text-emerald-300" : "text-foreground")}>{text ?? value}</span>
    </span>
  );
}

function Onboarding() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <span className="bg-brand mx-auto grid size-14 animate-rise place-items-center rounded-2xl text-white shadow-[0_0_48px_-6px_oklch(0.62_0.24_310/80%)]">
        <Clapperboard className="size-7" />
      </span>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">
        Set up your <span className="text-gradient">first channel</span>
      </h1>
      <p className="mt-2 text-muted-foreground">
        A channel holds your niche, voice, visual style and posting schedule. Every video you make starts from it.
      </p>
      <Link href="/channels/new" className={cn(buttonVariants(), "mt-6")}>
        <Cog />
        Create a channel
      </Link>
    </div>
  );
}
