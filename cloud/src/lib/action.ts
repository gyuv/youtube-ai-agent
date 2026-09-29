import { unstable_rethrow } from "next/navigation";
import { ZodError, z } from "zod";
import { PipelineError } from "./errors";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Run a server action body and turn expected failures into a message the studio can show. */
export async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    unstable_rethrow(error); // let redirect()/notFound() through
    if (error instanceof ZodError) return { ok: false, error: z.prettifyError(error) };
    if (error instanceof PipelineError) return { ok: false, error: error.message };
    console.error("Studio action failed", error);
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
