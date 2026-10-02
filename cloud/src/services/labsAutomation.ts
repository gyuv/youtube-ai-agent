import type { Channel } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { applyToProject, projectInputs, runCreatorTool, type ToolRun } from "./creatorStudio";

/**
 * Creator Labs on autopilot (per channel, `autoLabs`):
 *  - Packaging: before an autopilot video renders, Script Lab writes its title + thumbnail text and
 *    SEO copy, and for long-form Edit Lab adds chapters; all applied to the video.
 *  - Growth review, weekly: Growth Lab's audit, viral-in-niche and plan run, and their topic ideas
 *    go into the channel's topic backlog, so the next autopilot videos follow them.
 * Every run is saved as a LabReport and shown on the Lab pages.
 */

export const GROWTH_REVIEW_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BACKLOG_ADDS = 7;

const firstLine = (markdown: string) =>
  markdown
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .find((l) => l.length > 12)
    ?.slice(0, 200) ?? "Done";

export async function recordReport(channelId: string, toolId: string, run: ToolRun, projectId: string | null, automatic = true, summary?: string) {
  return prisma.labReport.create({
    data: {
      channelId,
      projectId,
      toolId,
      automatic,
      summary: (summary ?? firstLine(run.markdown)).slice(0, 300),
      markdown: run.markdown.slice(0, 60_000),
      data: run.data as Prisma.InputJsonValue,
    },
  });
}

export interface PackageResult {
  applied: string[];
  failed: string[];
}

/** Script Lab + Edit Lab for one video: title/thumbnail, SEO, and chapters for long-form. */
export async function packageProject(projectId: string, now = new Date()): Promise<PackageResult> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId }, select: { id: true, channelId: true, format: true } });
  if (!project) return { applied: [], failed: ["video not found"] };
  const result: PackageResult = { applied: [], failed: [] };
  try {
    const inputs = await projectInputs(projectId);
    let title = inputs.title;

    const steps: Array<{ tool: string; input: () => Record<string, string>; label: string; onlyLong?: boolean }> = [
      { tool: "yt-package", label: "title", input: () => ({ idea: inputs.idea, title }) },
      { tool: "yt-seo", label: "SEO", input: () => ({ title, idea: inputs.idea }) },
      { tool: "yt-chapters", label: "chapters", input: () => ({ transcript: inputs.transcript }), onlyLong: true },
    ];
    for (const step of steps) {
      if (step.onlyLong && (project.format !== "LONG_FORM" || !inputs.transcript)) continue;
      try {
        const run = await runCreatorTool(step.tool, project.channelId, step.input());
        if (run.apply) {
          await applyToProject(projectId, run.apply);
          if (run.apply.title?.trim()) title = run.apply.title.trim();
        }
        await recordReport(project.channelId, step.tool, run, projectId, true, `${step.label} applied: ${firstLine(run.markdown)}`);
        result.applied.push(step.label);
      } catch (error) {
        result.failed.push(`${step.label}: ${errorMessage(error)}`);
      }
    }
  } finally {
    // Once per video, even after a failure, so a broken step can't hold the render back.
    await prisma.videoProject.update({ where: { id: projectId }, data: { labsAppliedAt: now } });
  }
  return result;
}

/** A channel due its weekly Growth Lab review. */
export async function findChannelForGrowthReview(now = new Date()) {
  return prisma.channel.findFirst({
    where: {
      isActive: true,
      autoLabs: true,
      autopilot: true,
      OR: [{ growthReviewAt: null }, { growthReviewAt: { lt: new Date(now.getTime() - GROWTH_REVIEW_INTERVAL_MS) } }],
    },
    orderBy: { growthReviewAt: { sort: "asc", nulls: "first" } },
  });
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Add new topic ideas to the end of the backlog, skipping ones already planned or made. */
export async function addTopicsToBacklog(channel: Pick<Channel, "id" | "topicBacklog">, topics: string[]): Promise<string[]> {
  const recent = await prisma.videoProject.findMany({ where: { channelId: channel.id }, select: { topic: true, title: true }, take: 100, orderBy: { createdAt: "desc" } });
  const backlog = (channel.topicBacklog ?? "").split("\n").map((t) => t.trim()).filter(Boolean);
  const seen = new Set([...backlog, ...recent.flatMap((p) => [p.topic, p.title ?? ""])].map(norm).filter(Boolean));
  const added: string[] = [];
  for (const topic of topics) {
    const clean = topic.replace(/^[-*\d.)\s]+/, "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (clean.length < 8 || seen.has(norm(clean))) continue;
    seen.add(norm(clean));
    added.push(clean);
    if (added.length >= MAX_BACKLOG_ADDS) break;
  }
  if (added.length) await prisma.channel.update({ where: { id: channel.id }, data: { topicBacklog: [...backlog, ...added].join("\n") } });
  return added;
}

/** Growth Lab, weekly: audit, viral-in-niche (needs YouTube), plan; topic ideas join the backlog. */
export async function runGrowthReview(channel: Channel, now = new Date()): Promise<{ ran: string[]; failed: string[]; added: string[] }> {
  const ran: string[] = [];
  const failed: string[] = [];
  const topics: string[] = [];
  const notes: string[] = [];
  try {
    const steps: Array<{ tool: string; input: () => Record<string, string>; skip?: boolean }> = [
      { tool: "yt-audit", input: () => ({ notes: "Automatic weekly review." }) },
      { tool: "yt-viral", input: () => ({ query: "" }), skip: !channel.oauthRefreshTokenEnc },
      {
        tool: "yt-plan",
        input: () => ({
          hours: "Fully automated channel: the autopilot makes and posts every video on the posting schedule.",
          notes: notes.length ? `Findings this week:\n${notes.join("\n")}` : "",
        }),
      },
    ];
    for (const step of steps) {
      if (step.skip) continue;
      try {
        const run = await runCreatorTool(step.tool, channel.id, step.input());
        topics.push(...(run.topics ?? []));
        notes.push(`${step.tool}: ${firstLine(run.markdown)}`);
        await recordReport(channel.id, step.tool, run, null);
        ran.push(step.tool);
      } catch (error) {
        failed.push(`${step.tool}: ${errorMessage(error)}`);
      }
    }
  } finally {
    await prisma.channel.update({ where: { id: channel.id }, data: { growthReviewAt: now } });
  }
  const fresh = await prisma.channel.findUnique({ where: { id: channel.id }, select: { id: true, topicBacklog: true } });
  const added = fresh ? await addTopicsToBacklog(fresh, topics) : [];
  return { ran, failed, added };
}

export async function recentLabReports(labTools: string[], limit = 12) {
  return prisma.labReport.findMany({
    where: { toolId: { in: labTools } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { channel: { select: { name: true } } },
  });
}
