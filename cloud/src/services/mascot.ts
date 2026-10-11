import { z } from "zod";
import { PipelineError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { generateGeminiJson, parseJsonText, sanitizeSchema, type GeminiClient } from "./gemini";
import { GOAL_LABEL } from "./growthGoal";

/**
 * The channel's recurring host. Script Lab designs it once; the Google Flow worker turns it into a
 * Flow character (the portrait is free) and attaches it to every Flow clip, so the same face opens
 * every video. A face viewers recognise is what turns one-off viewers into subscribers.
 */

const MascotSchema = z.object({
  name: z.string().min(2).max(40).describe("A short, memorable, pronounceable name that fits the channel."),
  look: z
    .string()
    .min(80)
    .max(900)
    .describe("An exact visual description an image model can redraw identically every time: species/type, body shape and proportions, face, colours (named precisely), clothing or accessories, art style (e.g. glossy 3D cartoon), and one signature detail. No text or logos on it."),
  why: z.string().max(300).describe("One sentence: why this host suits the niche and audience."),
});
export type MascotDesign = z.infer<typeof MascotSchema>;
const MASCOT_JSON_SCHEMA = sanitizeSchema(z.toJSONSchema(MascotSchema));

export function parseMascot(text: string | undefined): MascotDesign {
  const parsed = MascotSchema.safeParse(parseJsonText(text));
  if (!parsed.success) throw new Error(`Mascot design did not match the schema: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export async function designMascot(channelId: string, client?: GeminiClient): Promise<MascotDesign> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new PipelineError("NOT_FOUND", `Channel ${channelId} not found.`);
  const { value } = await generateGeminiJson({
    task: "Mascot design",
    systemInstruction: [
      `You are Script Lab, designing the recurring on-screen host of the faceless YouTube channel "${channel.name}" (niche: ${channel.niche}${channel.targetAudience ? `; audience: ${channel.targetAudience}` : ""}).`,
      `Growth goal: ${GOAL_LABEL[channel.growthGoal]}. The host opens every video in a short animated clip, so it must be instantly recognisable at phone size, expressive, original (not resembling any existing brand or character), and easy for an AI video model to keep identical across clips: a simple silhouette, a few bold colours, one signature detail.`,
      channel.mastermindNotes?.trim() ? `Current growth strategy:\n${channel.mastermindNotes.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    prompt: `Design the host. Write the name in language: ${channel.language}; write the look in English.`,
    responseJsonSchema: MASCOT_JSON_SCHEMA,
    parse: parseMascot,
    client,
  });
  return value;
}

export const MascotInput = z.object({
  mascotName: z.string().trim().max(40).nullable(),
  mascotLook: z.string().trim().max(900).nullable(),
  flowHookClips: z.boolean(),
  flowOnly: z.boolean().optional(),
});

export async function saveFlowSettings(channelId: string, input: z.input<typeof MascotInput>) {
  const data = MascotInput.parse(input);
  await prisma.channel.update({
    where: { id: channelId },
    data: { mascotName: data.mascotName || null, mascotLook: data.mascotLook || null, flowHookClips: data.flowHookClips || Boolean(data.flowOnly), ...(data.flowOnly !== undefined ? { flowOnly: data.flowOnly } : {}) },
  });
}
