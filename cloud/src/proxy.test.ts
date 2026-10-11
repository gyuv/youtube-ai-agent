import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ SESSION_COOKIE: "s", verifySessionToken: vi.fn() }));

import { config } from "./proxy";

// Next matches the pattern against the whole path; a path it doesn't match skips the login guard.
const guarded = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

describe("proxy matcher", () => {
  it("lets every bearer-secret worker endpoint past the login guard", () => {
    for (const path of ["/api/render/webhook", "/api/autopilot/tick", "/api/wan2gp/claim", "/api/pinterest/claim", "/api/flow/claim", "/api/flow/complete"]) {
      expect(guarded(path), path).toBe(false);
    }
  });
  it("still guards the studio and its other APIs", () => {
    for (const path of ["/", "/channels/abc", "/api/clips/x"]) expect(guarded(path), path).toBe(true);
  });
});
