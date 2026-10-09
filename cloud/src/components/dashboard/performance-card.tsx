import { Heart, TrendingUp, Trophy } from "lucide-react";
import Link from "next/link";
import { compactNumber } from "./types";

export interface ChannelPerformance {
  channelId: string;
  name: string;
  views30d: number;
  likes30d: number;
  videos30d: number;
  series: number[];
  top: { id: string; title: string; views: number } | null;
}

/** Views per upload, oldest to newest, as a filled sparkline. */
function Sparkline({ values, id }: { values: number[]; id: string }) {
  const w = 220;
  const h = 48;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [values.length > 1 ? i * step : w / 2, h - 4 - (v / max) * (h - 10)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full" preserveAspectRatio="none" role="img" aria-label={`Views on the last ${values.length} uploads`}>
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-2)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--brand-2)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`line-${id}`} x1="0" x2="1">
          <stop offset="0%" stopColor="var(--brand-1)" />
          <stop offset="100%" stopColor="var(--brand-3)" />
        </linearGradient>
      </defs>
      {values.length > 1 ? <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#fill-${id})`} /> : null}
      <path d={line} fill="none" stroke={`url(#line-${id})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {last ? <circle cx={last[0]} cy={last[1]} r="3" fill="var(--brand-3)" /> : null}
    </svg>
  );
}

export function PerformanceCard({ channels }: { channels: ChannelPerformance[] }) {
  return (
    <section aria-label="Performance" className="glass animate-rise rounded-3xl border p-5">
      <h2 className="flex items-center gap-2 font-semibold tracking-tight">
        <TrendingUp className="size-4 text-brand-3" /> Performance
        <span className="ml-auto text-[11px] font-normal text-muted-foreground">last 30 days</span>
      </h2>
      {channels.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Views appear here once videos are live; the autopilot refreshes YouTube stats daily.</p>
      ) : (
        <ul className="mt-4 grid gap-5">
          {channels.map((c) => (
            <li key={c.channelId}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-muted-foreground">{c.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                  <Heart className="size-3" /> {compactNumber.format(c.likes30d)}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-gradient text-3xl font-semibold tracking-tight tabular-nums">{compactNumber.format(c.views30d)}</span>
                <span className="text-xs text-muted-foreground">
                  views · {c.videos30d} video{c.videos30d === 1 ? "" : "s"}
                </span>
              </div>
              <Sparkline values={c.series} id={c.channelId} />
              {c.top ? (
                <Link href={`/projects/${c.top.id}`} className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <Trophy className="size-3 shrink-0 text-amber-300" />
                  <span className="truncate">{c.top.title}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{compactNumber.format(c.top.views)}</span>
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
