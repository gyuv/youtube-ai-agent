import { z } from "zod";
import { PrivacyStatus, ProjectStatus, VideoFormat } from "@/generated/prisma/enums";
import { PipelineError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { firstFreeSlot } from "./schedule";

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const NewProjectSchema = z
  .object({
    channelId: z.string().min(1, "Pick a channel"),
    topic: z.string().trim().min(3, "Describe the video's topic").max(500),
    format: z.enum(VideoFormat).optional(),
    schedule: z.enum(["none", "next", "custom"]).default("none"),
    scheduledFor: z.union([isoDate, z.literal("").transform(() => null)]).nullish(),
  })
  .refine((v) => v.schedule !== "custom" || v.scheduledFor, { message: "Pick a date and time", path: ["scheduledFor"] });

export type NewProjectInput = z.input<typeof NewProjectSchema>;

export async function createProject(raw: NewProjectInput) {
  const input = NewProjectSchema.parse(raw);
  const channel = await prisma.channel.findUnique({ where: { id: input.channelId } });
  if (!channel) throw new PipelineError("NOT_FOUND", "Channel not found.");

  let scheduledFor: Date | null = null;
  if (input.schedule === "custom") scheduledFor = input.scheduledFor ?? null;
  if (input.schedule === "next") {
    const taken = await prisma.videoProject.findMany({
      where: { channelId: channel.id, scheduledFor: { gte: new Date() } },
      select: { scheduledFor: true },
    });
    scheduledFor = firstFreeSlot(channel, taken.map((p) => p.scheduledFor!));
    if (!scheduledFor) throw new PipelineError("CONFLICT", `"${channel.name}" has no posting schedule; set one or pick a time.`);
  }

  return prisma.videoProject.create({
    data: {
      channelId: channel.id,
      topic: input.topic,
      format: input.format ?? channel.defaultFormat,
      privacy: channel.defaultPrivacy,
      scheduledFor,
    },
  });
}

/** Comma- or newline-separated tags, deduplicated, trimmed to YouTube's 500-character budget. */
export function parseTags(text: string): string[] {
  const tags: string[] = [];
  let used = 0;
  for (const raw of text.split(/[,\n]/)) {
    const tag = raw.replace(/^#/, "").replace(/[<>]/g, "").trim();
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (used + cost > 500) break;
    tags.push(tag);
    used += cost;
  }
  return tags;
}

export const MetadataSchema = z.object({
  title: z.string().trim().max(100, "YouTube titles are at most 100 characters"),
  description: z.string().trim().max(5000, "YouTube descriptions are at most 5000 characters"),
  tags: z.string().transform(parseTags),
  privacy: z.enum(PrivacyStatus),
  scheduledFor: z.union([isoDate, z.literal("").transform(() => null)]),
});

export async function updateProjectMetadata(projectId: string, raw: z.input<typeof MetadataSchema>) {
  const input = MetadataSchema.parse(raw);
  const project = await prisma.videoProject.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) throw new PipelineError("NOT_FOUND", "Project not found.");
  if (project.status === ProjectStatus.PUBLISHED) {
    throw new PipelineError("CONFLICT", "This video is already on YouTube; edit it in YouTube Studio.");
  }
  return prisma.videoProject.update({
    where: { id: projectId },
    data: { title: input.title || null, description: input.description || null, tags: input.tags, privacy: input.privacy, scheduledFor: input.scheduledFor },
  });
}

export async function setSceneLocked(sceneId: string, locked: boolean) {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId }, select: { project: { select: { status: true } } } });
  if (!scene) throw new PipelineError("NOT_FOUND", "Scene not found.");
  if (scene.project.status === ProjectStatus.PUBLISHED) throw new PipelineError("CONFLICT", "Published projects are read-only.");
  return prisma.scene.update({ where: { id: sceneId }, data: { locked } });
}

export async function deleteProject(projectId: string) {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) throw new PipelineError("NOT_FOUND", "Project not found.");
  if (project.status === ProjectStatus.QUEUED_FOR_RENDER || project.status === ProjectStatus.RENDERING) {
    throw new PipelineError("CONFLICT", "Wait for the render to finish before deleting this project.");
  }
  await prisma.videoProject.delete({ where: { id: projectId } });
}

export async function getStudioProject(projectId: string) {
  return prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { channel: true, scenes: { orderBy: { sceneIndex: "asc" } } },
  });
}

/** The channel's auto-publish switch, also offered on each video's page. */
export async function setChannelAutoPublish(channelId: string, enabled: boolean) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { oauthRefreshTokenEnc: true, name: true } });
  if (!channel) throw new PipelineError("NOT_FOUND", `Channel ${channelId} not found.`);
  if (enabled && !channel.oauthRefreshTokenEnc) {
    throw new PipelineError("CONFLICT", `Connect "${channel.name}" to YouTube first (Channels → Connect YouTube).`);
  }
  return prisma.channel.update({ where: { id: channelId }, data: { autoPublish: enabled } });
}
