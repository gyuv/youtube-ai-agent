import { Brain, ChevronRight, Inbox, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { timeAgo } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { GOAL_LABEL } from "@/services/growthGoal";
import { MASTERMIND_INTERVAL_MS, openRequests } from "@/services/mastermind";
import { officerStatus } from "@/services/officer";
import { monetizationProgress } from "@/services/monetization";
import { RequestsInbox } from "./requests-inbox";
import { RunMastermindButton } from "./run-mastermind-button";

/** Top of the Growth Lab: the mastermind's view of every channel, its decisions, and what it needs. */
export async function MastermindHub() {
  const now = new Date();
  const ninety = new Date(now.getTime() - 90 * 86_400_000);
  const [channels, reports, requests, uploads, officer, incidents] = await Promise.all([
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } }),
    prisma.labReport.findMany({ where: { toolId: "mastermind" }, orderBy: { createdAt: "desc" }, take: 8, include: { channel: { select: { name: true } } } }),
    openRequests(),
    prisma.videoProject.groupBy({ by: ["channelId"], where: { status: "PUBLISHED", publishedAt: { gte: ninety } }, _count: { _all: true } }),
    officerStatus(now),
    prisma.mastermindRequest.findMany({ where: { kind: { in: ["incident", "flow_worker"] }, status: "done" }, orderBy: { resolvedAt: "desc" }, take: 8, include: { channel: { select: { name: true } } } }),
  ]);
  // The autopilot (and so the officer) runs hourly; anything older means the GitHub schedule stopped.
  const onDuty = Boolean(officer.checkedAt && now.getTime() - officer.checkedAt.getTime() < 2 * 3_600_000);
  const uploadsBy = new Map(uploads.map((u) => [u.channelId, u._count._all]));

  return (
    <section aria-label="Growth Lab mastermind" className="mb-10 grid gap-6">
      <div className="glass glow-edge relative overflow-hidden rounded-3xl border p-5 sm:p-6" data-active>
        <div className="pointer-events-none absolute -top-32 -left-20 size-96 rounded-full bg-[radial-gradient(circle,oklch(0.6_0.22_292/28%),transparent_65%)]" aria-hidden />
        <div className="relative flex flex-wrap items-start gap-4">
          <span className="bg-brand grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-[0_0_40px_-6px_oklch(0.62_0.24_310/80%)]">
            <Brain className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight">
              The <span className="text-gradient">mastermind</span>
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Every 6 hours on each channel, with or without the autopilot, it reads subscribers, watch hours, Shorts views and every video&apos;s
              views, decides the strategy, and rewrites, retitles or replaces upcoming videos to reach monetization faster. It stays inside
              YouTube&apos;s policies, because breaking them is the fastest way to be refused monetization.
            </p>
          </div>
        </div>

        <div className={cn("relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border px-4 py-3 text-xs", onDuty ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-amber-500/30 bg-amber-500/[0.06]")}>
          <span className="flex items-center gap-2 font-medium">
            <ShieldCheck className={cn("size-4", onDuty ? "text-emerald-300" : "text-amber-300")} />
            {onDuty ? "Officer on duty" : "Officer hasn't checked in"}
          </span>
          <span className="text-muted-foreground">
            {officer.checkedAt ? `last check ${timeAgo(officer.checkedAt, now)}` : "first check on the next autopilot run"} · checks every hour · {officer.resolved24h} issue
            {officer.resolved24h === 1 ? "" : "s"} resolved in 24h · {officer.needsYou ? `${officer.needsYou} need${officer.needsYou === 1 ? "s" : ""} you` : "nothing needs you"}
          </span>
          {!onDuty ? <span className="text-amber-200">The hourly GitHub autopilot schedule may have stopped: run it from the Autopilot page.</span> : null}
        </div>

        <ul className="relative mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((c) => {
            const [, ads] = monetizationProgress(c, uploadsBy.get(c.id) ?? 0, now);
            const pct = Math.round(ads.progress * 100);
            return (
              <li key={c.id} className="rounded-2xl border bg-white/[0.03] p-4">
                <div className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", c.mastermind ? "animate-pulse bg-emerald-400 shadow-[0_0_8px_oklch(0.75_0.17_155)]" : "bg-white/20")} aria-hidden />
                  <Link href={`/channels/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">{GOAL_LABEL[c.growthGoal]}</span>
                </div>
                <div className="mt-3 flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">To ad revenue</span>
                  <span className="text-gradient text-lg font-semibold tabular-nums">{pct}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="bg-brand h-full rounded-full" style={{ width: `${Math.max(2, pct)}%` }} />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {c.subscriberCount ?? "?"} subscribers · {c.watchHours12m ?? "?"} watch hours ·{" "}
                  {c.mastermind ? (c.mastermindAt ? `planned ${timeAgo(c.mastermindAt, now)}` : "first plan on the next run") : "mastermind paused"}
                </p>
                <p className={cn("mt-1 text-[11px] font-medium", c.mastermind || c.autopilot ? "text-emerald-300" : "text-muted-foreground")}>
                  {c.mastermind || c.autopilot
                    ? `● Running · next plan ${c.mastermindAt ? (c.mastermindAt.getTime() + MASTERMIND_INTERVAL_MS <= now.getTime() ? "on the next hourly run" : `in ${Math.max(1, Math.round((c.mastermindAt.getTime() + MASTERMIND_INTERVAL_MS - now.getTime()) / 3_600_000))}h`) : "on the next hourly run"}${c.flowOnly ? " · Google Flow only" : ""}`
                    : "○ Paused"}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  {c.mastermind ? <RunMastermindButton channelId={c.id} /> : <span className="text-xs text-muted-foreground">Turn it on in the channel</span>}
                  <Link href={`/channels/${c.id}`} className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
                    Growth settings <ChevronRight className="size-3.5" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="glass rounded-3xl border p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-brand-1" /> Latest decisions
          </h3>
          {reports.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No decisions yet: the mastermind makes its first plan on the next autopilot run.</p>
          ) : (
            <ol className="mt-4 grid gap-4">
              {reports.map((r) => (
                <li key={r.id} className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {r.channel.name} · {timeAgo(r.createdAt, now)}
                  </p>
                  <p className="mt-1 text-sm">{r.summary}</p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Full plan</summary>
                    <div className="mt-2 rounded-xl border bg-white/[0.02] p-3 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">{r.markdown.replace(/^## /gm, "")}</div>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="glass rounded-3xl border p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold">
            <Inbox className="size-4 text-amber-300" /> Needs you
            {requests.length ? <span className="rounded-full bg-amber-500/20 px-2 text-xs text-amber-200">{requests.length}</span> : null}
          </h3>
          {incidents.length ? (
            <div className="mb-5">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                <ShieldCheck className="size-3.5" /> Resolved by the officer
              </p>
              <ul className="grid gap-2">
                {incidents.map((i) => (
                  <li key={i.id} className="rounded-xl border bg-white/[0.02] p-2.5 text-xs">
                    <p className="font-medium">{i.title}</p>
                    <p className="text-muted-foreground">
                      {i.channel.name} · {i.resolvedAt ? timeAgo(i.resolvedAt, now) : ""}
                    </p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What happened</summary>
                      <p className="mt-1 whitespace-pre-line text-muted-foreground">{i.body.replace(/^\[project:[^\]]+\]\n/, "")}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <RequestsInbox showChannel requests={requests.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, channelName: r.channel.name, ago: timeAgo(r.createdAt, now) }))} />
        </div>
      </div>
    </section>
  );
}
