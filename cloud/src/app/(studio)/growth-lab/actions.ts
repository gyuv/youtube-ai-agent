"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action";
import { requireOperator } from "@/lib/auth";
import { PipelineError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { applyBanner, generateBrandAsset, markBrandAssetUsed } from "@/services/branding";
import { resolveRequest, runMastermind } from "@/services/mastermind";
import { refreshMonetizationStats } from "@/services/monetization";

const Id = z.string().min(1);

function refresh(channelId?: string) {
  revalidatePath("/growth-lab");
  revalidatePath("/");
  if (channelId) revalidatePath(`/channels/${channelId}`);
}

export async function setGrowthGoalAction(channelId: string, goal: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await prisma.channel.update({ where: { id: Id.parse(channelId) }, data: { growthGoal: z.enum(["SUBSCRIBERS", "VIEWS", "BALANCED"]).parse(goal) } });
    return null;
  });
  refresh(channelId);
  return result;
}

export async function setMastermindAction(channelId: string, on: boolean): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await prisma.channel.update({ where: { id: Id.parse(channelId) }, data: { mastermind: z.boolean().parse(on) } });
    return null;
  });
  refresh(channelId);
  return result;
}

/** Run the mastermind on one channel now instead of waiting for its next turn. */
export async function runMastermindNowAction(channelId: string): Promise<ActionResult<{ applied: number; diagnosis: string }>> {
  await requireOperator();
  const result = await toActionResult(async () => {
    const channel = await prisma.channel.findUnique({ where: { id: Id.parse(channelId) } });
    if (!channel) throw new PipelineError("NOT_FOUND", "Channel not found.");
    const r = await runMastermind(channel);
    return { applied: r.applied.length, diagnosis: r.diagnosis };
  });
  refresh(channelId);
  return result;
}

export async function refreshStatsAction(channelId: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    const channel = await prisma.channel.findUnique({ where: { id: Id.parse(channelId) } });
    if (!channel?.oauthRefreshTokenEnc) throw new PipelineError("CONFLICT", "Connect YouTube on this channel first.");
    await refreshMonetizationStats(channel);
    return null;
  });
  refresh(channelId);
  return result;
}

export async function generateBrandAssetAction(channelId: string, kind: string): Promise<ActionResult<{ id: string }>> {
  await requireOperator();
  const result = await toActionResult(async () => {
    const asset = await generateBrandAsset(Id.parse(channelId), z.enum(["avatar", "banner", "post"]).parse(kind));
    return { id: asset.id };
  });
  refresh(channelId);
  return result;
}

export async function applyBannerAction(assetId: string, channelId: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await applyBanner(Id.parse(assetId));
    return null;
  });
  refresh(channelId);
  return result;
}

export async function markBrandAssetUsedAction(assetId: string, channelId: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await markBrandAssetUsed(Id.parse(assetId));
    return null;
  });
  refresh(channelId);
  return result;
}

export async function resolveRequestAction(requestId: string, status: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await resolveRequest(Id.parse(requestId), z.enum(["done", "dismissed"]).parse(status));
    return null;
  });
  refresh();
  return result;
}
