import { z } from "zod";
import type { Channel } from "@/generated/prisma/client";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { uploadObject } from "@/lib/storage";
import { generateGeminiJson, parseJsonText, sanitizeSchema, type GeminiClient } from "./gemini";
import { GOAL_LABEL } from "./growthGoal";
import { generatePollinationsImage } from "./visualFetcher";
import { MANAGE_SCOPE, getChannelAccessToken } from "./youtube";

/**
 * Channel branding from the Growth Lab: a profile picture, a banner and community posts, written
 * for the channel's niche and growth goal and drawn with the same free image service as scenes.
 *
 * YouTube lets apps set the banner (channelBanners.insert + channels.update, which needs the
 * youtube manage scope). There is no API for the profile picture or community posts, so those
 * are handed to the operator ready to upload or paste.
 */

export type BrandKind = "avatar" | "banner" | "post";

/** YouTube's banner minimum is 2048x1152 (16:9); everything outside the 1235x338 centre is cropped on phones. */
const SIZES: Record<BrandKind, { width: number; height: number }> = {
  avatar: { width: 800, height: 800 },
  banner: { width: 2048, height: 1152 },
  post: { width: 1080, height: 1080 },
};

const BriefSchema = z.object({
  imagePrompt: z.string().min(20).max(800).describe("An English prompt for an image model. No words or letters in the image: image models misspell them."),
  text: z.string().max(1500).describe("For a post: the ready-to-paste post text. For a banner: a short tagline the operator can add in YouTube Studio. For an avatar: one line on why it works."),
});
const BRIEF_JSON_SCHEMA = sanitizeSchema(z.toJSONSchema(BriefSchema));

const KIND_BRIEF: Record<BrandKind, string> = {
  avatar:
    "Design the channel's profile picture. It shows at 98px in a circle: one bold, centred subject (a mascot, symbol or face-like icon) on a plain high-contrast background, flat and simple, readable at thumbnail size. Square composition.",
  banner:
    "Design the channel banner (2048x1152). Put the visual focus in a horizontal strip across the exact centre (the only part phones show); keep the edges calm background that can be cropped. Match the niche's mood and the profile picture style.",
  post:
    "Write one YouTube community post that brings back past viewers and wins new subscribers: a poll question with 2-4 options, a behind-the-scenes teaser of the next video, or a quick valuable tip. Then describe a square image to go with it.",
};

export function buildBrandPrompt(channel: Pick<Channel, "name" | "niche" | "targetAudience" | "language" | "growthGoal" | "mastermindNotes">, kind: BrandKind) {
  const system = [
    `You are the brand designer of the faceless YouTube channel "${channel.name}" (niche: ${channel.niche}${channel.targetAudience ? `; audience: ${channel.targetAudience}` : ""}).`,
    `Its growth goal: ${GOAL_LABEL[channel.growthGoal]}. Everything should make a first-time visitor want to subscribe, honestly: no fake claims, no giveaways for subscribing.`,
    channel.mastermindNotes?.trim() ? `Current growth strategy:\n${channel.mastermindNotes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = `${KIND_BRIEF[kind]}\nWrite any text in language: ${channel.language}.`;
  return { system, prompt };
}

export function parseBrief(text: string | undefined) {
  const parsed = BriefSchema.safeParse(parseJsonText(text));
  if (!parsed.success) throw new Error(`Brand brief did not match the schema: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export async function generateBrandAsset(channelId: string, kind: BrandKind, client?: GeminiClient) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new PipelineError("NOT_FOUND", `Channel ${channelId} not found.`);
  const { system, prompt } = buildBrandPrompt(channel, kind);
  const { value: brief } = await generateGeminiJson({
    task: "Brand design",
    systemInstruction: system,
    prompt,
    responseJsonSchema: BRIEF_JSON_SCHEMA,
    parse: parseBrief,
    client,
  });
  const image = await generatePollinationsImage(brief.imagePrompt, { ...SIZES[kind], timeoutMs: 120_000 });
  const ext = image.contentType.includes("png") ? "png" : "jpg";
  const imageUrl = await uploadObject(`channels/${channelId}/brand/${kind}-${Date.now()}.${ext}`, image.bytes, image.contentType);
  return prisma.brandAsset.create({ data: { channelId, kind, prompt: brief.imagePrompt, imageUrl, text: brief.text } });
}

export function canSetBanner(channel: Pick<Channel, "oauthScopes" | "oauthRefreshTokenEnc">): boolean {
  return Boolean(channel.oauthRefreshTokenEnc) && channel.oauthScopes.includes(MANAGE_SCOPE);
}

async function youtube(url: string, init: RequestInit, what: string) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new PipelineError("PROVIDER", `Could not reach YouTube to ${what}: ${errorMessage(error)}`, { cause: error });
  }
  if (!res.ok) throw new PipelineError("PROVIDER", `YouTube refused to ${what} (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Upload a generated banner and make it the channel's banner. */
export async function applyBanner(assetId: string, now: Date = new Date()) {
  const asset = await prisma.brandAsset.findUnique({ where: { id: assetId }, include: { channel: true } });
  if (!asset || asset.kind !== "banner" || !asset.imageUrl) throw new PipelineError("NOT_FOUND", "Banner not found.");
  if (!canSetBanner(asset.channel)) {
    throw new PipelineError("CONFLICT", "Reconnect YouTube on this channel's page to let Lumen set the banner (it needs permission to manage the channel).");
  }
  const image = await fetch(asset.imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!image.ok) throw new PipelineError("PROVIDER", `Could not read the banner image (${image.status}).`);
  const bytes = Buffer.from(await image.arrayBuffer());
  const token = await getChannelAccessToken(asset.channel);
  const auth = { Authorization: `Bearer ${token}` };

  const uploaded = await youtube(
    "https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=media",
    { method: "POST", headers: { ...auth, "Content-Type": image.headers.get("content-type") ?? "image/jpeg" }, body: bytes },
    "upload the banner",
  );
  const bannerUrl = uploaded.url as string | undefined;
  if (!bannerUrl) throw new PipelineError("PROVIDER", "YouTube accepted the banner but returned no URL.");

  // channels.update replaces brandingSettings wholesale, so send back everything already there.
  const current = await youtube("https://www.googleapis.com/youtube/v3/channels?part=brandingSettings&mine=true", { headers: auth }, "read the channel settings");
  const item = (current.items as Array<{ id: string; brandingSettings?: Record<string, unknown> }> | undefined)?.[0];
  if (!item) throw new PipelineError("PROVIDER", "YouTube returned no channel for this account.");
  const branding = item.brandingSettings ?? {};
  await youtube(
    "https://www.googleapis.com/youtube/v3/channels?part=brandingSettings",
    {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, brandingSettings: { ...branding, image: { ...(branding.image as object | undefined), bannerExternalUrl: bannerUrl } } }),
    },
    "set the banner",
  );
  await prisma.brandAsset.update({ where: { id: asset.id }, data: { appliedAt: now } });
}

export async function markBrandAssetUsed(assetId: string, now: Date = new Date()) {
  await prisma.brandAsset.update({ where: { id: assetId }, data: { appliedAt: now } });
}

export async function recentBrandAssets(channelId: string) {
  return prisma.brandAsset.findMany({ where: { channelId }, orderBy: { createdAt: "desc" }, take: 18 });
}
