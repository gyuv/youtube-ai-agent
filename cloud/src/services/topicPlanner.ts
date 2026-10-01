import { z } from "zod";
import type { VideoFormat } from "@/generated/prisma/enums";
import { generateGeminiJson, parseJsonText, sanitizeSchema, type GeminiClient } from "./gemini";

/** Gemini picks the next video for a channel when the operator's topic backlog is empty. */

const TopicSchema = z.object({
  topic: z.string().min(8).max(200).describe("One specific video idea, phrased the way a viewer would search for it."),
  angle: z.string().max(300).describe("The hook or unique angle that makes this worth watching."),
});

const TOPIC_JSON_SCHEMA = sanitizeSchema(z.toJSONSchema(TopicSchema));

export interface TopicRequest {
  niche: string;
  targetAudience?: string | null;
  language?: string;
  format: VideoFormat;
  channelPrompt?: string | null;
  /** Gemini's lessons from the channel's YouTube stats (see analytics.ts). */
  performanceNotes?: string | null;
  /** Newest first. The planner must not repeat or paraphrase these. */
  recentTopics: string[];
}

const normalise = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function buildTopicPrompt(req: TopicRequest): { system: string; prompt: string } {
  const system = [
    `You plan videos for a faceless YouTube channel in the "${req.niche}" niche.`,
    "Propose exactly one video topic: specific, genuinely useful or surprising, and answerable accurately without live data.",
    "Avoid clickbait that the video can't deliver, medical or financial advice framed as instructions, and anything about real private individuals.",
    req.channelPrompt?.trim() ? `Channel style guide:\n${req.channelPrompt.trim()}` : "",
    req.performanceNotes?.trim() ? `Lessons from this channel's YouTube performance (apply them):\n${req.performanceNotes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = [
    `Format: ${req.format === "SHORT" ? "a YouTube Short under 60 seconds" : "a 6-8 minute long-form video"}.`,
    req.targetAudience?.trim() ? `Audience: ${req.targetAudience.trim()}.` : "",
    `Write the topic in language: ${req.language ?? "en"}.`,
    req.recentTopics.length
      ? `Already covered (do not repeat or closely paraphrase):\n${req.recentTopics.slice(0, 40).map((t) => `- ${t}`).join("\n")}`
      : "This is the channel's first video.",
  ]
    .filter(Boolean)
    .join("\n");
  return { system, prompt };
}

export function parseTopic(text: string | undefined, recentTopics: string[]): string {
  const parsed = TopicSchema.safeParse(parseJsonText(text));
  if (!parsed.success) throw new Error(`Gemini topic did not match the schema: ${z.prettifyError(parsed.error)}`);
  const topic = parsed.data.topic.replace(/\s+/g, " ").trim();
  if (recentTopics.some((t) => normalise(t) === normalise(topic))) {
    throw new Error(`Gemini repeated a recent topic: "${topic}"`); // retried by generateGeminiJson
  }
  return topic;
}

export async function proposeTopic(
  req: TopicRequest,
  options: { client?: GeminiClient; models?: string[]; retryDelayMs?: number } = {},
): Promise<{ topic: string; model: string }> {
  const { system, prompt } = buildTopicPrompt(req);
  const { model, value } = await generateGeminiJson({
    task: "Topic planning",
    systemInstruction: system,
    prompt,
    responseJsonSchema: TOPIC_JSON_SCHEMA,
    parse: (text) => parseTopic(text, req.recentTopics),
    ...options,
  });
  return { topic: value, model };
}
