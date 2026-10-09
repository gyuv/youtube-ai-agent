import { Brain, ChevronRight, Inbox, Sparkles } from "lucide-react";
import Link from "next/link";
import { timeAgo } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { GOAL_LABEL } from "@/services/growthGoal";
import { openRequests } from "@/services/mastermind";
import { monetizationProgress } from "@/services/monetization";
import { RequestsInbox } from "./requests-inbox";
import { RunMastermindButton } from "./run-mastermind-button";

/** Top of the Growth Lab: the mastermind's view of every channel, its decisions, and what it needs. */
export async function MastermindHub() {
  const now = new Date();
  const ninety = new Date(now.getTime() - 90 * 86_400_000);
  const [channels, reports, requests, uploads] = await Promise.all([
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } }),
    prisma.labReport.findMany({ where: { toolId: "mastermind" }, orderBy: { createdAt: "desc" }, take: 8, include: { channel: { select: { name: true } } } }),
    openRequests(),
    prisma.videoProject.groupBy({ by: ["channelId"], where: { status: "PUBLISHED", publishedAt: { gte: ninety } }, _count: { _all: true } }),
  ]);
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
          <RequestsInbox showChannel requests={requests.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, channelName: r.channel.name, ago: timeAgo(r.createdAt, now) }))} />
        </div>
      </div>
    </section>
  );
}
