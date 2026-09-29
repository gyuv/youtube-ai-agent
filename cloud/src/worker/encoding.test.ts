import { describe, expect, it } from "vitest";
import { planEncoding } from "./encoding";

const MB = 1024 * 1024;

describe("planEncoding", () => {
  it("caps a 60s Short so it fits Supabase's 50 MB free-tier limit", () => {
    const plan = planEncoding(60, 50 * MB, "SHORT");
    const worstCaseBytes = ((plan.maxVideoBps + 128_000) * 60) / 8;
    expect(worstCaseBytes).toBeLessThan(50 * MB);
    expect(plan.encodingMaxRate).toMatch(/^\d+k$/);
    expect(plan.encodingBufferSize).toBe(`${Math.floor((plan.maxVideoBps * 2) / 1000)}k`);
    expect(plan.crf).toBe(20);
  });

  it("uses the 1080p quality ceiling when storage is roomy (R2)", () => {
    expect(planEncoding(480, 5 * 1024 * MB, "LONG_FORM").maxVideoBps).toBe(8_000_000);
    expect(planEncoding(30, 5 * 1024 * MB, "SHORT").maxVideoBps).toBe(10_000_000);
  });

  it("refuses long-form that would be unwatchable at 50 MB and says how to fix it", () => {
    expect(() => planEncoding(480, 50 * MB, "LONG_FORM")).toThrow(/STORAGE_DRIVER=r2/);
  });

  it("rejects empty timelines", () => {
    expect(() => planEncoding(0, 50 * MB, "SHORT")).toThrow(/empty/);
  });
});
