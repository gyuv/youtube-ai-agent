"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action";
import { requireOperator } from "@/lib/auth";
import { createProject } from "@/services/projects";
import {
  TranscriptError,
  getResearchPlaylist,
  getResearchVideo,
  getTranscript,
  parseYouTubeUrl,
  type ResearchPlaylist,
  type ResearchVideo,
  type Transcript,
  type TranscriptFailure,
} from "@/services/videoResearch";

export type LookupResult = { kind: "video"; video: ResearchVideo } | { kind: "playlist"; playlist: ResearchPlaylist };

export async function lookupAction(url: string): Promise<ActionResult<LookupResult>> {
  await requireOperator();
  return toActionResult(async () => {
    const parsed = parseYouTubeUrl(z.string().max(500).parse(url));
    return parsed.kind === "video"
      ? { kind: "video" as const, video: await getResearchVideo(parsed.videoId) }
      : { kind: "playlist" as const, playlist: await getResearchPlaylist(parsed.playlistId) };
  });
}

export type TranscriptResult = { ok: true; data: Transcript } | { ok: false; error: string; reason?: TranscriptFailure };

export async function transcriptAction(videoId: string, language: string, refresh = false): Promise<TranscriptResult> {
  await requireOperator();
  const lang = z.string().regex(/^([a-z]{2,3}(-[A-Za-z]{2,4})?)?$/).parse(language);
  try {
    return { ok: true, data: await getTranscript(videoId, lang, { refresh }) };
  } catch (error) {
    if (error instanceof TranscriptError) return { ok: false, error: error.message, reason: error.reason };
    const result = await toActionResult(() => Promise.reject(error));
    return { ok: false, error: result.ok ? "Something went wrong." : result.error };
  }
}

/** Start a new video project inspired by a researched video. */
export async function videoFromResearchAction(channelId: string, topic: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(() => createProject({ channelId, topic: topic.slice(0, 500) }));
  if (!result.ok) return result;
  redirect(`/projects/${result.data.id}`);
}
