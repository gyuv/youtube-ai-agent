"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action";
import { requireOperator } from "@/lib/auth";
import { applyToProject, projectInputs, runCreatorTool, type ToolRun } from "@/services/creatorStudio";
import { recordReport } from "@/services/labsAutomation";

const Id = z.string().min(1).max(64);
const Input = z.record(z.string(), z.string().max(80_000));

export async function runToolAction(toolId: string, channelId: string, input: Record<string, string>): Promise<ActionResult<ToolRun>> {
  await requireOperator();
  return toActionResult(async () => {
    const tool = z.string().regex(/^yt-[a-z]+$/).parse(toolId);
    const run = await runCreatorTool(tool, Id.parse(channelId), Input.parse(input));
    await recordReport(channelId, tool, run, null, false).catch(() => {}); // history only; never fail the run over it
    return run;
  });
}

export async function prefillFromProjectAction(projectId: string): Promise<ActionResult<Record<string, string>>> {
  await requireOperator();
  return toActionResult(() => projectInputs(Id.parse(projectId)));
}

const Apply = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(10_000).optional(),
  tags: z.array(z.string().max(100)).max(60).optional(),
  chapters: z.string().max(5000).optional(),
});

export async function applyToProjectAction(projectId: string, apply: z.input<typeof Apply>): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await applyToProject(Id.parse(projectId), Apply.parse(apply));
    return null;
  });
  revalidatePath(`/projects/${projectId}`);
  return result;
}
