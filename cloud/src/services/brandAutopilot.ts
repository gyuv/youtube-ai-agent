import type { Channel } from "@/generated/prisma/client";
import { errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { applyBanner, canSetBanner, generateBrandAsset } from "./branding";

/**
 * Under autopilot the mastermind keeps the channel's branding fresh itself: it designs a banner and
 * sets it on YouTube, and designs a profile picture. YouTube has no API for profile pictures, so the
 * picture becomes a request with the image ready to upload; the banner never needs the operator.
 */

/** A new banner at most this often unless the mastermind asks for one. */
export const BANNER_REFRESH_MS = 30 * 86_400_000;
/** Even when the mastermind asks, never more often than this. */
export const BRAND_MIN_GAP_MS = 7 * 86_400_000;

export interface AutoBrandResult {
  done: string[];
  /** Request kinds handled here, so the mastermind doesn't also ask the operator. */
  handled: Set<string>;
  /** A request to upload the generated profile picture, when one was made. */
  avatarRequest: { title: string; body: string } | null;
}

export function brandDue(lastAt: Date | null, asked: boolean, now: Date): boolean {
  if (!lastAt) return true;
  const age = now.getTime() - lastAt.getTime();
  return age >= BANNER_REFRESH_MS || (asked && age >= BRAND_MIN_GAP_MS);
}

export async function autoBrand(
  channel: Pick<Channel, "id" | "autopilot" | "oauthScopes" | "oauthRefreshTokenEnc">,
  asked: { banner: boolean; avatar: boolean },
  now: Date,
): Promise<AutoBrandResult> {
  const result: AutoBrandResult = { done: [], handled: new Set(), avatarRequest: null };
  if (!channel.autopilot) return result;
  const [lastBanner, lastAvatar] = await Promise.all(
    (["banner", "avatar"] as const).map((kind) => prisma.brandAsset.findFirst({ where: { channelId: channel.id, kind }, orderBy: { createdAt: "desc" }, select: { createdAt: true, appliedAt: true } })),
  );

  if (canSetBanner(channel) && brandDue(lastBanner?.appliedAt ?? null, asked.banner, now)) {
    try {
      const asset = await generateBrandAsset(channel.id, "banner");
      await applyBanner(asset.id, now);
      result.done.push("designed and set a new channel banner");
      result.handled.add("banner");
    } catch (error) {
      result.done.push(`could not set a new banner (${errorMessage(error).slice(0, 160)})`);
    }
  }

  if (brandDue(lastAvatar?.createdAt ?? null, asked.avatar, now)) {
    try {
      const asset = await generateBrandAsset(channel.id, "avatar");
      result.done.push("designed a new profile picture");
      result.handled.add("avatar");
      result.avatarRequest = {
        title: "Upload the new profile picture",
        body: `YouTube doesn't let apps change the profile picture, so this one step needs you: download ${asset.imageUrl} and upload it in YouTube Studio → Customisation → Branding → Picture. ${asset.text ?? ""}`.trim().slice(0, 1200),
      };
    } catch (error) {
      result.done.push(`could not design a profile picture (${errorMessage(error).slice(0, 160)})`);
    }
  }
  return result;
}
