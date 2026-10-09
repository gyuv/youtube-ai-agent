"use client";

import { Brain, Eye, LoaderCircle, Scale, UserPlus } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setGrowthGoalAction, setMastermindAction } from "@/app/(studio)/growth-lab/actions";
import { cn } from "@/lib/utils";

const GOALS = [
  { key: "SUBSCRIBERS", label: "Subscribers", icon: UserPlus, hint: "Series, a recognisable identity, and a real reason to subscribe at the end of every video." },
  { key: "VIEWS", label: "Views", icon: Eye, hint: "Search and browse demand, scroll-stopping first seconds, and Shorts that loop." },
  { key: "BALANCED", label: "Balanced", icon: Scale, hint: "Proven-demand topics mixed with series that bring viewers back." },
] as const;

/** Per channel: what to optimise for, and whether the Growth Lab mastermind is in charge. */
export function GoalPicker({ channelId, goal, mastermind }: { channelId: string; goal: string; mastermind: boolean }) {
  const [state, setState] = useOptimistic({ goal, mastermind });
  const [pending, start] = useTransition();

  const pick = (next: string) =>
    start(async () => {
      setState({ ...state, goal: next });
      const result = await setGrowthGoalAction(channelId, next);
      if (!result.ok) toast.error(result.error);
    });
  const toggle = () =>
    start(async () => {
      setState({ ...state, mastermind: !state.mastermind });
      const result = await setMastermindAction(channelId, !state.mastermind);
      if (!result.ok) toast.error(result.error);
      else toast.success(!state.mastermind ? "Growth Lab mastermind is in charge of this channel." : "Mastermind paused on this channel.");
    });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Growth goal">
        {GOALS.map(({ key, label, icon: Icon, hint }) => {
          const active = state.goal === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => !active && pick(key)}
              disabled={pending}
              className={cn(
                "glow-edge rounded-2xl border p-3 text-left transition-all",
                active ? "border-primary/60 bg-primary/10 shadow-[0_0_28px_-10px_oklch(0.62_0.24_310/80%)]" : "bg-white/[0.02] hover:bg-white/[0.05]",
              )}
              data-active={active}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={cn("grid size-7 place-items-center rounded-lg", active ? "bg-brand text-white" : "bg-white/5 text-muted-foreground")}>
                  <Icon className="size-3.5" />
                </span>
                {label}
              </span>
              <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={state.mastermind}
        className={cn("flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors", state.mastermind ? "border-primary/40 bg-primary/[0.07]" : "bg-white/[0.02]")}
      >
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", state.mastermind ? "bg-brand text-white" : "bg-white/5 text-muted-foreground")}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Brain className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Growth Lab mastermind {state.mastermind ? "is in charge" : "is paused"}</span>
          <span className="block text-xs text-muted-foreground">
            Every 6 hours, with or without the autopilot: rewrites strategy, retitles, rescripts or replaces upcoming videos, queues topics, and asks
            you only for what it can&apos;t do itself.
          </span>
        </span>
        <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", state.mastermind ? "bg-primary" : "bg-white/15")} aria-hidden>
          <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", state.mastermind ? "left-[18px]" : "left-0.5")} />
        </span>
      </button>
    </div>
  );
}
