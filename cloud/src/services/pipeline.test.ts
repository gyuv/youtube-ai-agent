import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  videoProject: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  scene: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
}));
const dispatchRenderWorkflow = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./renderDispatcher", () => ({ dispatchRenderWorkflow }));

import { assetStatusFor, dispatchCloudRender, generateProjectAssets, regenerateSceneAudio } from "./pipeline";

interface FakeScene {
  id: string;
  sceneIndex: number;
  locked: boolean;
  voiceAudioUrl: string | null;
  imageUrl: string | null;
  videoClipUrl: string | null;
  durationSeconds: number;
}

const complete = (sceneIndex: number): FakeScene => ({
  id: `scene_${sceneIndex}`,
  sceneIndex,
  locked: false,
  voiceAudioUrl: "https://cdn/voice.mp3",
  imageUrl: "https://cdn/img.jpg",
  videoClipUrl: null,
  durationSeconds: 4.2,
});

beforeEach(() => {
  for (const group of Object.values(db)) for (const fn of Object.values(group)) fn.mockReset();
  dispatchRenderWorkflow.mockReset();
});

describe("assetStatusFor", () => {
  it("is ASSETS_READY only when every scene has audio, a visual and a duration", () => {
    expect(assetStatusFor([complete(0), complete(1)])).toBe("ASSETS_READY");
    expect(assetStatusFor([complete(0), { ...complete(1), voiceAudioUrl: null }])).toBe("SCRIPTED");
    expect(assetStatusFor([{ ...complete(0), imageUrl: null, videoClipUrl: "https://cdn/clip.mp4" }])).toBe("ASSETS_READY");
    expect(assetStatusFor([{ ...complete(0), durationSeconds: 0 }])).toBe("SCRIPTED");
    expect(assetStatusFor([])).toBe("SCRIPTED");
  });
});

describe("dispatchCloudRender", () => {
  const project = (status: string, scenes = [complete(0), complete(1)]) => ({ id: "p1", status, scenes });

  it("claims the project atomically, then dispatches the workflow", async () => {
    db.videoProject.findUnique.mockResolvedValue(project("ASSETS_READY"));
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    dispatchRenderWorkflow.mockResolvedValue({ workflowUrl: "https://github.com/x" });

    await expect(dispatchCloudRender("p1")).resolves.toEqual({ workflowUrl: "https://github.com/x" });
    const claim = db.videoProject.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: "p1", status: { in: ["ASSETS_READY", "RENDERED", "FAILED"] } });
    expect(claim.data).toMatchObject({ status: "QUEUED_FOR_RENDER", lastError: null, renderRunId: null });
    expect(dispatchRenderWorkflow).toHaveBeenCalledWith("p1");
  });

  it("names the scenes that still need assets", async () => {
    db.videoProject.findUnique.mockResolvedValue(
      project("ASSETS_READY", [complete(0), { ...complete(1), voiceAudioUrl: null }, { ...complete(2), imageUrl: null }]),
    );
    await expect(dispatchCloudRender("p1")).rejects.toThrow(/Scenes 2, 3 still need/);
    expect(db.videoProject.updateMany).not.toHaveBeenCalled();
  });

  it("refuses projects that are already rendering", async () => {
    db.videoProject.findUnique.mockResolvedValue(project("RENDERING"));
    await expect(dispatchCloudRender("p1")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("does not dispatch twice when another request won the claim", async () => {
    db.videoProject.findUnique.mockResolvedValue(project("ASSETS_READY"));
    db.videoProject.updateMany.mockResolvedValue({ count: 0 });
    await expect(dispatchCloudRender("p1")).rejects.toThrow(/already queued/);
    expect(dispatchRenderWorkflow).not.toHaveBeenCalled();
  });

  it("restores the previous status and records the error when GitHub refuses", async () => {
    db.videoProject.findUnique.mockResolvedValue(project("RENDERED"));
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    dispatchRenderWorkflow.mockRejectedValue(new Error("GitHub dispatch failed with 401"));

    await expect(dispatchCloudRender("p1")).rejects.toThrow(/401/);
    expect(db.videoProject.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { status: "RENDERED", lastError: "Render dispatch failed: GitHub dispatch failed with 401" },
    });
  });
});

describe("generateProjectAssets", () => {
  it("leaves a fully rendered project untouched when nothing is missing", async () => {
    db.videoProject.findUnique.mockResolvedValue({ id: "p1", status: "RENDERED", scenes: [complete(0), complete(1)] });
    await expect(generateProjectAssets("p1")).resolves.toMatchObject({ generated: 0, failed: [], status: "RENDERED" });
    expect(db.videoProject.update).not.toHaveBeenCalled();
    expect(db.videoProject.updateMany).not.toHaveBeenCalled();
  });

  it("reports locked scenes that are missing assets instead of regenerating them", async () => {
    db.videoProject.findUnique.mockResolvedValue({
      id: "p1",
      status: "SCRIPTED",
      scenes: [complete(0), { ...complete(1), locked: true, voiceAudioUrl: null }],
    });
    await expect(generateProjectAssets("p1")).resolves.toMatchObject({ generated: 0, skippedLocked: [1] });
    expect(db.scene.findUnique).not.toHaveBeenCalled();
  });
});

describe("scene regeneration guards", () => {
  const scene = (overrides: object, status = "SCRIPTED") => ({
    ...complete(0),
    projectId: "p1",
    narrationText: "Hello",
    project: { id: "p1", status, voice: null, channel: { defaultVoice: "en-US-AriaNeural" } },
    ...overrides,
  });

  it("refuses to touch a locked scene", async () => {
    db.scene.findUnique.mockResolvedValue(scene({ locked: true }));
    await expect(regenerateSceneAudio("scene_0")).rejects.toMatchObject({ code: "LOCKED" });
  });

  it("refuses edits while the project is rendering", async () => {
    db.scene.findUnique.mockResolvedValue(scene({}, "RENDERING"));
    await expect(regenerateSceneAudio("scene_0")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reports a missing scene", async () => {
    db.scene.findUnique.mockResolvedValue(null);
    await expect(regenerateSceneAudio("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
