import {
  RENDER_WEBHOOK_PATH,
  type AckResponse,
  type RenderEvent,
  type RenderedResponse,
  type StartedResponse,
} from "@/services/renderContract";

type EventBody<E extends RenderEvent["event"]> = Omit<Extract<RenderEvent, { event: E }>, "event" | "projectId" | "runId">;

export class WebhookError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "WebhookError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The render worker's line back to the Next.js app. Retries transient failures only. */
export class RenderWebhookClient {
  constructor(
    private readonly appUrl: string,
    private readonly secret: string,
    private readonly ids: { projectId: string; runId: string },
    private readonly options: { attempts?: number; retryDelayMs?: number } = {},
  ) {}

  private async send<T>(event: RenderEvent["event"], body: object): Promise<T> {
    const url = `${this.appUrl.replace(/\/+$/, "")}${RENDER_WEBHOOK_PATH}`;
    const attempts = this.options.attempts ?? 4;
    let lastError: WebhookError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" },
          body: JSON.stringify({ event, ...this.ids, ...body }),
          signal: AbortSignal.timeout(60_000),
        });
        const text = await res.text();
        if (res.ok) return JSON.parse(text) as T;
        let detail = text.slice(0, 500);
        try {
          detail = (JSON.parse(text) as { error?: string }).error ?? detail;
        } catch {
          // non-JSON error page (e.g. a Vercel 5xx)
        }
        lastError = new WebhookError(`${event} webhook returned ${res.status}: ${detail}`, res.status);
        if (res.status < 500 && res.status !== 429) throw lastError; // our request is wrong; retrying won't help
      } catch (error) {
        if (error instanceof WebhookError && error.status !== null && error.status < 500 && error.status !== 429) throw error;
        lastError = error instanceof WebhookError ? error : new WebhookError(`${event} webhook unreachable: ${String(error)}`, null);
      }
      if (attempt < attempts) await sleep((this.options.retryDelayMs ?? 2000) * 2 ** (attempt - 1));
    }
    throw lastError ?? new WebhookError(`${event} webhook failed`, null);
  }

  started(body: EventBody<"started">) {
    return this.send<StartedResponse>("started", body);
  }

  rendered(body: EventBody<"rendered">) {
    return this.send<RenderedResponse>("rendered", body);
  }

  published(body: EventBody<"published">) {
    return this.send<AckResponse>("published", body);
  }

  failed(body: EventBody<"failed">) {
    return this.send<AckResponse>("failed", body);
  }
}
