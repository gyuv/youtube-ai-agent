import { AlertTriangle, Bot, CalendarClock, Clapperboard, Cog, Lock, Plus, Radio, Youtube } from "lucide-react";
import Link from "next/link";
import { AutopilotPanel } from "@/components/autopilot-panel";
import { PageHeader, timeAgo } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { ACTIVE_STATUSES, getDashboard, type DashboardData } from "@/services/dashboard";
import { formatSlot } from "@/services/schedule";

export const dynamic = "force-dynamic";

type Row = DashboardData["projects"][number];
const VIEWS = {
  active: { label: "In pipeline", match: (p: Row) => ACTIVE_STATUSES.includes(p.status) },
  attention: { label: "Needs attention", match: (p: Row) => p.status === ProjectStatus.FAILED || p.youtubeLocked },
  published: { label: "Published", match: (p: Row) => p.status === ProjectStatus.PUBLISHED },
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
      <PageHeader title="Dashboard" description="Every stage runs on free cloud services. Spend to date: $0.00." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Clapperboard />} label="In progress" value={data.stats.inProgress} href="/?view=active" />
        <Stat icon={<Radio />} label="Rendering" value={data.stats.rendering} href="/?view=active" live={data.stats.rendering > 0} />
        <Stat icon={<AlertTriangle />} label="Needs attention" value={data.stats.needsAttention} href="/?view=attention" warn={data.stats.needsAttention > 0} />
        <Stat icon={<Youtube />} label="Published, 30 days" value={data.stats.publishedThisMonth} href="/?view=published" />
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
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    key === view ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {VIEWS[key].label}
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
                    <TableHead className="hidden pr-5 text-right sm:table-cell">Updated</TableHead>
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
          <AutopilotPanel
            channelsOn={data.autopilot.channelsOn}
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
    <Link href={href} className="group rounded-xl border bg-card p-4 transition-colors hover:border-ring/60">
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4", warn && "text-red-500 dark:text-red-400")}>
        {icon}
        {label}
        {live ? <span className="ml-auto size-2 animate-pulse rounded-full bg-amber-400" aria-label="live" /> : null}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
    </Link>
  );
}

function ProjectRow({ project }: { project: Row }) {
  const ratio = project.sceneCount ? project.scenesReady / project.sceneCount : 0;
  return (
    <TableRow className="relative">
      {/* w-full + max-w-0 lets the title column take the spare width and truncate within it. */}
      <TableCell className="w-full max-w-0 min-w-32 pl-5">
        <Link href={`/projects/${project.id}`} className="block truncate font-medium after:absolute after:inset-0">
          {project.title ?? project.topic}
        </Link>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {project.autopilot ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border px-1 text-[10px] font-medium text-foreground" title="Created by the autopilot">
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
          <StatusBadge status={project.status} />
          {project.youtubeLocked ? (
            <span className="text-amber-600 dark:text-amber-300" title="YouTube kept this video private">
              <Lock className="size-3.5" aria-label="Locked private on YouTube" />
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
              <div className={cn("h-full rounded-full", ratio === 1 ? "bg-emerald-500" : "bg-sky-500")} style={{ width: `${ratio * 100}%` }} />
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
      <TableCell className="hidden pr-5 text-right text-xs whitespace-nowrap text-muted-foreground sm:table-cell">{timeAgo(project.updatedAt)}</TableCell>
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
                  <li key={`${entry.channel.id}-${entry.at.toISOString()}-${entry.project?.id ?? "open"}`} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
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
                    {entry.project ? <StatusBadge status={entry.project.status} /> : <Plus className="size-4 text-muted-foreground" />}
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
      <span className="mx-auto grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Clapperboard className="size-6" />
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Set up your first channel</h1>
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
