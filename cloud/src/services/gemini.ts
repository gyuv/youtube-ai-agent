import { GoogleGenAI } from "@google/genai";
import { optionalEnv, requireEnv } from "@/lib/env";
import { PipelineError, errorMessage } from "@/lib/errors";

/**
 * Structured-JSON calls to Gemini on the free tier, shared by the script writer and the
 * autopilot's topic planner. Each model gets two tries (a malformed answer is retried once),
 * then GEMINI_FALLBACK_MODEL, because free-tier quotas are per model.
 */

export type GeminiClient = { models: Pick<GoogleGenAI["models"], "generateContent"> };

export function geminiModels(): string[] {
  return [...new Set([optionalEnv("GEMINI_MODEL", "gemini-3.7-flash"), optionalEnv("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite")])];
}

/** Gemini's structured output accepts a JSON-Schema subset; drop keywords it may reject. */
const UNSUPPORTED_SCHEMA_KEYS = new Set(["$schema", "minLength", "maxLength", "pattern"]);

export function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYS.has(key))
        .map(([key, value]) => [key, sanitizeSchema(value)]),
    );
  }
  return node;
}

/** Strip a markdown fence and parse, with an error message that shows what came back. */
export function parseJsonText(text: string | undefined): unknown {
  if (!text?.trim()) throw new Error("Gemini returned an empty response");
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${json.slice(0, 120)}...`);
  }
}

export interface GeminiJsonRequest<T> {
  /** Used in the final error, e.g. "Script generation". */
  task: string;
  systemInstruction: string;
  prompt: string;
  /** Extra parts sent before the prompt, e.g. a YouTube video as `{ fileData: { fileUri, mimeType } }`. */
  parts?: unknown[];
  /** Extra generation config, e.g. `{ mediaResolution }` for video input. */
  config?: Record<string, unknown>;
  responseJsonSchema: unknown;
  /** Validate and shape the raw text; throwing retries the call. */
  parse: (text: string | undefined) => T;
  client?: GeminiClient;
  models?: string[];
  retryDelayMs?: number;
}

function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateGeminiJson<T>(request: GeminiJsonRequest<T>): Promise<{ model: string; value: T }> {
  const client = request.client ?? new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
  const models = [...new Set(request.models ?? geminiModels())];
  const retryDelayMs = request.retryDelayMs ?? 1500;
  const failures: string[] = [];

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: request.parts?.length
            ? ([{ role: "user", parts: [...request.parts, { text: request.prompt }] }] as never)
            : request.prompt,
          config: {
            ...request.config,
            systemInstruction: request.systemInstruction,
            responseMimeType: "application/json",
            responseJsonSchema: request.responseJsonSchema,
          },
        });
        return { model, value: request.parse(response.text) };
      } catch (error) {
        const status = httpStatusOf(error);
        failures.push(`${model} (attempt ${attempt}): ${errorMessage(error)}`);
        if (status === 400 || status === 401 || status === 403) {
          // Bad key, disabled API or malformed request: retrying or switching models won't help.
          throw new PipelineError("PROVIDER", `Gemini rejected the request (${status}): ${errorMessage(error)}`, { cause: error });
        }
        if (status === 429 || status === 404) break; // quota exhausted or model retired: next model
        if (attempt < 2) await sleep(retryDelayMs * attempt);
      }
    }
  }
  throw new PipelineError("PROVIDER", `${request.task} failed on every Gemini model:\n${failures.join("\n")}`);
}
