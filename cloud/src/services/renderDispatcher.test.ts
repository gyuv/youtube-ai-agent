import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionsRunUrl, dispatchRenderWorkflow } from "./renderDispatcher";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function stubFetch(response: Response) {
  const fetchMock = vi.fn<FetchFn>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("dispatchRenderWorkflow", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_REPO_OWNER", "gyuv");
    vi.stubEnv("GITHUB_REPO_NAME", "youtube-ai-agent");
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "ghp_test");
  });

  it("sends a repository_dispatch carrying only the project id", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    const result = await dispatchRenderWorkflow("proj_123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/gyuv/youtube-ai-agent/dispatches");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer ghp_test",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ event_type: "render-video", client_payload: { project_id: "proj_123" } });
    expect(result.workflowUrl).toBe("https://github.com/gyuv/youtube-ai-agent/actions/workflows/render-video.yml");
  });

  it("explains common GitHub failures", async () => {
    stubFetch(new Response('{"message":"Not Found"}', { status: 404 }));
    await expect(dispatchRenderWorkflow("p")).rejects.toThrow(/404 \(repository not found, or the token has no access/);
  });

  it("refuses to call GitHub without a token", async () => {
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "");
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await expect(dispatchRenderWorkflow("p")).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links to a specific Actions run", () => {
    expect(actionsRunUrl(987)).toBe("https://github.com/gyuv/youtube-ai-agent/actions/runs/987");
  });
});
