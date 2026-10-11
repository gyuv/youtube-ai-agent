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

export const FLOW_ENGINE = "FLOW";
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
