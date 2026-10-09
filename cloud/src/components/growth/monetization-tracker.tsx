import { BadgeDollarSign, CheckCircle2, Clock, Link2 } from "lucide-react";
import type { TierProgress } from "@/services/monetization";
import { cn } from "@/lib/utils";

const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function eta(days: number | null): string {
  if (days === null) return "pace unknown";
  if (days === 0) return "reached";
  if (days < 45) return `~${days} days at this pace`;
  return `~${Math.round(days / 30)} months at this pace`;
}

/** A ring per tier, and a bar per requirement. */
export function MonetizationTracker({
  tiers,
  analytics,
  connected,
  updatedLabel,
}: {
  tiers: TierProgress[];
  analytics: boolean;
  connected: boolean;
  updatedLabel: string | null;
}) {
  if (!connected) {
    return (
      <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        <Link2 className="mr-1 inline size-3.5" /> Connect YouTube above to track subscribers, watch hours and Shorts views toward monetization.
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {tiers.map((tier) => {
          const pct = Math.round(tier.progress * 100);
          const r = 34;
          const c = 2 * Math.PI * r;
          return (
            <div key={tier.key} className={cn("rounded-2xl border p-4", tier.eligible ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "bg-white/[0.02]")}>
              <div className="flex items-center gap-4">
                <svg viewBox="0 0 80 80" className="size-20 shrink-0 -rotate-90" role="img" aria-label={`${tier.label}: ${pct}%`}>
                  <defs>
                    <linearGradient id={`ring-${tier.key}`} x1="0" x2="1" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand-1)" />
                      <stop offset="60%" stopColor="var(--brand-2)" />
                      <stop offset="100%" stopColor="var(--brand-3)" />
                    </linearGradient>
                  </defs>
                  <circle cx="40" cy="40" r={r} fill="none" stroke="oklch(1 0 0 / 8%)" strokeWidth="7" />
                  <circle
                    cx="40"
                    cy="40"
                    r={r}
                    fill="none"
                    stroke={tier.eligible ? "oklch(0.75 0.17 155)" : `url(#ring-${tier.key})`}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={`${(c * pct) / 100} ${c}`}
                  />
                  <text x="40" y="44" textAnchor="middle" className="fill-foreground text-[15px] font-semibold" transform="rotate(90 40 40)">
                    {pct}%
                  </text>
                </svg>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold">
                    {tier.eligible ? <CheckCircle2 className="size-4 text-emerald-400" /> : <BadgeDollarSign className="size-4 text-brand-3" />}
                    {tier.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tier.eligible ? "Eligible: apply in YouTube Studio → Earn." : (
                      <>
                        <Clock className="mr-1 inline size-3" />
                        {eta(tier.etaDays)}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <ul className="mt-4 grid gap-2.5">
                {tier.required.map((req) => (
                  <Bar key={req.key} req={req} />
                ))}
                <li className="pt-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">and either</li>
                {tier.eitherOf.map((req) => (
                  <Bar key={req.key} req={req} dim={tier.bestPath !== null && tier.bestPath !== req.key} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {analytics
          ? `Watch hours exclude the Shorts feed, as YouTube counts them. ${updatedLabel ? `Updated ${updatedLabel}.` : ""}`
          : "Watch hours and Shorts views need YouTube Analytics access: disconnect and reconnect YouTube above to grant it. Subscribers are tracked already."}
      </p>
    </div>
  );
}

function Bar({ req, dim }: { req: TierProgress["required"][number]; dim?: boolean }) {
  return (
    <li className={cn(dim && "opacity-50")}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{req.label}</span>
        <span className="tabular-nums">
          <span className="font-medium">{req.current === null ? "?" : fmt.format(req.current)}</span>
          <span className="text-muted-foreground"> / {fmt.format(req.target)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn("h-full rounded-full", req.progress >= 1 ? "bg-emerald-400" : "bg-brand")} style={{ width: `${Math.max(2, req.progress * 100)}%` }} />
      </div>
    </li>
  );
}
