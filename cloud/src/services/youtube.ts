import { SCENE_TAIL_SECONDS } from "../../remotion/timeline";
import type { Channel, Scene, VideoProject } from "@/generated/prisma/client";
import { ProjectStatus, type PrivacyStatus } from "@/generated/prisma/enums";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { optionalEnv, requireEnv } from "@/lib/env";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { YouTubeVideoMetadata } from "./renderContract";
import { ScriptSchema, buildChapters } from "./scriptGenerator";
import { fetchVideoVisibility, isLockedPrivate, type ReportedVisibility, type Visibility } from "./youtubeVisibility";

/** youtube.upload publishes; youtube.readonly identifies the connected channel. */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("PROVIDER", `Could not reach Google OAuth: ${errorMessage(error)}`, { cause: error });
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      throw new PipelineError(
        "PROVIDER",
        "Google revoked or expired this channel's authorisation; reconnect the channel. " +
          "(OAuth apps left in Testing mode expire refresh tokens after 7 days; publish the consent screen.)",
      );
    }
    throw new PipelineError("PROVIDER", `Google token refresh failed (${res.status}): ${body.error ?? "unknown error"}`);
  }
  return { accessToken: body.access_token, expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000) };
}

/** A fresh access token for publishing; the refresh token never leaves the app. */
export async function getChannelAccessToken(channel: Pick<Channel, "id" | "name" | "oauthRefreshTokenEnc">): Promise<string> {
  if (!channel.oauthRefreshTokenEnc) {
    throw new PipelineError("CONFLICT", `Channel "${channel.name}" is not connected to YouTube.`);
  }
  const { accessToken, expiresAt } = await refreshAccessToken(decryptSecret(channel.oauthRefreshTokenEnc));
  await prisma.channel.update({
    where: { id: channel.id },
    data: { oauthAccessTokenEnc: encryptSecret(accessToken), oauthTokenExpiresAt: expiresAt },
  });
  return accessToken;
}

type ProjectForMetadata = Pick<
  VideoProject,
  "topic" | "title" | "description" | "tags" | "privacy" | "format" | "script" | "scheduledFor"
>;

/** Snippet + status for videos.insert, following YouTube's field limits. */
export function buildYouTubeMetadata(
  project: ProjectForMetadata,
  scenes: Pick<Scene, "sceneIndex" | "durationSeconds">[],
  channel: Pick<Channel, "language">,
  now: Date = new Date(),
): YouTubeVideoMetadata {
  const title = (project.title?.trim() || project.topic).replace(/[<>]/g, "").slice(0, 100);
  let description = (project.description ?? "").replace(/[<>]/g, "").trim();

  if (project.format === "LONG_FORM") {
    const script = ScriptSchema.safeParse(project.script);
    const ordered = [...scenes].sort((a, b) => a.sceneIndex - b.sceneIndex);
    // Chapters line up with scenes only while the scene list still mirrors the script's beats.
    if (script.success && ordered.length === script.data.sections.length + 2) {
      const chapters = buildChapters(
        script.data,
        ordered.map((s) => s.durationSeconds + SCENE_TAIL_SECONDS),
      );
      if (chapters.length) description = `${description}\n\nChapters\n${chapters.join("\n")}`.trim();
    }
  } else if (!/#shorts\b/i.test(`${title} ${description}`)) {
    description = `${description}\n\n#Shorts`.trim();
  }

  // Only public videos are scheduled: YouTube makes a video public at publishAt, so scheduling a
  // private or unlisted one would publish it wider than the operator chose.
  const scheduled =
    project.privacy === "PUBLIC" && project.scheduledFor && project.scheduledFor.getTime() > now.getTime() + 5 * 60_000;
  return {
    snippet: {
      title,
      description: description.slice(0, 5000),
      tags: project.tags,
      categoryId: optionalEnv("YOUTUBE_CATEGORY_ID", "22"),
      defaultLanguage: channel.language,
      defaultAudioLanguage: channel.language,
    },
    status: {
      // YouTube only honours publishAt on private videos; it flips them public at that time.
      privacyStatus: scheduled ? "private" : wantedVisibility(project.privacy),
      ...(scheduled ? { publishAt: project.scheduledFor!.toISOString() } : {}),
      selfDeclaredMadeForKids: false,
      // AI voice and AI imagery: YouTube asks creators to disclose realistic synthetic media.
      containsSyntheticMedia: true,
    },
  };
}

export function wantedVisibility(privacy: PrivacyStatus): Visibility {
  return privacy.toLowerCase() as Visibility;
}

/**
 * Read a published video's visibility back from YouTube and record whether it is locked private.
 * Run from the studio's "Check visibility" button and by the autopilot after a scheduled slot.
 */
export async function checkYouTubeVisibility(
  projectId: string,
  now: Date = new Date(),
): Promise<{ visibility: ReportedVisibility | null; locked: boolean }> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId }, include: { channel: true } });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${projectId} not found.`);
  if (project.status !== ProjectStatus.PUBLISHED || !project.youtubeVideoId) {
    throw new PipelineError("CONFLICT", "This video isn't on YouTube yet.");
  }

  const accessToken = await getChannelAccessToken(project.channel);
  let visibility: ReportedVisibility | null;
  try {
    visibility = await fetchVideoVisibility(project.youtubeVideoId, accessToken);
  } catch (error) {
    throw new PipelineError("PROVIDER", errorMessage(error), { cause: error });
  }
  const locked = visibility ? isLockedPrivate(wantedVisibility(project.privacy), visibility, now) : false;
  await prisma.videoProject.update({ where: { id: projectId }, data: { youtubeLocked: locked, youtubeCheckedAt: now } });
  return { visibility, locked };
}
