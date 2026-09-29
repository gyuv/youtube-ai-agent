export type PipelineErrorCode =
  | "NOT_FOUND" // project/scene does not exist
  | "CONFLICT" // action not allowed in the project's current status
  | "LOCKED" // scene is locked by an operator
  | "CONFIG" // a required environment variable is missing
  | "PROVIDER"; // an upstream free service (Gemini, edge-tts, Pexels, GitHub...) failed

const HTTP_STATUS: Record<PipelineErrorCode, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  LOCKED: 423,
  CONFIG: 500,
  PROVIDER: 502,
};

/** Error carrying enough context for API routes to answer with the right status code. */
export class PipelineError extends Error {
  readonly code: PipelineErrorCode;

  constructor(code: PipelineErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PipelineError";
    this.code = code;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
