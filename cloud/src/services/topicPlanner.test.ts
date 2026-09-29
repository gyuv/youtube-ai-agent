import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "./gemini";
import { buildTopicPrompt, parseTopic, proposeTopic } from "./topicPlanner";

const REQUEST = { niche: "Personal finance", format: "SHORT" as const, recentTopics: ["Why salaries vanish by the 10th"] };

describe("topic planner", () => {
  it("tells Gemini what has already been covered", () => {
    const { system, prompt } = buildTopicPrompt({ ...REQUEST, targetAudience: "young professionals", channelPrompt: "Friendly, no jargon" });
    expect(system).toContain("Personal finance");
    expect(system).toContain("Friendly, no jargon");
    expect(prompt).toContain("- Why salaries vanish by the 10th");
    expect(prompt).toContain("under 60 seconds");
  });

  it("rejects a repeat of a recent topic, ignoring case and punctuation", () => {
    expect(() => parseTopic(JSON.stringify({ topic: "why salaries VANISH by the 10th!", angle: "x" }), REQUEST.recentTopics)).toThrow(/repeated/);
    expect(parseTopic(JSON.stringify({ topic: "  Credit card   grace periods ", angle: "x" }), REQUEST.recentTopics)).toBe("Credit card grace periods");
  });

  it("retries when Gemini repeats itself", async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({ text: JSON.stringify({ topic: "Why salaries vanish by the 10th", angle: "a" }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ topic: "The 50-30-20 budget in 30 seconds", angle: "a" }) });
    const client = { models: { generateContent } } as unknown as GeminiClient;
    await expect(proposeTopic(REQUEST, { client, models: ["m"], retryDelayMs: 0 })).resolves.toEqual({ topic: "The 50-30-20 budget in 30 seconds", model: "m" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
