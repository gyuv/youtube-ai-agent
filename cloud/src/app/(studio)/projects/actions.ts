"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action";
import { requireOperator } from "@/lib/auth";
import {
  dispatchCloudRender,
  fillSceneAssets,
  generateProjectScript,
  regenerateSceneAudio,
  regenerateSceneVisual,
  updateSceneNarration,
  type SceneFillResult,
} from "@/services/pipeline";
import { createProject, deleteProject, setSceneLocked, updateProjectMetadata } from "@/services/projects";
import { cancelSceneClip, queueSceneClip } from "@/services/wan2gp";
import { checkYouTubeVisibility } from "@/services/youtube";

const Id = z.string().regex(/^[a-z0-9]{20,40}$/, "Invalid id");
const VisualSource = z.enum(["POLLINATIONS", "PEXELS"]);

function refresh(projectId?: string) {
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}

// ── Projects ───────────────────────────────────────────────────

export type NewProjectState = { error: string | null };

export async function createProjectAction(_state: NewProjectState, formData: FormData): Promise<NewProjectState> {
  await requireOperator();
  const form = Object.fromEntries(formData);
  const result = await toActionResult(() =>
    createProject({
      channelId: String(form.channelId ?? ""),
      topic: String(form.topic ?? ""),
      format: form.format ? (String(form.format) as "SHORT" | "LONG_FORM") : undefined,
      schedule: String(form.schedule ?? "none") as "none" | "next" | "custom",
      scheduledFor: String(form.scheduledFor ?? ""),
    }),
  );
  if (!result.ok) return { error: result.error };
  refresh();
  redirect(`/projects/${result.data.id}${form.writeScript === "on" ? "?autoscript=1" : ""}`);
}

export async function generateScriptAction(projectId: string): Promise<ActionResult<{ scenes: number }>> {
  await requireOperator();
  const result = await toActionResult(async () => {
    const project = await generateProjectScript(Id.parse(projectId));
    return { scenes: project.scenes.length };
  });
  refresh(projectId);
  return result;
}

export async function saveMetadataAction(projectId: string, formData: FormData): Promise<ActionResult> {
  await requireOperator();
  const form = Object.fromEntries(formData);
  const result = await toActionResult(async () => {
    await updateProjectMetadata(Id.parse(projectId), {
      title: String(form.title ?? ""),
      description: String(form.description ?? ""),
      tags: String(form.tags ?? ""),
      privacy: String(form.privacy ?? "PRIVATE") as "PRIVATE" | "UNLISTED" | "PUBLIC",
      scheduledFor: String(form.scheduledFor ?? ""),
    });
    return null;
  });
  refresh(projectId);
  return result;
}

export async function dispatchRenderAction(projectId: string): Promise<ActionResult<{ workflowUrl: string }>> {
  await requireOperator();
  const result = await toActionResult(async () => {
    const { workflowUrl } = await dispatchCloudRender(Id.parse(projectId));
    return { workflowUrl };
  });
  refresh(projectId);
  return result;
}

export async function checkVisibilityAction(projectId: string): Promise<ActionResult<{ visibility: string | null; locked: boolean }>> {
  await requireOperator();
  const result = await toActionResult(async () => {
    const { visibility, locked } = await checkYouTubeVisibility(Id.parse(projectId));
    return { visibility: visibility?.privacyStatus ?? null, locked };
  });
  refresh(projectId);
  return result;
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await deleteProject(Id.parse(projectId));
    return null;
  });
  if (!result.ok) return result;
  refresh();
  redirect("/");
}

// ── Scenes ─────────────────────────────────────────────────────

export async function fillSceneAction(projectId: string, sceneId: string, visualSource: string): Promise<ActionResult<SceneFillResult>> {
  await requireOperator();
  const result = await toActionResult(() => fillSceneAssets(Id.parse(sceneId), { visualSource: VisualSource.parse(visualSource) }));
  refresh(projectId);
  return result;
}

export async function saveNarrationAction(projectId: string, sceneId: string, text: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await updateSceneNarration(Id.parse(sceneId), z.string().max(3000).parse(text));
    return null;
  });
  refresh(projectId);
  return result;
}

export async function regenerateAudioAction(projectId: string, sceneId: string, text: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await regenerateSceneAudio(Id.parse(sceneId), { narrationText: z.string().max(3000).parse(text) });
    return null;
  });
  refresh(projectId);
  return result;
}

const VisualRequest = z.object({
  source: VisualSource,
  visualPrompt: z.string().max(2000).optional(),
  stockQuery: z.string().max(120).optional(),
});

export async function regenerateVisualAction(projectId: string, sceneId: string, request: z.input<typeof VisualRequest>): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await regenerateSceneVisual(Id.parse(sceneId), VisualRequest.parse(request));
    return null;
  });
  refresh(projectId);
  return result;
}

export async function setSceneLockedAction(projectId: string, sceneId: string, locked: boolean): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await setSceneLocked(Id.parse(sceneId), z.boolean().parse(locked));
    return null;
  });
  refresh(projectId);
  return result;
}

export async function queueAiClipAction(projectId: string, sceneId: string, prompt: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await queueSceneClip(Id.parse(sceneId), z.string().max(1500).parse(prompt));
    return null;
  });
  refresh(projectId);
  return result;
}

export async function cancelAiClipAction(projectId: string, sceneId: string): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await cancelSceneClip(Id.parse(sceneId));
    return null;
  });
  refresh(projectId);
  return result;
}
