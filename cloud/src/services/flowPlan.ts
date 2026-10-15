import { z } from "zod";
import { AiClipStatus } from "@/generated/prisma/enums";
import { PipelineError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { generateGeminiJson, parseJsonText, sanitizeSchema, type GeminiClient } from "./gemini";
import { queueSceneClip } from "./wan2gp";

/**
 * Script Lab plans a Google Flow clip before a single credit is spent.
 *
 * Flow's free tier gives 25 credits a day here and a clip is capped at 15 (cloud/flow/ enforces
 * both), so at most one or two clips a day. Each one goes to the hook, the scene that decides
 * whether a viewer stays, and only when Script Lab judges that motion beats the still and can
 * write a shot Flow will get right first time: one continuous take, one camera move, the
 * subject exactly as the scene's image shows it. Otherwise the scene keeps its image and nothing
 * is spent. The verdict is recorded on the scene so a video is planned once.
 */

import { FLOW_ENGINE } from "./flowWorker";

export { FLOW_ENGINE };
/** Recorded on a scene Script Lab chose not to animate, so it isn't planned again. */
export const PLAN_DECLINED_PREFIX = "Script Lab plan: kept the still.";

const PlanSchema = z.object({
  animate: z.boolean().describe("true only if motion clearly makes this hook stronger than the still AND the shot is simple enough to get right in one take."),
  prompt: z
    .string()
    .max(900)
    .describe("The Flow video prompt, in English: one continuous shot under 8 seconds that starts on the given image, one camera move, the subject's motion, light, mood. No on-screen text, no cuts, no new characters."),
  reason: z.string().max(300).describe("One sentence on why."),
});
export type FlowPlan = z.infer<typeof PlanSchema>;
const PLAN_JSON_SCHEMA = sanitizeSchema(z.toJSONSchema(PlanSchema));

export function buildFlowPlanPrompt(input: {
  niche: string;
  title: string;
  hook: string;
  imagePrompt: string;
  nextBeat: string;
  format: "SHORT" | "LONG_FORM";
  mascot?: { name: string; look: string } | null;
}) {
  const system = [
    `You are Script Lab, planning one AI video clip for a faceless YouTube channel about ${input.niche}.`,
    "The clip costs scarce credits (about one a day), so be strict: say animate=false unless motion clearly strengthens the opening and the shot is easy to generate well.",
    "Good candidates: a reveal, a transformation, a dramatic camera push, something moving that the narration points at. Poor ones: talking points, lists, abstract ideas, anything needing readable text or several subjects interacting.",
    input.mascot
      ? `The channel's recurring host, ${input.mascot.name}, is attached as a Flow character and must star in the clip: ${input.mascot.look}. Write ${input.mascot.name}'s action and the setting (inspired by the scene's image), refer to them by name, and keep the camera simple. With a host, animating is usually worth it: it builds the channel's identity.`
      : "The clip starts on the scene's existing image, so describe motion of what is in that image; never introduce new people, logos or text.",
  ].join("\n");
  const prompt = [
    `Video title: ${input.title}`,
    `Format: ${input.format === "SHORT" ? "vertical 9:16 Short" : "16:9 long-form"}`,
    `Hook narration (scene 1): "${input.hook}"`,
    `The scene's image shows: ${input.imagePrompt || "(no description)"}`,
    input.nextBeat ? `What comes next: "${input.nextBeat}"` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { system, prompt };
}

export function parseFlowPlan(text: string | undefined): FlowPlan {
  const parsed = PlanSchema.safeParse(parseJsonText(text));
  if (!parsed.success) throw new Error(`Flow plan did not match the schema: ${z.prettifyError(parsed.error)}`);
  if (parsed.data.animate && parsed.data.prompt.trim().length < 30) throw new Error("Flow plan said animate but wrote no usable prompt.");
  return parsed.data;
}

/** A hook scene that could use a Flow clip and hasn't been planned yet. */
export function needsFlowPlan(scene: { imageUrl: string | null; videoClipUrl: string | null; aiClipEngine?: string | null; locked: boolean } | undefined): boolean {
  return Boolean(scene && scene.imageUrl && !scene.videoClipUrl && !scene.aiClipEngine && !scene.locked);
}

/** Plan the hook clip and queue it for the Flow worker, or record why the still stays. */
export async function planFlowHook(projectId: string, client?: GeminiClient): Promise<FlowPlan & { sceneId: string }> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { channel: { select: { niche: true, mascotName: true, mascotLook: true } }, scenes: { orderBy: { sceneIndex: "asc" }, take: 2 } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${projectId} not found.`);
  const [hook, next] = project.scenes;
  if (!needsFlowPlan(hook)) throw new PipelineError("CONFLICT", "The hook scene already has a clip or a plan.");

  const { system, prompt } = buildFlowPlanPrompt({
    niche: project.channel.niche,
    title: project.title ?? project.topic,
    hook: hook.narrationText,
    imagePrompt: hook.visualPrompt ?? "",
    nextBeat: next?.narrationText ?? "",
    format: project.format,
    mascot: project.channel.mascotName && project.channel.mascotLook ? { name: project.channel.mascotName, look: project.channel.mascotLook } : null,
  });
  const { value: plan } = await generateGeminiJson({ task: "Flow clip plan", systemInstruction: system, prompt, responseJsonSchema: PLAN_JSON_SCHEMA, parse: parseFlowPlan, client });

  if (plan.animate) {
    await queueSceneClip(hook.id, plan.prompt, FLOW_ENGINE);
  } else {
    await prisma.scene.update({
      where: { id: hook.id },
      data: { aiClipEngine: FLOW_ENGINE, aiClipStatus: AiClipStatus.FAILED, aiClipError: `${PLAN_DECLINED_PREFIX} ${plan.reason}`.slice(0, 2000), aiClipUpdatedAt: new Date() },
    });
  }
  return { ...plan, sceneId: hook.id };
}

/**
 * Flow-only channels: every scene is a Flow clip. Script Lab writes all the shots in one pass so
 * they read as one continuous film (same characters, palette and light), and every one is queued:
 * nothing is declined, because these channels never show a still.
 */
const ShotsSchema = z.object({
  shots: z
    .array(
      z.object({
        sceneIndex: z.number().int().min(0),
        prompt: z
          .string()
          .min(30)
          .max(900)
          .describe("The Flow video prompt in English: one continuous cinematic shot under 8 seconds, one camera move, the action the narration describes, light and mood. No on-screen text, no cuts."),
      }),
    )
    .min(1),
});
const SHOTS_JSON_SCHEMA = sanitizeSchema(z.toJSONSchema(ShotsSchema));

export function buildFlowScenesPrompt(input: {
  niche: string;
  title: string;
  format: "SHORT" | "LONG_FORM";
  scenes: Array<{ sceneIndex: number; narration: string; imagePrompt: string }>;
  mascot?: { name: string; look: string } | null;
}) {
  const system = [
    `You are Script Lab, directing a fully AI-generated cinematic video for a YouTube channel about ${input.niche}. Every scene below becomes one Google Flow video clip.`,
    "Write one shot per scene so the clips cut together as one film: the same characters with the same look in every shot, one consistent art style, colour palette and lighting, and camera moves that flow from shot to shot. Cinematic: depth of field, warm light, gentle dolly, crane or orbit moves, expressive character animation.",
    "Each shot is one continuous take under 8 seconds showing exactly what its narration describes. Never put words, letters or logos on screen.",
    "Flow creates each shot from your prompt alone (there is no start image), so describe everything: the setting, every character's exact look (species, colours, clothing), the action, the camera and the light, and repeat each recurring character's description word for word in every shot so they look the same throughout.",
    input.mascot
      ? `The first scene stars the channel's host, ${input.mascot.name} (${input.mascot.look}), attached as a Flow character: refer to them by name there.`
      : "",
  ].join("\n");
  const prompt = [
    `Video: ${input.title} (${input.format === "SHORT" ? "vertical 9:16 Short" : "16:9 long-form"})`,
    ...input.scenes.map((s) => `Scene index ${s.sceneIndex}: narration "${s.narration}" | visual idea: ${s.imagePrompt || "(none)"}`),
    "Return one shot for each scene index listed.",
  ].join("\n");
  return { system, prompt };
}

export function parseFlowShots(text: string | undefined) {
  const parsed = ShotsSchema.safeParse(parseJsonText(text));
  if (!parsed.success) throw new Error(`Flow shots did not match the schema: ${z.prettifyError(parsed.error)}`);
  return parsed.data.shots;
}

type ShotScene = { videoClipUrl: string | null; aiClipEngine?: string | null; aiClipStatus?: string | null; locked: boolean };

/** A finished Google Flow clip: not a stock or other AI clip, which Flow-only channels never show. */
export function isFlowClip(scene: ShotScene): boolean {
  return scene.aiClipEngine === FLOW_ENGINE && !scene.aiClipStatus && Boolean(scene.videoClipUrl);
}

/** A Flow-only scene that has never been sent to Flow (whatever stand-in visual it has meanwhile). */
export function needsFlowShot(scene: ShotScene): boolean {
  return !scene.locked && scene.aiClipEngine !== FLOW_ENGINE;
}

/** Plan and queue a Flow clip for every scene of a Flow-only video that doesn't have one yet. */
/** A cinematic Flow prompt built without Gemini, from the scene's own visual prompt and narration. */
export function fallbackFlowShot(scene: { sceneIndex: number; visualPrompt: string | null; narrationText: string }, mascot: { name: string; look: string } | null): string {
  const subject = scene.visualPrompt?.trim() || scene.narrationText;
  // The host's look travels as the attached Flow character, so only the name goes in the prompt.
  const host = mascot && scene.sceneIndex === 0 ? ` ${mascot.name} appears in the shot.` : "";
  return `Cinematic 3D animated shot for young children: ${subject}.${host} Bright, colourful Pixar-style animation, soft lighting, gentle camera movement, no text on screen.`.slice(0, 1500);
}

export async function planFlowScenes(projectId: string, client?: GeminiClient): Promise<{ queued: number }> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { channel: { select: { niche: true, mascotName: true, mascotLook: true } }, scenes: { orderBy: { sceneIndex: "asc" } } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${projectId} not found.`);
  const todo = project.scenes.filter((s) => needsFlowShot(s));
  if (!todo.length) return { queued: 0 };

  const { system, prompt } = buildFlowScenesPrompt({
    niche: project.channel.niche,
    title: project.title ?? project.topic,
    format: project.format,
    scenes: todo.map((s) => ({ sceneIndex: s.sceneIndex, narration: s.narrationText, imagePrompt: s.visualPrompt ?? "" })),
    mascot: project.channel.mascotName && project.channel.mascotLook ? { name: project.channel.mascotName, look: project.channel.mascotLook } : null,
  });
  const mascot = project.channel.mascotName && project.channel.mascotLook ? { name: project.channel.mascotName, look: project.channel.mascotLook } : null;
  let byIndex: Map<number, string>;
  try {
    const { value: shots } = await generateGeminiJson({ task: "Flow shot list", systemInstruction: system, prompt, responseJsonSchema: SHOTS_JSON_SCHEMA, parse: parseFlowShots, client });
    byIndex = new Map(shots.map((s) => [s.sceneIndex, s.prompt]));
  } catch (error) {
    // Gemini's free quota (429) or an outage must not stall the video: build each shot from the
    // script's own scene description instead.
    if (!(error instanceof PipelineError && error.code === "PROVIDER")) throw error;
    byIndex = new Map(todo.map((s) => [s.sceneIndex, fallbackFlowShot(s, mascot)]));
  }
  let queued = 0;
  for (const scene of todo) {
    await queueSceneClip(scene.id, byIndex.get(scene.sceneIndex) ?? scene.visualPrompt ?? scene.narrationText, FLOW_ENGINE);
    queued++;
  }
  return { queued };
}
