"use client";

import { Brain, CalendarX2, Clapperboard, Radio, Rocket, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** A cloud render usually takes 3-4 minutes; past this the bar holds near full rather than lying. */
const TYPICAL_RENDER_MS = 4 * 60 * 1000;

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function countdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export interface NowData {
  rendering: { id: string; title: string; queued: boolean; since: string }[];
  nextLive: { id: string; title: string; at: string; atLabel: string; thumbnail: string | null } | null;
  missed: number;
  attention: number;
  asks: number;
}

/** The top of mission control: what is happening this minute, and what happens next. */
export function NowStrip({ data }: { data: NowData }) {
  const now = useNow();
  const calm = data.rendering.length === 0 && !data.nextLive && data.missed === 0 && data.attention === 0 && data.asks === 0;

  return (
    <section aria-label="Right now" className="grid animate-rise grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {/* Next go-live: the hero tile. */}
      <div className="glass glow-edge relative overflow-hidden rounded-3xl border p-5" data-active={Boolean(data.nextLive)}>
        <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(circle,oklch(0.65_0.24_320/30%),transparent_65%)]" aria-hidden />
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          <Rocket className="size-3.5 text-brand-2" /> Next to go live
        </div>
        {data.nextLive ? (
          <Link href={`/projects/${data.nextLive.id}`} className="group mt-3 flex items-center gap-4">
            <Thumb src={data.nextLive.thumbnail} className="h-20 w-14 sm:h-24 sm:w-16" />
            <div className="min-w-0 flex-1">
              <div className="text-gradient font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
                {countdown(new Date(data.nextLive.at).getTime() - now)}
              </div>
              <p className="mt-1 line-clamp-2 font-medium group-hover:underline">{data.nextLive.title}</p>
              <p className="text-xs text-muted-foreground">{data.nextLive.atLabel}</p>
            </div>
          </Link>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nothing scheduled yet. Open a slot in the week below to plan the next video.</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        {/* Renders in flight. */}
        <div className="glass rounded-3xl border p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            <Radio className={cn("size-3.5", data.rendering.length ? "animate-pulse text-amber-300" : "")} /> Rendering now
          </div>
          {data.rendering.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              <Clapperboard className="mr-1 inline size-3.5" /> The render farm is idle.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2.5">
              {data.rendering.slice(0, 3).map((r) => {
                const elapsed = now - new Date(r.since).getTime();
                const pct = r.queued ? 4 : Math.min(96, (elapsed / TYPICAL_RENDER_MS) * 100);
                return (
                  <li key={r.id}>
                    <Link href={`/projects/${r.id}`} className="flex items-baseline justify-between gap-3 text-sm hover:underline">
                      <span className="truncate">{r.title}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{r.queued ? "waiting for a runner" : countdown(elapsed)}</span>
                    </Link>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5" title="Estimated from elapsed time; renders usually take 3–4 minutes">
                      <div className="bg-brand relative h-full rounded-full transition-[width] duration-1000" style={{ width: `${pct}%` }}>
                        <div className="shimmer absolute inset-0" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Things that need a human. */}
        <div className="grid grid-cols-3 gap-3">
          <Link
            href="/?view=missed#board"
            className={cn("glass rounded-2xl border p-3 transition-colors hover:border-amber-400/40", data.missed > 0 && "border-amber-500/30 bg-amber-500/[0.06]")}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarX2 className={cn("size-3.5", data.missed > 0 && "text-amber-300")} /> Missed slots
            </div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", data.missed > 0 ? "text-amber-200" : "text-foreground/50")}>{data.missed}</div>
          </Link>
          <Link
            href="/?view=attention#board"
            className={cn("glass rounded-2xl border p-3 transition-colors hover:border-red-400/40", data.attention > 0 && "border-red-500/30 bg-red-500/[0.06]")}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TriangleAlert className={cn("size-3.5", data.attention > 0 && "text-red-300")} /> Need you
            </div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", data.attention > 0 ? "text-red-200" : "text-foreground/50")}>{data.attention}</div>
          </Link>
          <Link
            href="/growth-lab"
            className={cn("glass rounded-2xl border p-3 transition-colors hover:border-primary/40", data.asks > 0 && "border-primary/40 bg-primary/[0.08]")}
            title="Things the Growth Lab mastermind needs you to do"
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Brain className={cn("size-3.5", data.asks > 0 && "text-violet-300")} /> <span className="truncate">Mastermind asks</span>
            </div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", data.asks > 0 ? "text-violet-200" : "text-foreground/50")}>{data.asks}</div>
          </Link>
        </div>
      </div>
      {calm ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground lg:col-span-2">
          <Sparkles className="size-3.5 text-brand-1" /> All quiet. The autopilot checks in every 3 hours.
        </p>
      ) : null}
    </section>
  );
}

export function Thumb({ src, className }: { src: string | null; className?: string }) {
  return (
    <span className={cn("relative block shrink-0 overflow-hidden rounded-xl border bg-[linear-gradient(135deg,oklch(0.3_0.08_292),oklch(0.22_0.05_330))]", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote storage URLs; next/image would need every host whitelisted
        <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <Clapperboard className="absolute inset-0 m-auto size-4 text-white/30" />
      )}
    </span>
  );
}
