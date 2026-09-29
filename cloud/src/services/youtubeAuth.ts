import { Prisma } from "@/generated/prisma/client";
import { encryptSecret } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { YOUTUBE_SCOPES } from "./youtube";

/** Google OAuth 2.0 web-server flow for connecting a studio channel to a YouTube channel. */

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline", // we need a refresh token for unattended publishing
    prompt: "consent", // ...and Google only re-issues one on explicit consent
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
}

export async function exchangeAuthCode(code: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new PipelineError("PROVIDER", `Google rejected the sign-in (${body.error ?? res.status}): ${body.error_description ?? ""}`.trim());
  }
  if (!body.refresh_token) {
    throw new PipelineError(
      "PROVIDER",
      "Google didn't return a refresh token. Remove Lumen's access at myaccount.google.com/permissions, then connect again.",
    );
  }
  const scopes = (body.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes(YOUTUBE_SCOPES[0])) {
    throw new PipelineError("PROVIDER", "Upload permission wasn't granted. Connect again and tick the YouTube upload permission.");
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    scopes,
  };
}

export async function fetchOwnYouTubeChannel(accessToken: string): Promise<{ id: string; title: string }> {
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { items?: Array<{ id: string; snippet?: { title?: string } }> };
  const channel = body.items?.[0];
  if (!res.ok || !channel) {
    throw new PipelineError("PROVIDER", "This Google account has no YouTube channel. Create one at youtube.com first.");
  }
  return { id: channel.id, title: channel.snippet?.title ?? channel.id };
}

/** Exchange the code, identify the YouTube channel, and store the encrypted grant. */
export async function connectYouTubeChannel(channelId: string, code: string): Promise<{ youtubeTitle: string }> {
  const tokens = await exchangeAuthCode(code);
  const youtube = await fetchOwnYouTubeChannel(tokens.accessToken);
  try {
    await prisma.channel.update({
      where: { id: channelId },
      data: {
        youtubeChannelId: youtube.id,
        oauthAccessTokenEnc: encryptSecret(tokens.accessToken),
        oauthRefreshTokenEnc: encryptSecret(tokens.refreshToken),
        oauthTokenExpiresAt: tokens.expiresAt,
        oauthScopes: tokens.scopes,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new PipelineError("CONFLICT", `YouTube channel "${youtube.title}" is already connected to another studio channel.`);
    }
    throw new PipelineError("PROVIDER", `Could not save the connection: ${errorMessage(error)}`, { cause: error });
  }
  return { youtubeTitle: youtube.title };
}
