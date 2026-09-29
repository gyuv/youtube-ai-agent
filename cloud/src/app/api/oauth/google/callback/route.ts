import { NextResponse, type NextRequest } from "next/server";
import { isOperator } from "@/lib/auth";
import { secretsMatch } from "@/lib/crypto";
import { errorMessage } from "@/lib/errors";
import { connectYouTubeChannel } from "@/services/youtubeAuth";

export const dynamic = "force-dynamic";

const OAUTH_COOKIE = "lumen_oauth";

/** Google redirects here after consent. */
export async function GET(request: NextRequest) {
  if (!(await isOperator())) return NextResponse.redirect(new URL("/login", request.url));

  const params = request.nextUrl.searchParams;
  const [expectedState, channelId] = (request.cookies.get(OAUTH_COOKIE)?.value ?? "").split(":");
  const state = params.get("state") ?? "";

  const finish = (outcome: "connected" | "denied" | "error", message?: string) => {
    const target = new URL(channelId ? `/channels/${channelId}` : "/channels", request.url);
    target.searchParams.set("youtube", outcome);
    if (message) target.searchParams.set("message", message);
    const response = NextResponse.redirect(target);
    response.cookies.delete({ name: OAUTH_COOKIE, path: "/api/oauth/google" });
    return response;
  };

  if (!expectedState || !channelId || !state || !secretsMatch(state, expectedState)) {
    return finish("error", "The sign-in link expired or didn't start here. Try connecting again.");
  }
  if (params.get("error")) return finish("denied", "Google access was not granted.");

  const code = params.get("code");
  if (!code) return finish("error", "Google didn't return an authorisation code.");

  try {
    const { youtubeTitle } = await connectYouTubeChannel(channelId, code);
    return finish("connected", `Connected to ${youtubeTitle}.`);
  } catch (error) {
    return finish("error", errorMessage(error));
  }
}
