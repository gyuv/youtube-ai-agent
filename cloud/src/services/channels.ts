import { z } from "zod";
import { PrivacyStatus, VideoFormat } from "@/generated/prisma/enums";
import { PipelineError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isValidCron, isValidTimeZone } from "./schedule";
import { isValidVoice } from "@/lib/voices";

/** Empty form fields become null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

/** HTML checkboxes submit "on" when ticked and nothing otherwise. */
const checkbox = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());

export const ChannelInputSchema = z.object({
  name: z.string().trim().min(1, "Give the channel a name").max(80),
  niche: z.string().trim().min(2, "Describe the channel's niche").max(200),
  targetAudience: optionalText(300),
  language: z.string().trim().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Use a language code such as en, hi or en-IN"),
  defaultVoice: z.string().trim().refine(isValidVoice, "Use an edge-tts voice name such as en-US-AriaNeural"),
  defaultFormat: z.enum(VideoFormat),
  defaultPrivacy: z.enum(PrivacyStatus),
  defaultScriptPrompt: optionalText(4000),
  defaultVisualPrompt: optionalText(1000),
  postingCron: optionalText(100).refine((v) => v === null || isValidCron(v), "Use a 5-field cron such as 0 18 * * 1,3,5"),
  postingTimezone: z.string().trim().refine(isValidTimeZone, "Unknown time zone; use an IANA name such as Asia/Kolkata"),
  autoPublish: checkbox,
  isActive: checkbox,
});

export type ChannelInput = z.infer<typeof ChannelInputSchema>;

export function listChannels() {
  return prisma.channel.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { projects: true } } },
  });
}

export async function getChannel(id: string) {
  const channel = await prisma.channel.findUnique({ where: { id } });
  if (!channel) throw new PipelineError("NOT_FOUND", "Channel not found.");
  return channel;
}

export function createChannel(input: ChannelInput) {
  return prisma.channel.create({ data: input });
}

export async function updateChannel(id: string, input: ChannelInput) {
  await getChannel(id);
  return prisma.channel.update({ where: { id }, data: input });
}

/** Forget the YouTube grant. (The operator can also revoke it at myaccount.google.com/permissions.) */
export async function disconnectChannel(id: string) {
  await getChannel(id);
  return prisma.channel.update({
    where: { id },
    data: {
      youtubeChannelId: null,
      oauthAccessTokenEnc: null,
      oauthRefreshTokenEnc: null,
      oauthTokenExpiresAt: null,
      oauthScopes: [],
      autoPublish: false,
    },
  });
}
