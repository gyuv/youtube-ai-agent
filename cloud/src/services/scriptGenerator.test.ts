import { describe, expect, it, vi } from "vitest";
import { PipelineError } from "@/lib/errors";
import {
  GEMINI_RESPONSE_SCHEMA,
  buildChapters,
  estimateSpeechSeconds,
  generateScript,
  parseScriptResponse,
  planScenes,
  type GeminiClient,
  type VideoScript,
} from "./scriptGenerator";

const beat = (narration: string) => ({ narration, imagePrompt: `Cinematic shot for: ${narration}`, stockQuery: "city night" });

const SCRIPT: VideoScript = {
  title: "Why Cities Never Sleep",
  description: "A look at the night shift that keeps cities alive.\n\n#cities #night",
  tags: ["cities", "night life"],
  hook: beat("Right now, while you sleep, a whole second city is waking up."),
  sections: [
    { heading: "The Night Shift", ...beat("Nurses, bakers and train crews start their day when yours ends.") },
    { heading: "Power Grid", ...beat("Electricity demand drops at night, so engineers schedule repairs then.") },
  ],
  cta: beat("Follow for more hidden systems that run your world."),
};

function fakeClient(...responses: Array<string | Error>): GeminiClient & { calls: Array<{ model: string }> } {
  const calls: Array<{ model: string }> = [];
  const generateContent = vi.fn(async (req: { model: string }) => {
    calls.push({ model: req.model });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { text: next };
  });
  return { models: { generateContent }, calls } as unknown as GeminiClient & { calls: Array<{ model: string }> };
}

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

const REQUEST = { topic: "Cities at night", niche: "urban explainers", format: "SHORT" as const };

describe("planScenes", () => {
  it("flattens hook, sections and CTA in play order with running timestamps", () => {
    const scenes = planScenes(SCRIPT);
    expect(scenes.map((s) => s.kind)).toEqual(["hook", "section", "section", "cta"]);
    expect(scenes.map((s) => s.sceneIndex)).toEqual([0, 1, 2, 3]);
    expect(scenes[1].heading).toBe("The Night Shift");
    expect(scenes[0].startSeconds).toBe(0);
    for (let i = 1; i < scenes.length; i++) expect(scenes[i].startSeconds).toBe(scenes[i - 1].endSeconds);
  });

  it("estimates speech at ~2.5 words per second with a floor", () => {
    expect(estimateSpeechSeconds("one two three four five")).toBe(2);
    expect(estimateSpeechSeconds("hi")).toBe(1.5);
  });
});

describe("parseScriptResponse", () => {
  it("accepts JSON wrapped in a markdown fence", () => {
    const parsed = parseScriptResponse("```json\n" + JSON.stringify(SCRIPT) + "\n```");
    expect(parsed.sections).toHaveLength(2);
  });

  it("rejects invalid JSON and schema mismatches", () => {
    expect(() => parseScriptResponse("not json")).toThrow(/invalid JSON/);
    expect(() => parseScriptResponse(JSON.stringify({ ...SCRIPT, sections: [] }))).toThrow(/schema/);
    expect(() => parseScriptResponse(undefined)).toThrow(/empty/);
  });

  it("enforces YouTube metadata limits", () => {
    const parsed = parseScriptResponse(
      JSON.stringify({
        ...SCRIPT,
        title: "x".repeat(150),
        tags: ["#cities", "cities", "<b>night</b>", ...Array.from({ length: 19 }, (_, i) => `tag number ${i} ${"y".repeat(20)}`)],
      }),
    );
    expect(parsed.title).toHaveLength(100);
    expect(parsed.tags[0]).toBe("cities");
    expect(parsed.tags.filter((t) => t === "cities")).toHaveLength(1);
    expect(parsed.tags).toContain("bnight/b");
    const counted = parsed.tags.reduce((n, t, i) => n + t.length + (t.includes(" ") ? 2 : 0) + (i ? 1 : 0), 0);
    expect(counted).toBeLessThanOrEqual(500);
  });
});

describe("GEMINI_RESPONSE_SCHEMA", () => {
  it("omits JSON-Schema keywords Gemini may reject", () => {
    const json = JSON.stringify(GEMINI_RESPONSE_SCHEMA);
    expect(json).not.toMatch(/"\$schema"|"minLength"|"maxLength"|"pattern"/);
    expect(json).toContain('"required"');
  });
});

describe("generateScript", () => {
  it("returns planned scenes and a stored script on success", async () => {
    const client = fakeClient(JSON.stringify(SCRIPT));
    const result = await generateScript(REQUEST, { client, models: ["m1"] });
    expect(result.model).toBe("m1");
    expect(result.scenes).toHaveLength(4);
    expect(result.stored.version).toBe(1);
    expect(result.stored.timestamps).toHaveLength(4);

    const request = vi.mocked(client.models.generateContent).mock.calls[0][0];
    expect(request.config?.responseMimeType).toBe("application/json");
    expect(request.config?.systemInstruction).toContain("urban explainers");
    expect(request.contents).toContain("YouTube Short");
  });

  it("retries a malformed response on the same model", async () => {
    const client = fakeClient("{oops", JSON.stringify(SCRIPT));
    const result = await generateScript(REQUEST, { client, models: ["m1"], retryDelayMs: 0 });
    expect(client.calls.map((c) => c.model)).toEqual(["m1", "m1"]);
    expect(result.scenes).toHaveLength(4);
  });

  it("moves to the fallback model when the main one is rate limited", async () => {
    const client = fakeClient(apiError(429, "quota"), JSON.stringify(SCRIPT));
    const result = await generateScript(REQUEST, { client, models: ["main", "lite"], retryDelayMs: 0 });
    expect(client.calls.map((c) => c.model)).toEqual(["main", "lite"]);
    expect(result.model).toBe("lite");
  });

  it("fails fast on an invalid API key", async () => {
    const client = fakeClient(apiError(401, "API key not valid"));
    await expect(generateScript(REQUEST, { client, models: ["main", "lite"] })).rejects.toThrow(/rejected the request \(401\)/);
    expect(client.calls).toHaveLength(1);
  });

  it("reports every attempt when all models fail", async () => {
    const client = fakeClient("bad", "bad", "bad", "bad");
    const error = await generateScript(REQUEST, { client, models: ["a", "b"], retryDelayMs: 0 }).catch((e) => e);
    expect(error).toBeInstanceOf(PipelineError);
    expect(error.code).toBe("PROVIDER");
    expect(error.message).toMatch(/a \(attempt 1\)[\s\S]*b \(attempt 2\)/);
  });
});

describe("buildChapters", () => {
  const long: VideoScript = {
    ...SCRIPT,
    sections: [
      { heading: "Part One", ...beat("a") },
      { heading: "Part One", ...beat("b") },
      { heading: "Part Two", ...beat("c") },
      { heading: "Part Three", ...beat("d") },
    ],
  };

  it("builds 0:00-anchored chapters and merges repeated headings", () => {
    // durations: intro, p1, p1, p2, p3, cta
    expect(buildChapters(long, [12, 30, 30, 45, 60, 8])).toEqual([
      "0:00 Intro",
      "0:12 Part One",
      "1:12 Part Two",
      "1:57 Part Three",
    ]);
  });

  it("returns nothing when YouTube's chapter rules can't be met", () => {
    expect(buildChapters(SCRIPT, [3, 4, 4, 3])).toEqual([]);
  });
});
