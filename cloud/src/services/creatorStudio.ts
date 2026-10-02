import { z } from "zod";
import { ProjectStatus } from "@/generated/prisma/enums";
import { findTool, type CreatorTool } from "@/creator/catalog";
import {
  chapters,
  cuesFromScenes,
  cuesToSrt,
  deadAir,
  lintTitle,
  parseRetentionCsv,
  parseTranscript,
  retention,
  scoreHook,
  swipe,
  type CollectedVideo,
  type Cue,
} from "@/creator/tools";
import { SKILL_TEXT } from "@/creator/vendor";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { generateGeminiJson, parseJsonText, sanitizeSchema } from "./gemini";
import { getChannelAccessToken } from "./youtube";

/**
 * Creator Studio: the eleven youtube-agent-skill skills run inside the studio, adapted to one
 * channel. Each run:
 *   1. builds the channel's voice profile from its settings, learned lessons and real video stats
 *      (this stands in for the skill pack's ~/.claude/youtube/voice.md);
 *   2. runs the skill's heuristic tool in TypeScript (hook scores, title lint, edit list,
 *      chapters, retention, outliers) so the numbers are computed, not guessed;
 *   3. hands the original SKILL.md, the voice profile, the tool output and the operator's input to
 *      Gemini, which writes the result as Markdown (plus fields the studio can apply to a video).
 */

const MAX_INPUT = 60_000;

// ─────────────────────────────────────────────────────────────
// Channel context
// ─────────────────────────────────────────────────────────────

export async function loadChannelContext(channelId: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new PipelineError("NOT_FOUND", "Channel not found.");
  const videos = await prisma.videoProject.findMany({
    where: { channelId },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, title: true, topic: true, format: true, status: true, publishedAt: true, viewCount: true, likeCount: true, commentCount: true },
  });
  return { channel, videos };
}

type ChannelContext = Awaited<ReturnType<typeof loadChannelContext>>;

export function voiceProfile({ channel, videos }: ChannelContext): string {
  const published = videos.filter((v) => v.status === ProjectStatus.PUBLISHED);
  const lines = [
    `Channel: ${channel.name}`,
    `Niche: ${channel.niche}`,
    channel.targetAudience ? `Audience: ${channel.targetAudience}` : "",
    `Language: ${channel.language}`,
    `Main format: ${channel.defaultFormat === "SHORT" ? "YouTube Shorts (vertical, under 60 s)" : "long-form (16:9)"}`,
    `Narration: an AI voiceover (${channel.defaultVoice}) over AI images or stock footage; the creator does not appear on camera.`,
    channel.defaultScriptPrompt ? `Style guide from the creator:\n${channel.defaultScriptPrompt}` : "",
    channel.performanceNotes ? `Lessons learned from this channel's own YouTube stats:\n${channel.performanceNotes}` : "",
    published.length
      ? `Recent published videos (views / likes / comments where known):\n${published
          .slice(0, 15)
          .map((v) => `- "${v.title ?? v.topic}" (${v.format === "SHORT" ? "Short" : "long"}): ${v.viewCount ?? "?"} / ${v.likeCount ?? "?"} / ${v.commentCount ?? "?"}`)
          .join("\n")}`
      : "No published videos with stats yet.",
  ];
  return lines.filter(Boolean).join("\n");
}

// ─────────────────────────────────────────────────────────────
// Project prefill: a video's idea, title and transcript
// ─────────────────────────────────────────────────────────────

const Words = z.array(z.object({ word: z.string(), startMs: z.number(), endMs: z.number() }));

export async function projectInputs(projectId: string): Promise<Record<string, string>> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { scenes: { orderBy: { sceneIndex: "asc" } } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", "Video not found.");
  const cues = cuesFromScenes(
    project.scenes.map((s) => {
      const words = Words.safeParse(s.wordTimings);
      return { durationSeconds: s.durationSeconds, narrationText: s.narrationText, words: words.success ? words.data : [] };
    }),
  );
  const narration = project.scenes.map((s) => s.narrationText).join(" ");
  return {
    idea: [project.topic, narration && `Script: ${narration.slice(0, 3000)}`].filter(Boolean).join("\n\n"),
    title: project.title ?? project.topic,
    transcript: cues.length ? cuesToSrt(cues) : "",
    duration: String(Math.round(project.scenes.reduce((sum, s) => sum + s.durationSeconds, 0))),
  };
}

// ─────────────────────────────────────────────────────────────
// Viral: search YouTube in the niche (about 110 of the 10,000 daily quota units)
// ─────────────────────────────────────────────────────────────

async function ytGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new PipelineError("PROVIDER", `YouTube ${path} failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Recent popular videos for a query, plus each of their channels' recent uploads, for the median. */
export async function collectNicheVideos(channel: ChannelContext["channel"], query: string, now = new Date()): Promise<CollectedVideo[]> {
  const token = await getChannelAccessToken(channel);
  const search = await ytGet<{ items?: Array<{ snippet?: { channelId?: string } }> }>(
    "search",
    {
      part: "snippet",
      q: query,
      type: "video",
      order: "viewCount",
      maxResults: "25",
      publishedAfter: new Date(now.getTime() - 90 * 86_400_000).toISOString(),
      relevanceLanguage: channel.language.slice(0, 2),
    },
    token,
  );
  const channelIds = [...new Set((search.items ?? []).map((i) => i.snippet?.channelId).filter((id): id is string => Boolean(id)))].slice(0, 6);
  if (!channelIds.length) return [];

  const channels = await ytGet<{ items?: Array<{ id: string; snippet?: { title?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }>(
    "channels",
    { part: "snippet,contentDetails", id: channelIds.join(",") },
    token,
  );
  const videoChannel = new Map<string, string>();
  for (const ch of channels.items ?? []) {
    const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) continue;
    const list = await ytGet<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "12" }, token);
    for (const item of list.items ?? []) if (item.contentDetails?.videoId) videoChannel.set(item.contentDetails.videoId, ch.snippet?.title ?? ch.id);
  }

  const ids = [...videoChannel.keys()];
  const videos: CollectedVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const stats = await ytGet<{ items?: Array<{ id: string; snippet?: { title?: string }; statistics?: { viewCount?: string } }> }>(
      "videos",
      { part: "snippet,statistics", id: ids.slice(i, i + 50).join(",") },
      token,
    );
    for (const v of stats.items ?? []) {
      videos.push({ channel: videoChannel.get(v.id) ?? "?", title: v.snippet?.title ?? "", views: Number(v.statistics?.viewCount ?? 0), url: `https://youtu.be/${v.id}` });
    }
  }
  return videos;
}

// ─────────────────────────────────────────────────────────────
// Running a tool
// ─────────────────────────────────────────────────────────────

export interface ToolRun {
  markdown: string;
  /** Computed by the TypeScript tools, shown as tables in the studio. */
  data: Record<string, unknown>;
  /** What the studio can write back to a video. */
  apply?: { title?: string; description?: string; tags?: string[]; chapters?: string };
  /** Next-video ideas from the plan, viral and audit tools. */
  topics?: string[];
}

const transcriptCues = (raw: string | undefined): Cue[] => (raw?.trim() ? parseTranscript(raw.slice(0, MAX_INPUT)) : []);

/** The heuristic half of each skill: deterministic numbers the model then explains. */
export async function computeToolData(tool: CreatorTool, input: Record<string, string>, ctx: ChannelContext): Promise<Record<string, unknown>> {
  switch (tool.id) {
    case "yt-package":
      return input.title?.trim() ? { titleLint: lintTitle(input.title, input.thumb) } : {};
    case "yt-edit": {
      const cues = transcriptCues(input.transcript);
      if (!cues.length) throw new PipelineError("CONFLICT", "No cues found. Is this an .srt, .vtt or Whisper JSON?");
      return { edl: deadAir(cues) };
    }
    case "yt-chapters": {
      const cues = transcriptCues(input.transcript);
      if (cues.length < 6) throw new PipelineError("CONFLICT", "Too few transcript cues to chapter (need 6+).");
      return { chapters: chapters(cues), transcript: cues.slice(0, 400) };
    }
    case "yt-shorts": {
      const cues = transcriptCues(input.transcript);
      if (!cues.length) throw new PipelineError("CONFLICT", "No cues found in the transcript.");
      return { transcript: cues.slice(0, 600) };
    }
    case "yt-retention": {
      const report = retention(parseRetentionCsv(input.csv ?? ""), Number(input.duration) || undefined, transcriptCues(input.transcript));
      if (!report) throw new PipelineError("CONFLICT", "Couldn't read at least 8 data points from that CSV.");
      return { retention: report };
    }
    case "yt-viral": {
      let collected: CollectedVideo[] = [];
      if (input.collected?.trim()) {
        const parsed = parseJsonText(input.collected) as CollectedVideo[] | { videos?: CollectedVideo[] };
        collected = Array.isArray(parsed) ? parsed : (parsed.videos ?? []);
      } else {
        collected = await collectNicheVideos(ctx.channel, input.query?.trim() || ctx.channel.niche);
      }
      if (!collected.length) throw new PipelineError("CONFLICT", "Found no videos to compare. Try a broader search.");
      return { swipe: swipe(collected, 1.5), collected: collected.length };
    }
    case "yt-audit": {
      const own: CollectedVideo[] = ctx.videos.filter((v) => v.viewCount !== null).map((v) => ({ channel: ctx.channel.name, title: v.title ?? v.topic, views: v.viewCount! }));
      return { ownOutliers: own.length >= 4 ? swipe(own, 1.3) : null, videosWithStats: own.length };
    }
    default:
      return {};
  }
}

const ResultSchema = z.object({
  markdown: z.string().min(20),
  hooks: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  apply: z
    .object({ title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), chapters: z.string().optional() })
    .optional(),
});
const RESULT_JSON_SCHEMA = sanitizeSchema(z.toJSONSchema(ResultSchema));

const APPLY_NOTE: Record<NonNullable<CreatorTool["applies"]>, string> = {
  title: "Also set apply.title to the single recommended title (max 100 characters).",
  seo: "Also set apply.description (the full description, max 5000 characters) and apply.tags (only the tags worth having).",
  chapters: "Also set apply.chapters to the final paste-ready chapter block (one 'm:ss Title' per line, first line 0:00).",
};

export function buildToolPrompt(tool: CreatorTool, input: Record<string, string>, voice: string, data: Record<string, unknown>) {
  const skill = SKILL_TEXT[tool.id];
  const system = [
    `You are running the "${tool.id}" skill inside a creator studio web app for one specific YouTube channel.`,
    "Adapt everything to that channel's niche, audience, language, format and voice below.",
    "Differences from the skill text: there is no filesystem, shell or Python here. Wherever the skill says to read voice.md, use the CHANNEL VOICE PROFILE.",
    "Wherever it says to run a .py tool, its output is already computed in TOOL OUTPUT (identical heuristics); never invent tool numbers that are not there.",
    "Do not ask the user follow-up questions; make the best version with what is given and note any missing input at the end.",
    "Never invent statistics, results or sources. Write the result as clean GitHub Markdown in the `markdown` field.",
    tool.id === "yt-script" ? "Put your five candidate hooks, verbatim, in the `hooks` array as well." : "",
    ["yt-plan", "yt-viral", "yt-audit"].includes(tool.id)
      ? "Also put up to 7 concrete next video topics for this channel in `topics`: each one line, phrased like a search, never repeating a recent video."
      : "",
    tool.applies ? APPLY_NOTE[tool.applies] : "",
    "",
    "=== SKILL ===",
    skill?.body ?? "",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const prompt = [
    "=== CHANNEL VOICE PROFILE ===",
    voice,
    "",
    "=== TOOL OUTPUT ===",
    Object.keys(data).length ? JSON.stringify(data).slice(0, MAX_INPUT) : "(this skill has no tool output)",
    "",
    "=== INPUT ===",
    ...Object.entries(input)
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `${k}:\n${v.slice(0, MAX_INPUT)}`),
  ].join("\n");
  return { system, prompt };
}

export async function runCreatorTool(toolId: string, channelId: string, rawInput: Record<string, string>): Promise<ToolRun> {
  const tool = findTool(toolId);
  if (!tool) throw new PipelineError("NOT_FOUND", `Unknown tool ${toolId}.`);
  const input = Object.fromEntries(Object.entries(rawInput).map(([k, v]) => [k, String(v ?? "").slice(0, MAX_INPUT)]));
  for (const field of tool.fields) {
    if (field.required && !input[field.name]?.trim()) {
      throw new PipelineError("CONFLICT", `${field.label} is required.`);
    }
  }

  const ctx = await loadChannelContext(channelId);
  const data = await computeToolData(tool, input, ctx);
  const { system, prompt } = buildToolPrompt(tool, input, voiceProfile(ctx), data);

  let result: z.infer<typeof ResultSchema>;
  try {
    ({ value: result } = await generateGeminiJson({
      task: tool.title,
      systemInstruction: system,
      prompt,
      responseJsonSchema: RESULT_JSON_SCHEMA,
      parse: (text) => ResultSchema.parse(parseJsonText(text)),
    }));
  } catch (error) {
    throw new PipelineError("PROVIDER", `Gemini couldn't run ${tool.title}: ${errorMessage(error)}`, { cause: error });
  }

  // The script skill's hooks get the real scorer, so the ranking shown is computed, not claimed.
  if (tool.id === "yt-script" && result.hooks?.length) {
    data.hookScores = result.hooks.map(scoreHook).sort((a, b) => b.verdict - a.verdict);
  }
  if (tool.id === "yt-package" && result.apply?.title) data.recommendedTitleLint = lintTitle(result.apply.title, input.thumb);
  return { markdown: result.markdown, data, apply: tool.applies ? result.apply : undefined, topics: result.topics?.map((t) => t.trim()).filter(Boolean) };
}

/** Write a tool's result onto one of the channel's videos (not once it's on YouTube). */
export async function applyToProject(projectId: string, apply: NonNullable<ToolRun["apply"]>) {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId }, select: { status: true, description: true } });
  if (!project) throw new PipelineError("NOT_FOUND", "Video not found.");
  if (project.status === ProjectStatus.PUBLISHED) throw new PipelineError("CONFLICT", "This video is already on YouTube; edit it in YouTube Studio.");
  const data: { title?: string; description?: string; tags?: string[] } = {};
  if (apply.title?.trim()) data.title = apply.title.trim().slice(0, 100);
  if (apply.description?.trim()) data.description = apply.description.trim().slice(0, 5000);
  if (apply.tags?.length) data.tags = apply.tags.map((t) => t.trim()).filter(Boolean).slice(0, 30);
  if (apply.chapters?.trim()) {
    const base = (data.description ?? project.description ?? "").replace(/\n*Chapters\n[\s\S]*$/, "").trim();
    data.description = `${base}\n\nChapters\n${apply.chapters.trim()}`.trim().slice(0, 5000);
  }
  if (!Object.keys(data).length) throw new PipelineError("CONFLICT", "Nothing to apply.");
  return prisma.videoProject.update({ where: { id: projectId }, data });
}
