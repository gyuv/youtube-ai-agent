import type { GrowthGoal } from "@/generated/prisma/enums";

/**
 * What each growth goal changes in topics and scripts. These are craft choices that YouTube
 * rewards; none of them misleads viewers, since misleading packaging and repetitive content are
 * exactly what gets a channel refused for monetization.
 */
export const GOAL_LABEL: Record<GrowthGoal, string> = {
  SUBSCRIBERS: "Grow subscribers",
  VIEWS: "Maximise views",
  BALANCED: "Balanced",
};

export const GOAL_TOPIC_BRIEF: Record<GrowthGoal, string> = {
  SUBSCRIBERS:
    "Growth goal: SUBSCRIBERS. Prefer topics that belong to a recognisable series or format the channel can repeat, " +
    "that promise ongoing value (part 1 of N, a weekly challenge, a collection people want to complete), and that make " +
    "the channel's identity obvious. A viewer should finish wanting the next one.",
  VIEWS:
    "Growth goal: VIEWS. Prefer topics with proven search and browse demand right now: questions people type, " +
    "comparisons, surprising results, timely angles inside the niche. The title idea must earn a click on its own.",
  BALANCED: "Growth goal: balanced. Mix proven-demand topics with series-able ones that build a returning audience.",
};

export const GOAL_SCRIPT_BRIEF: Record<GrowthGoal, string> = {
  SUBSCRIBERS:
    "Growth goal: SUBSCRIBERS. Open with a hook in the first sentence, deliver the promised value fast, and seed an open " +
    "loop that the NEXT video on the channel pays off. End with a specific reason to subscribe tied to what comes next " +
    "(not a generic 'like and subscribe'). Keep a consistent persona and recurring phrases so the channel feels like a show.",
  VIEWS:
    "Growth goal: VIEWS. The first two seconds must stop the scroll: a bold claim, a question or a visual payoff, no greeting. " +
    "Keep every beat tight, with a pattern interrupt every few seconds. For Shorts, make the last line flow back into the " +
    "first so the video loops. End on the payoff, not on a call to action.",
  BALANCED:
    "Growth goal: balanced. Hook in the first sentence, keep the pacing tight, and close with one short, specific reason to subscribe.",
};

/** The goal brief plus the mastermind's current strategy, for the prompts. */
export function growthBrief(kind: "topic" | "script", goal: GrowthGoal | null | undefined, strategy: string | null | undefined): string {
  const brief = (kind === "topic" ? GOAL_TOPIC_BRIEF : GOAL_SCRIPT_BRIEF)[goal ?? "BALANCED"];
  return [brief, strategy?.trim() ? `Current growth strategy from the channel's Growth Lab (follow it):\n${strategy.trim()}` : ""].filter(Boolean).join("\n");
}
