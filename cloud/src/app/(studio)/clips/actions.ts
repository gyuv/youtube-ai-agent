"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/action";
import { requireOperator } from "@/lib/auth";
import { createClipJob, deleteClipJob, renderClipJob, updateMoments, type MomentEditSchema } from "@/services/clipJobs";
import type { z } from "zod";

export interface NewClipJobInput {
  channelId: string;
  videoId: string;
  count: number;
  maxSeconds: number;
  layout: "crop" | "fit";
  burnCaptions: boolean;
  confirmRights: boolean;
}

/** Find the best moments of a long video, then open the review page. Takes up to a minute. */
export async function createClipJobAction(input: NewClipJobInput): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(() => createClipJob({ ...input, confirmRights: input.confirmRights as true }));
  if (!result.ok) return result;
  revalidatePath("/clips");
  redirect(`/clips/${result.data.id}`);
}

export async function saveMomentsAction(jobId: string, edits: z.input<typeof MomentEditSchema>): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(() => updateMoments(jobId, edits).then(() => null));
  revalidatePath(`/clips/${jobId}`);
  return result;
}

export async function renderClipsAction(jobId: string, edits: z.input<typeof MomentEditSchema>): Promise<ActionResult<{ count: number }>> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await updateMoments(jobId, edits);
    return { count: (await renderClipJob(jobId)).count };
  });
  revalidatePath(`/clips/${jobId}`);
  return result;
}

export async function deleteClipJobAction(jobId: string): Promise<void> {
  await requireOperator();
  await deleteClipJob(jobId);
  revalidatePath("/clips");
  redirect("/clips");
}
