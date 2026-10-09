import { z } from "zod";
import type { Channel, Prisma } from "@/generated/prisma/client";
import { ProjectStatus } from "@/generated/prisma/enums";
import { errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { rankPerformance, type PerformanceRow } from "./analytics";
import { generateGeminiJson, parseJsonText, sanitizeSchema, type GeminiClient } from "./gemini";
import { GOAL_LABEL } from "./growthGoal";
import { addTopicsToBacklog } from "./labsAutomation";
import { CHANNEL_STATS_INTERVAL_MS, describeProgress, monetizationProgress, refreshMonetizationStats } from "./monetization";
import { generateProjectScript } from "./pipeline";

/**
 * The Growth Lab mastermind. Every few hours, per channel and whether or not the autopilot is on,
 * it reads the channel's numbers (subscribers, watch hours, Shorts views, views per video), the
 * monetization gap and every unpublished video, then decides on its own:
 *
 *  - the channel's growth strategy, which steers every new topic and script;
 *  - which upcoming videos to retitle, rescript, or replace with a stronger topic;
 *  - new topics for the backlog;
 *  - requests for the operator, only for what no API can do (profile picture, community posts)
 *    or what touches a live video.
 *
 * It only edits videos that aren't on YouTube yet and aren't rendering, never edits a scene the
 * operator locked, and works inside YouTube's policies: misleading packaging, fake engagement
 * and repetitive content are what get a channel refused for monetization, so they are off the
 * table however aggressive the strategy.
 */

export const MASTERMIND_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Rebuilding a video takes a while; leave ones this close to their slot alone (title changes aside). */
export const REBUILD_LEAD_MS = 4 * 60 * 60 * 1000;
const MAX_REBUILDS_PER_RUN = 2;
const MAX_CANDIDATES = 12;

const EDITABLE = [ProjectStatus.DRAFT, ProjectStatus.SCRIPTED, ProjectStatus.ASSETS_READY, ProjectStatus.RENDERED, ProjectStatus.FAILED];

const DecisionSchema = z.object({
  projectId: z.string(),
  action: z.enum(["keep", "retitle", "rescript", "retopic"]),
  reason: z.string().max(300),
  newTitle: z.string().max(100).optional(),
  newTopic: z.string().max(200).optional(),
});

const PlanSchema = z.object({
  strategy: z
    .string()
    .min(60)
    .max(1800)
    .describe("6-10 bullet lines starting with '- ': the channel's growth strategy right now. Concrete rules for topics, hooks, titles, thumbnails text, pacing, series and calls to action. Every future script follows it."),
  diagnosis: z.string().max(600).describe("Two or three sentences: what is holding the channel back from monetization and the single biggest lever."),
  decisions: z.array(DecisionSchema).max(MAX_CANDIDATES).describe("One entry per upcoming video you want to change. Omit videos you would keep."),
  backlog: z.array(z.string().min(8).max(200)).max(6).describe("New video topics, strongest first, phrased like a searcher would type them."),
  requests: z
    .array(
      z.object({
        kind: z.enum(["avatar", "banner", "community_post", "live_video", "collaboration", "other"]),
        title: z.string().max(120),
        body: z.string().max(1200).describe("Exactly what the operator should do and why it helps; include ready-to-paste text where relevant."),
      }),
    )
    .max(3)
    .describe("Only things the system cannot do itself: setting the profile picture, posting a community post, changing a video that is already live, or anything needing a human. Leave empty when nothing is needed."),
});
export type MastermindPlan = z.infer<typeof PlanSchema>;
const PLAN_JSON_SCHEMA = sanitizeSchema(z.toJSONSchema(PlanSchema));

export interface Candidate {
  id: string;
  title: string | null;
  topic: string;
  status: ProjectStatus;
  format: string;
  scheduledFor: Date | null;
  hook: string;
  lockedScenes: number;
}

export function buildMastermindPrompt(input: {
  channel: Pick<Channel, "name" | "niche" | "targetAudience" | "language" | "growthGoal" | "mastermindNotes" | "performanceNotes">;
  progress: string;
  ranking: PerformanceRow[];
  candidates: Candidate[];
  uploads90d: number;
  now: Date;
}): { system: string; prompt: string } {
  const { channel, candidates, ranking } = input;
  const system = [
    `You are the growth mastermind of the faceless YouTube channel "${channel.name}" (niche: ${channel.niche}${channel.targetAudience ? `; audience: ${channel.targetAudience}` : ""}).`,
    "Your single objective is to get this channel into the YouTube Partner Program as fast as possible and then keep growing it. You have full authority over every video that is not yet published: you may retitle it, rewrite its script, or throw its topic away for a stronger one.",
    `The operator chose the growth goal: ${GOAL_LABEL[channel.growthGoal]}. Weight your choices toward it.`,
    "Be decisive and aggressive about what actually moves views and subscribers: hooks in the first two seconds, curiosity-driven but honest titles, strong thumbnail text, series that bring viewers back, topics with real demand, Shorts that funnel into long-form, consistent posting.",
    "Hard limits, because breaking them gets a channel refused or demonetized: never mislead (a title or hook must be delivered by the video), no fake engagement, sub-for-sub, giveaways for subscribers or bought views, no reused or near-duplicate content, nothing harmful, no medical or financial instructions, nothing about real private people.",
    "Change a video only when you are confident the change beats keeping it. A rescript or retopic costs a rebuild, so reserve it for clearly weak videos.",
  ].join("\n");

  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unscheduled");
  const prompt = [
    `Now: ${fmt(input.now)}.`,
    `Monetization progress:\n${input.progress}\nPublic uploads in the last 90 days: ${input.uploads90d}.`,
    ranking.length
      ? `Published videos ranked by views per day (best first):\n${ranking
          .slice(0, 15)
          .map((r) => `- "${r.title}" (${r.format === "SHORT" ? "Short" : "long-form"}): ${r.viewsPerDay}/day, ${r.viewCount} views, ${r.likeCount ?? "?"} likes`)
          .join("\n")}`
      : "No published video has stats yet.",
    channel.performanceNotes?.trim() ? `Earlier lessons from the stats:\n${channel.performanceNotes.trim()}` : "",
    channel.mastermindNotes?.trim() ? `Your current strategy (revise it):\n${channel.mastermindNotes.trim()}` : "",
    candidates.length
      ? `Upcoming videos you may change (use the exact id):\n${candidates
          .map(
            (c) =>
              `- id=${c.id} | ${c.status} | ${c.format === "SHORT" ? "Short" : "long-form"} | posts ${fmt(c.scheduledFor)} | title: "${c.title ?? "(none yet)"}" | topic: "${c.topic}"${c.hook ? ` | opens with: "${c.hook}"` : ""}${c.lockedScenes ? " | has operator-locked scenes: retitle only" : ""}`,
          )
          .join("\n")}`
      : "There are no upcoming videos to change.",
    `Write in language: ${channel.language}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, prompt };
}

export function parsePlan(text: string | undefined): MastermindPlan {
  const parsed = PlanSchema.safeParse(parseJsonText(text));
  if (!parsed.success) throw new Error(`Mastermind plan did not match the schema: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export async function findChannelForMastermind(now: Date = new Date()) {
  return prisma.channel.findFirst({
    where: {
      isActive: true,
      mastermind: true,
      OR: [{ mastermindAt: null }, { mastermindAt: { lt: new Date(now.getTime() - MASTERMIND_INTERVAL_MS) } }],
    },
    orderBy: { mastermindAt: { sort: "asc", nulls: "first" } },
  });
}

export interface MastermindResult {
  diagnosis: string;
  applied: string[];
  skipped: string[];
  backlogAdded: number;
  requests: number;
}

export async function runMastermind(channel: Channel, now: Date = new Date(), client?: GeminiClient): Promise<MastermindResult> {
  // Mark the run first: a crash below must not make every tick retry this channel.
  await prisma.channel.update({ where: { id: channel.id }, data: { mastermindAt: now } });

  let stats = channel;
  if (channel.oauthRefreshTokenEnc && (!channel.channelStatsAt || now.getTime() - channel.channelStatsAt.getTime() > CHANNEL_STATS_INTERVAL_MS)) {
    try {
      stats = { ...channel, ...(await refreshMonetizationStats(channel, now)) } as Channel;
    } catch (error) {
      console.error(`Monetization stats for ${channel.name} failed`, error);
    }
  }

  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
  const [published, upcoming, uploads90d] = await Promise.all([
    prisma.videoProject.findMany({
      where: { channelId: channel.id, status: ProjectStatus.PUBLISHED, publishedAt: { gte: ninetyDaysAgo } },
      select: { title: true, topic: true, format: true, publishedAt: true, viewCount: true, likeCount: true, commentCount: true },
    }),
    prisma.videoProject.findMany({
      where: { channelId: channel.id, status: { in: EDITABLE }, youtubeVideoId: null, OR: [{ scheduledFor: null }, { scheduledFor: { gte: now } }] },
      orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }],
      take: MAX_CANDIDATES,
      select: {
        id: true,
        title: true,
        topic: true,
        status: true,
        format: true,
        scheduledFor: true,
        scenes: { orderBy: { sceneIndex: "asc" }, select: { narrationText: true, locked: true } },
      },
    }),
    prisma.videoProject.count({ where: { channelId: channel.id, status: ProjectStatus.PUBLISHED, publishedAt: { gte: ninetyDaysAgo } } }),
  ]);

  const candidates: Candidate[] = upcoming.map((p) => ({
    id: p.id,
    title: p.title,
    topic: p.topic,
    status: p.status,
    format: p.format,
    scheduledFor: p.scheduledFor,
    hook: p.scenes[0]?.narrationText.slice(0, 160) ?? "",
    lockedScenes: p.scenes.filter((s) => s.locked).length,
  }));
  const { system, prompt } = buildMastermindPrompt({
    channel: stats,
    progress: describeProgress(monetizationProgress(stats, uploads90d, now)),
    ranking: rankPerformance(published, now),
    candidates,
    uploads90d,
    now,
  });
  const { value: plan } = await generateGeminiJson({
    task: "Growth Lab mastermind",
    systemInstruction: system,
    prompt,
    responseJsonSchema: PLAN_JSON_SCHEMA,
    parse: parsePlan,
    client,
  });

  // The strategy goes in first, so rescripts below already follow it.
  await prisma.channel.update({ where: { id: channel.id }, data: { mastermindNotes: plan.strategy.trim() } });
  const result = await applyPlan(channel, plan, candidates, now);
  await prisma.labReport.create({
    data: {
      channelId: channel.id,
      toolId: "mastermind",
      automatic: true,
      summary: plan.diagnosis.slice(0, 300),
      markdown: planMarkdown(plan, result).slice(0, 60_000),
      data: { plan, result } as unknown as Prisma.InputJsonValue,
    },
  });
  return result;
}

/** Carry out the plan's decisions within the limits above. Exported for tests. */
export async function applyPlan(channel: Pick<Channel, "id" | "topicBacklog">, plan: MastermindPlan, candidates: Candidate[], now: Date): Promise<MastermindResult> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const byId = new Map(candidates.map((c) => [c.id, c]));
  let rebuilds = 0;

  for (const decision of plan.decisions) {
    const c = byId.get(decision.projectId);
    if (!c || decision.action === "keep") continue;
    const name = `"${c.title ?? c.topic}"`;
    const rebuild = decision.action === "rescript" || decision.action === "retopic";
    if (rebuild) {
      if (c.lockedScenes) {
        skipped.push(`${name}: kept the script, you locked scenes in it`);
        continue;
      }
      if (c.scheduledFor && c.scheduledFor.getTime() - now.getTime() < REBUILD_LEAD_MS) {
        skipped.push(`${name}: too close to its slot to rebuild`);
        continue;
      }
      if (rebuilds >= MAX_REBUILDS_PER_RUN) {
        skipped.push(`${name}: rebuild deferred to the next run`);
        continue;
      }
    }
    try {
      if (decision.action === "retitle" && decision.newTitle?.trim()) {
        await prisma.videoProject.update({ where: { id: c.id }, data: { title: decision.newTitle.trim() } });
        applied.push(`${name} retitled "${decision.newTitle.trim()}": ${decision.reason}`);
      } else if (rebuild) {
        const topic = decision.action === "retopic" && decision.newTopic?.trim() ? decision.newTopic.trim() : c.topic;
        if (topic !== c.topic) await prisma.videoProject.update({ where: { id: c.id }, data: { topic } });
        rebuilds++;
        if (c.status === ProjectStatus.DRAFT) {
          // Not scripted yet: the new topic is enough, the script is written with the new strategy.
          applied.push(`${name} → topic "${topic}": ${decision.reason}`);
        } else {
          await generateProjectScript(c.id);
          applied.push(`${name} ${topic !== c.topic ? `replaced with "${topic}"` : "rescripted"}: ${decision.reason}`);
        }
      }
    } catch (error) {
      skipped.push(`${name}: ${errorMessage(error).slice(0, 160)}`);
    }
  }

  const added = plan.backlog.length ? await addTopicsToBacklog(channel, plan.backlog) : [];

  let requests = 0;
  for (const r of plan.requests) {
    const open = await prisma.mastermindRequest.findFirst({ where: { channelId: channel.id, status: "open", kind: r.kind, title: r.title } });
    if (open) continue;
    await prisma.mastermindRequest.create({ data: { channelId: channel.id, kind: r.kind, title: r.title, body: r.body } });
    requests++;
  }
  return { diagnosis: plan.diagnosis, applied, skipped, backlogAdded: added.length, requests };
}

function planMarkdown(plan: MastermindPlan, result: MastermindResult): string {
  return [
    `## Diagnosis\n${plan.diagnosis}`,
    `## Strategy\n${plan.strategy}`,
    `## Changes made\n${result.applied.length ? result.applied.map((a) => `- ${a}`).join("\n") : "- None this run."}`,
    result.skipped.length ? `## Held back\n${result.skipped.map((s) => `- ${s}`).join("\n")}` : "",
    plan.backlog.length ? `## New topics\n${plan.backlog.map((t) => `- ${t}`).join("\n")}` : "",
    plan.requests.length ? `## Asked of you\n${plan.requests.map((r) => `- **${r.title}**: ${r.body}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function openRequests(channelId?: string) {
  return prisma.mastermindRequest.findMany({
    where: { status: "open", ...(channelId ? { channelId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { channel: { select: { name: true } } },
  });
}

export async function resolveRequest(id: string, status: "done" | "dismissed", now: Date = new Date()) {
  await prisma.mastermindRequest.update({ where: { id }, data: { status, resolvedAt: now } });
}
