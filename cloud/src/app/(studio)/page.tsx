import { AlertTriangle, Bot, CalendarClock, CalendarX2, Clapperboard, Cog, FileText, Film, ImageIcon, Lightbulb, Radio, Upload, Youtube } from "lucide-react";
import Link from "next/link";
import { AutomationSwitch } from "@/components/automation-switch";
import { AutopilotPanel } from "@/components/autopilot-panel";
import { MakeSlotButton } from "@/components/make-slot-button";
import { RescheduleButton } from "@/components/reschedule-button";
import { PageHeader, timeAgo } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { isFullyAutomated } from "@/services/channels";
import { ACTIVE_STATUSES, getDashboard, type DashboardData } from "@/services/dashboard";
import { formatSlot, isValidCron, nextPostingTimes } from "@/services/schedule";

export const dynamic = "force-dynamic";

type Row = DashboardData["projects"][number];
const VIEWS = {
  active: { label: "In pipeline", match: (p: Row) => ACTIVE_STATUSES.includes(p.status) },
  attention: { label: "Needs attention", match: (p: Row) => p.status === ProjectStatus.FAILED || p.youtubeLocked },
  missed: { label: "Missed slot", match: (p: Row) => p.missedSlot },
  scheduled: { label: "Scheduled on YouTube", match: (p: Row) => Boolean(p.goesLiveAt) },
  published: { label: "Live", match: (p: Row) => p.status === ProjectStatus.PUBLISHED && !p.goesLiveAt && !p.youtubeLocked },
  all: { label: "All", match: () => true },
} as const;
type View = keyof typeof VIEWS;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : "active";
  const data = await getDashboard();

  if (data.channels.length === 0) return <Onboarding />;

  const projects = data.projects.filter((p) => VIEWS[view].match(p));
  return (
    <>
      <PageHeader
        title="Mission control"
        description={
          <>
            Every stage runs on free cloud services. Spend to date: <span className="font-medium text-emerald-300">$0.00</span>.
          </>
        }
      />

      <PipelineStrip stages={data.stages} />

      {data.stats.overdue > 0 ? (
        <Link
          href="/?view=missed"
          className="glass glow-edge mt-6 flex animate-rise items-center gap-3 rounded-2xl border border-amber-500/25 px-4 py-3 text-sm transition-colors hover:border-amber-400/50"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-300">
            <CalendarX2 className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-medium text-amber-200">
              {data.stats.overdue} video{data.stats.overdue === 1 ? "" : "s"} missed {data.stats.overdue === 1 ? "its" : "their"} posting slot.
            </span>{" "}
            <span className="text-muted-foreground">
              The autopilot moves {data.stats.overdue === 1 ? "it" : "them"} to the next free slot and reuses the existing files; open the list to move {data.stats.overdue === 1 ? "it" : "one"} now.
            </span>
          </span>
          <span className="hidden shrink-0 text-xs text-amber-300 sm:inline">Review →</span>
        </Link>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Clapperboard />} label="In progress" value={data.stats.inProgress} href="/?view=active" />
        <Stat icon={<Radio />} label="Rendering" value={data.stats.rendering} href="/?view=active" live={data.stats.rendering > 0} />
        <Stat icon={<AlertTriangle />} label="Needs attention" value={data.stats.needsAttention} href="/?view=attention" warn={data.stats.needsAttention > 0} />
        <Stat
          icon={<Youtube />}
          label={data.stats.scheduledOnYouTube ? `Live, 30 days · ${data.stats.scheduledOnYouTube} scheduled` : "Live on YouTube, 30 days"}
          value={data.stats.publishedThisMonth}
          href={data.stats.scheduledOnYouTube ? "/?view=scheduled" : "/?view=published"}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 gap-0 py-0">
          <CardHeader className="flex-wrap items-center py-4">
            <CardTitle>Pipelines</CardTitle>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter projects">
              {(Object.keys(VIEWS) as View[]).map((key) => (
                <Link
                  key={key}
                  href={`/?view=${key}`}
                  role="tab"
                  aria-selected={key === view}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-all",
                    key === view
                      ? "bg-white/[0.08] font-medium text-foreground shadow-[0_0_0_1px_oklch(0.7_0.21_292/35%)]"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                  )}
                >
                  {VIEWS[key].label}
                  {key === "missed" && data.stats.overdue > 0 ? <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300 tabular-nums">{data.stats.overdue}</span> : null}
                </Link>
              ))}
            </div>
          </CardHeader>
          {projects.length === 0 ? (
            <div className="border-t px-5 py-12 text-center text-sm text-muted-foreground">
              Nothing here yet.{" "}
              <Link href="/projects/new" className="text-foreground underline underline-offset-4">
                Start a new video
              </Link>
            </div>
          ) : (
            <div className="border-t">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Video</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scenes</TableHead>
                    <TableHead className="hidden md:table-cell">Posts</TableHead>
                    <TableHead className="hidden pr-5 text-right sm:table-cell">{view === "missed" ? "" : "Updated"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => (
                    <ProjectRow key={p.id} project={p} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <AutomationSwitch
            channels={data.channels.map((c) => {
              const next = c.postingCron && isValidCron(c.postingCron) ? nextPostingTimes(c.postingCron, c.postingTimezone, 1)[0] : null;
              return {
                id: c.id,
                name: c.name,
                on: isFullyAutomated(c),
                youtubeConnected: Boolean(c.oauthRefreshTokenEnc),
                schedule: next ? `on schedule, next ${formatSlot(next, c.postingTimezone)}` : null,
              };
            })}
          />
          <AutopilotPanel
            channelsOn={data.autopilot.channelsOn}
            channels={data.channels.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, autopilot: c.autopilot }))}
            events={data.autopilot.events.map((e) => ({ id: e.id, action: e.action, level: e.level, message: e.message, projectId: e.projectId, ago: timeAgo(e.createdAt) }))}
          />
          <ScheduleCard schedule={data.schedule} />
        </div>
      </div>
    </>
  );
}

function Stat({ icon, label, value, href, live, warn }: { icon: React.ReactNode; label: string; value: number; href: string; live?: boolean; warn?: boolean }) {
  return (
    <Link href={href} className="glass glow-edge group animate-rise rounded-2xl border p-4 transition-transform duration-300 hover:-translate-y-0.5">
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", warn && "text-red-300")}>
        <span
          className={cn(
            "grid size-7 place-items-center rounded-lg bg-white/5 text-foreground/80 transition-colors group-hover:bg-primary/20 group-hover:text-white [&_svg]:size-3.5",
            warn && "bg-red-500/15 text-red-300",
          )}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
        {live ? <span className="ml-auto size-2 shrink-0 animate-pulse rounded-full bg-amber-400 shadow-[0_0_10px_oklch(0.8_0.15_75)]" aria-label="live" /> : null}
      </div>
      <div className={cn("mt-3 text-4xl font-semibold tracking-tight tabular-nums", value > 0 && !warn ? "text-gradient" : warn && value > 0 ? "text-red-300" : "text-foreground/70")}>{value}</div>
    </Link>
  );
}

const STAGES = [
  { key: "planned", label: "Planned", icon: Lightbulb, view: "active" },
  { key: "scripted", label: "Scripted", icon: FileText, view: "active" },
  { key: "assets", label: "Voice & visuals", icon: ImageIcon, view: "active" },
  { key: "rendering", label: "Rendering", icon: Film, view: "active" },
  { key: "rendered", label: "Rendered", icon: Upload, view: "active" },
  { key: "published", label: "On YouTube", icon: Youtube, view: "published" },
] as const;

/** The whole pipeline at a glance: how many videos sit at each stage, with the flow between them. */
function PipelineStrip({ stages }: { stages: DashboardData["stages"] }) {
  const max = Math.max(1, ...Object.values(stages));
  return (
    <section aria-label="Pipeline" className="glass relative animate-rise overflow-hidden rounded-2xl border p-2">
      <div className="pointer-events-none absolute inset-x-6 top-1/2 hidden h-px -translate-y-3 bg-gradient-to-r from-brand-1/0 via-brand-2/40 to-brand-3/0 md:block" aria-hidden>
        <div className="shimmer h-px w-full" />
      </div>
      <ol className="relative grid grid-cols-3 gap-2 md:grid-cols-6">
        {STAGES.map(({ key, label, icon: Icon, view }) => {
          const value = stages[key];
          return (
            <li key={key}>
              <Link href={`/?view=${view}`} className="group flex flex-col items-center gap-2 rounded-xl px-2 py-3 text-center transition-colors hover:bg-white/[0.04]">
                <span
                  className={cn(
                    "relative grid size-10 place-items-center rounded-2xl border bg-background/80 transition-all duration-300 group-hover:scale-110",
                    value > 0 ? "border-primary/40 text-white shadow-[0_0_24px_-6px_oklch(0.62_0.24_310/70%)]" : "text-muted-foreground",
                    key === "rendering" && value > 0 && "animate-pulse",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="text-xl font-semibold tabular-nums">{value}</span>
                <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</span>
                <span className="h-0.5 w-10 overflow-hidden rounded-full bg-white/5" aria-hidden>
                  <span className="bg-brand block h-full rounded-full" style={{ width: `${(value / max) * 100}%` }} />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ProjectRow({ project }: { project: Row }) {
  const ratio = project.sceneCount ? project.scenesReady / project.sceneCount : 0;
  return (
    <TableRow className="relative">
      {/* w-full + max-w-0 lets the title column take the spare width and truncate within it. */}
      <TableCell className="w-full max-w-0 min-w-40 pl-5">
        <Link href={`/projects/${project.id}`} className="line-clamp-2 font-medium break-words after:absolute after:inset-0">
          {project.title ?? project.topic}
        </Link>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {project.missedSlot ? (
            <span className="order-last basis-full sm:hidden">
              <RescheduleButton projectId={project.id} className="h-6 px-2 text-[11px]" />
            </span>
          ) : null}
          {project.autopilot ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 text-[10px] font-medium text-violet-200" title="Created by the autopilot">
              <Bot className="size-3" /> Auto
            </span>
          ) : null}
          <span className="truncate">
            {project.channelName} · {project.format === "SHORT" ? "Short 9:16" : "Long-form 16:9"}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={project.status} goesLiveAt={project.goesLiveAt} locked={project.youtubeLocked} timeZone={project.timeZone} />
          {project.missedSlot ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-300" title="Its posting slot passed before it reached YouTube">
              <CalendarX2 className="size-3" /> Missed slot
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {project.sceneCount === 0 ? (
          <span className="text-xs text-muted-foreground">No script</span>
        ) : (
          <div className="flex items-center gap-2" title={`${project.scenesReady} of ${project.sceneCount} scenes have voice and visual`}>
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", ratio === 1 ? "bg-emerald-400 shadow-[0_0_8px_oklch(0.75_0.17_155)]" : "bg-brand")} style={{ width: `${ratio * 100}%` }} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {project.scenesReady}/{project.sceneCount}
            </span>
          </div>
        )}
      </TableCell>
      <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground md:table-cell">
        {project.scheduledFor ? formatSlot(project.scheduledFor, project.timeZone) : "Not scheduled"}
      </TableCell>
      <TableCell className="hidden pr-5 text-right text-xs whitespace-nowrap text-muted-foreground sm:table-cell">
        {project.missedSlot ? <RescheduleButton projectId={project.id} /> : timeAgo(project.updatedAt)}
      </TableCell>
    </TableRow>
  );
}

const SCHEDULE_LIMIT = 12;

function ScheduleCard({ schedule }: { schedule: DashboardData["schedule"] }) {
  const days = new Map<string, DashboardData["schedule"]>();
  for (const entry of schedule.slice(0, SCHEDULE_LIMIT)) {
    const key = new Intl.DateTimeFormat("en-GB", { timeZone: entry.channel.postingTimezone, weekday: "long", day: "numeric", month: "short" }).format(entry.at);
    days.set(key, [...(days.get(key) ?? []), entry]);
  }

  return (
    <Card className="h-fit min-w-0 gap-4">
      <CardHeader>
        <div>
          <CardTitle>Next 7 days</CardTitle>
          <CardDescription className="mt-1.5">Posting slots from each channel&apos;s schedule</CardDescription>
        </div>
        <CalendarClock className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No upcoming slots.{" "}
            <Link href="/channels" className="text-foreground underline underline-offset-4">
              Set a posting schedule
            </Link>
          </p>
        ) : (
          [...days.entries()].map(([day, entries]) => (
            <div key={day} className="min-w-0">
              <div className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{day}</div>
              <ul className="grid grid-cols-1 gap-1.5">
                {entries.map((entry) => (
                  <li
                    key={`${entry.channel.id}-${entry.at.toISOString()}-${entry.project?.id ?? "open"}`}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors hover:border-primary/30",
                      entry.project ? "bg-white/[0.03]" : "border-dashed bg-transparent",
                    )}
                  >
                    <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {new Intl.DateTimeFormat("en-GB", { timeZone: entry.channel.postingTimezone, hour: "numeric", minute: "2-digit", hour12: true }).format(entry.at)}
                    </span>
                    <div className="min-w-0 flex-1">
                      {entry.project ? (
                        <Link href={`/projects/${entry.project.id}`} className="block truncate font-medium hover:underline">
                          {entry.project.title ?? entry.project.topic}
                        </Link>
                      ) : (
                        <Link href={`/projects/new?channelId=${entry.channel.id}&at=${encodeURIComponent(entry.at.toISOString())}`} className="block truncate text-muted-foreground hover:text-foreground">
                          Open slot · plan a video
                        </Link>
                      )}
                      <div className="truncate text-xs text-muted-foreground">{entry.channel.name}</div>
                    </div>
                    {entry.project ? (
                      <StatusBadge status={entry.project.status} goesLiveAt={entry.at} locked={entry.project.youtubeLocked} timeZone={entry.channel.postingTimezone} />
                    ) : (
                      <MakeSlotButton channelId={entry.channel.id} at={entry.at.toISOString()} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        {schedule.length > SCHEDULE_LIMIT ? (
          <p className="text-xs text-muted-foreground">
            and {schedule.length - SCHEDULE_LIMIT} more slot{schedule.length - SCHEDULE_LIMIT === 1 ? "" : "s"} this week
          </p>
        ) : null}
      </CardContent>
    </Card>
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
