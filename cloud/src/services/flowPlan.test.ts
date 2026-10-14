import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ videoProject: { findUnique: vi.fn() }, scene: { update: vi.fn() } }));
const wan = vi.hoisted(() => ({ queueSceneClip: vi.fn() }));
const gemini = vi.hoisted(() => ({ generateGeminiJson: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./wan2gp", () => wan);
vi.mock("./gemini", async (importActual) => ({ ...(await importActual<typeof import("./gemini")>()), ...gemini }));

import { PLAN_DECLINED_PREFIX, buildFlowPlanPrompt, buildFlowScenesPrompt, fallbackFlowShot, needsFlowPlan, parseFlowPlan, parseFlowShots, planFlowHook } from "./flowPlan";

const hook = { id: "s0", sceneIndex: 0, narrationText: "This free AI feels illegal", visualPrompt: "a glowing laptop", imageUrl: "img", videoClipUrl: null, aiClipEngine: null, locked: false };
const project = (channel: object = {}) => ({ id: "p1", title: "Free AI", topic: "t", format: "SHORT", channel: { niche: "AI tools", mascotName: null, mascotLook: null, ...channel }, scenes: [hook] });

beforeEach(() => {
  for (const group of [...Object.values(db), wan, gemini]) for (const fn of Object.values(group)) fn.mockReset();
});

describe("planFlowHook", () => {
  it("queues the planned shot for the Flow worker when Script Lab approves it", async () => {
    db.videoProject.findUnique.mockResolvedValue(project());
    gemini.generateGeminiJson.mockResolvedValue({ value: { animate: true, prompt: "Slow push in on the glowing laptop as code streams across the screen", reason: "reveal" } });
    await planFlowHook("p1");
    expect(wan.queueSceneClip).toHaveBeenCalledWith("s0", expect.stringContaining("push in"), "FLOW");
    expect(db.scene.update).not.toHaveBeenCalled();
  });

  it("keeps the still and records the verdict when animating isn't worth the credits", async () => {
    db.videoProject.findUnique.mockResolvedValue(project());
    gemini.generateGeminiJson.mockResolvedValue({ value: { animate: false, prompt: "", reason: "a list of points" } });
    await planFlowHook("p1");
    expect(wan.queueSceneClip).not.toHaveBeenCalled();
    expect(db.scene.update.mock.calls[0][0].data).toMatchObject({ aiClipEngine: "FLOW", aiClipStatus: "FAILED", aiClipError: expect.stringContaining(PLAN_DECLINED_PREFIX) });
  });

  it("refuses to plan twice", async () => {
    db.videoProject.findUnique.mockResolvedValue({ ...project(), scenes: [{ ...hook, aiClipEngine: "FLOW" }] });
    await expect(planFlowHook("p1")).rejects.toThrow(/already/);
  });
});

it("plans only unplanned hooks that have an image and no clip", () => {
  expect(needsFlowPlan(hook)).toBe(true);
  expect(needsFlowPlan({ ...hook, videoClipUrl: "v" })).toBe(false);
  expect(needsFlowPlan({ ...hook, imageUrl: null })).toBe(false);
  expect(needsFlowPlan({ ...hook, locked: true })).toBe(false);
  expect(needsFlowPlan(undefined)).toBe(false);
});

it("writes the shot around the channel host when there is one", () => {
  const { system } = buildFlowPlanPrompt({ niche: "AI", title: "t", hook: "h", imagePrompt: "", nextBeat: "", format: "SHORT", mascot: { name: "Yoyo", look: "a purple robot" } });
  expect(system).toContain("Yoyo");
  expect(system).toContain("a purple robot");
});

it("rejects an approval without a usable prompt", () => {
  expect(() => parseFlowPlan(JSON.stringify({ animate: true, prompt: "go", reason: "x" }))).toThrow(/usable prompt/);
});

describe("Flow shot list", () => {
  it("asks for one consistent cinematic shot per scene", () => {
    const { system, prompt } = buildFlowScenesPrompt({
      niche: "Tamil kids stories",
      title: "The Thirsty Crow",
      format: "SHORT",
      scenes: [{ sceneIndex: 0, narration: "வணக்கம்", imagePrompt: "a crow" }, { sceneIndex: 1, narration: "pebbles", imagePrompt: "pot" }],
      mascot: { name: "Kittu", look: "green parrot" },
    });
    expect(system).toContain("same characters");
    expect(system).toContain("Kittu");
    expect(prompt).toContain("Scene index 1");
  });
  it("parses shots", () => {
    expect(parseFlowShots(JSON.stringify({ shots: [{ sceneIndex: 0, prompt: "A slow dolly toward a thirsty crow on a clay pot." }] }))).toHaveLength(1);
  });
});

describe("fallbackFlowShot", () => {
  it("builds a cinematic shot from the scene prompt, with the host only in scene 0", () => {
    const host = { name: "Kittu", look: "a small brown squirrel" };
    expect(fallbackFlowShot({ sceneIndex: 0, visualPrompt: "a lion roaring in the jungle", narrationText: "x" }, host)).toContain("Kittu, a small brown squirrel");
    const later = fallbackFlowShot({ sceneIndex: 2, visualPrompt: null, narrationText: "an elephant trumpets" }, host);
    expect(later).toContain("an elephant trumpets");
    expect(later).not.toContain("Kittu");
  });
});
