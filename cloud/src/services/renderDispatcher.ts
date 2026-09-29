import { requireEnv } from "@/lib/env";
import { PipelineError, errorMessage } from "@/lib/errors";

/**
 * Starts the cloud renderer: a `repository_dispatch` event that .github/workflows/render-video.yml
 * listens for. GitHub only runs repository_dispatch workflows from the default branch.
 *
 * The payload carries only the project id. The runner reads everything else (scenes, format,
 * auto-publish) from the database and gets the callback URL from a repository secret, so a
 * dispatched payload can never redirect where the runner sends its webhook secret.
 */

export const RENDER_EVENT_TYPE = "render-video";
export const RENDER_WORKFLOW_FILE = "render-video.yml";

const GITHUB_API = "https://api.github.com";

function repo() {
  return { owner: requireEnv("GITHUB_REPO_OWNER"), name: requireEnv("GITHUB_REPO_NAME") };
}

export function actionsWorkflowUrl(): string {
  const { owner, name } = repo();
  return `https://github.com/${owner}/${name}/actions/workflows/${RENDER_WORKFLOW_FILE}`;
}

export function actionsRunUrl(runId: string | number): string {
  const { owner, name } = repo();
  return `https://github.com/${owner}/${name}/actions/runs/${encodeURIComponent(String(runId))}`;
}

const STATUS_HINTS: Record<number, string> = {
  401: "GITHUB_DISPATCH_TOKEN is invalid or expired",
  403: 'the token needs "Contents: read and write" on this repository',
  404: "repository not found, or the token has no access to it",
  422: "GitHub rejected the dispatch payload",
};

/** Fire a `repository_dispatch` event; the payload must stay small and free of secrets. */
export async function dispatchRepositoryEvent(eventType: string, clientPayload: Record<string, string>): Promise<void> {
  const { owner, name } = repo();
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}/repos/${owner}/${name}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${requireEnv("GITHUB_DISPATCH_TOKEN")}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "lumen-cloud",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("PROVIDER", `Could not reach the GitHub API: ${errorMessage(error)}`, { cause: error });
  }

  if (res.status !== 204) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim(); // one line for logs
    const hint = STATUS_HINTS[res.status] ? ` (${STATUS_HINTS[res.status]})` : "";
    throw new PipelineError("PROVIDER", `GitHub dispatch failed with ${res.status}${hint}: ${detail.slice(0, 200)}`);
  }
}

export async function dispatchRenderWorkflow(projectId: string): Promise<{ dispatchedAt: Date; workflowUrl: string }> {
  await dispatchRepositoryEvent(RENDER_EVENT_TYPE, { project_id: projectId });
  return { dispatchedAt: new Date(), workflowUrl: actionsWorkflowUrl() };
}

export const AUTOPILOT_EVENT_TYPE = "autopilot";
export const AUTOPILOT_WORKFLOW_FILE = "autopilot.yml";

/** Start an autopilot run now instead of waiting for the next scheduled one. */
export async function dispatchAutopilotRun(): Promise<{ workflowUrl: string }> {
  await dispatchRepositoryEvent(AUTOPILOT_EVENT_TYPE, { requested_by: "studio" });
  const { owner, name } = repo();
  return { workflowUrl: `https://github.com/${owner}/${name}/actions/workflows/${AUTOPILOT_WORKFLOW_FILE}` };
}
