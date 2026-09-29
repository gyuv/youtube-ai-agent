import { describe, expect, it, vi } from "vitest";
import { RenderWebhookClient } from "./webhookClient";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const IDS = { projectId: "cabcdefghijklmnopqrstuvw", runId: "42" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function client(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn<FetchFn>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, webhook: new RenderWebhookClient("https://app.example/", "s3cret", IDS, { retryDelayMs: 0 }) };
}

describe("RenderWebhookClient", () => {
  it("posts the event with ids and the bearer secret", async () => {
    const { fetchMock, webhook } = client(json({ ok: true }));
    await webhook.failed({ stage: "render", error: "boom" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example/api/render/webhook");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer s3cret" });
    expect(JSON.parse(String(init?.body))).toEqual({ event: "failed", ...IDS, stage: "render", error: "boom" });
  });

  it("retries network errors and 5xx responses", async () => {
    const { fetchMock, webhook } = client(new Error("ECONNRESET"), json({ error: "cold start" }, 503), json({ ok: true }));
    await expect(webhook.published({ youtubeVideoId: "abcdefghijk" })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a request the app rejected", async () => {
    const { fetchMock, webhook } = client(json({ error: "Another run claimed this project first." }, 409));
    await expect(webhook.started({ runAttempt: 1 })).rejects.toThrow(/409: Another run claimed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
