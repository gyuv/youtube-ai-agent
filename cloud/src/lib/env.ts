import { PipelineError } from "./errors";

/**
 * Read env vars lazily, at call time, so `next build` and unit tests never need secrets
 * and a missing key fails only the feature that uses it.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PipelineError("CONFIG", `${name} is not set. Add it to cloud/.env (see .env.example) or to Vercel.`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string;
export function optionalEnv(name: string): string | undefined;
export function optionalEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}
