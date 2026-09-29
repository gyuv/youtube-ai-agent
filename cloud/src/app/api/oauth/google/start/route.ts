import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isOperator } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { buildGoogleAuthUrl } from "@/services/youtubeAuth";

export const dynamic = "force-dynamic";

const OAUTH_COOKIE = "lumen_oauth";

/** GET /api/oauth/google/start?channelId=...  →  Google's consent screen. */
export async function GET(request: NextRequest) {
  if (!(await isOperator())) return NextResponse.redirect(new URL("/login", request.url));

  const channelId = request.nextUrl.searchParams.get("channelId") ?? "";
  const channel = channelId ? await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true } }) : null;
  if (!channel) return NextResponse.redirect(new URL("/channels", request.url));

  let authUrl: string;
  const state = randomBytes(24).toString("base64url");
  try {
    authUrl = buildGoogleAuthUrl(state);
  } catch (error) {
    const back = new URL(`/channels/${channel.id}`, request.url);
    back.searchParams.set("youtube", "error");
    back.searchParams.set("message", errorMessage(error));
    return NextResponse.redirect(back);
  }

  const response = NextResponse.redirect(authUrl);
  // Double-submit state: Google echoes `state`; the cookie proves this browser started the flow.
  response.cookies.set(OAUTH_COOKIE, `${state}:${channel.id}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/oauth/google",
    maxAge: 10 * 60,
  });
  return response;
}
