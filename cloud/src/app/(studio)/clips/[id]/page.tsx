import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PipelineError } from "@/lib/errors";
import { getClipJob } from "@/services/clipJobs";
import { actionsRunUrl } from "@/services/renderDispatcher";
import { AutoRefresh } from "../../projects/[id]/_components/auto-refresh";
import { ClipReview } from "./clip-review";

export const metadata: Metadata = { title: "Clip job" };
export const dynamic = "force-dynamic";

export default async function ClipJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getClipJob(id).catch((error) => {
    if (error instanceof PipelineError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  let runUrl: string | null = null;
  try {
    runUrl = job.renderRunId ? actionsRunUrl(job.renderRunId) : null;
  } catch {
    runUrl = null; // GitHub repo env vars not set
  }
  return (
    <>
      <AutoRefresh active={job.status === "RENDERING"} />
      <PageHeader
        title={job.sourceTitle}
        description={
          <>
            {job.channel.name} · moments found from the {job.momentSource === "video" ? "video itself (YouTube blocked the transcript)" : "transcript"} ·{" "}
            <a href={`https://youtu.be/${job.videoId}`} target="_blank" rel="noreferrer" className="underline">
              source video
            </a>
            {runUrl ? (
              <>
                {" "}·{" "}
                <a href={runUrl} target="_blank" rel="noreferrer" className="underline">
                  worker log
                </a>
              </>
            ) : null}
          </>
        }
      />
      <ClipReview
        // Remount when the worker changes anything, so local edits never hide fresh server state.
        key={`${job.status}:${job.moments.map((m) => `${m.status}${m.videoUrl ?? ""}`).join(",")}`}
        job={{
          id: job.id,
          videoId: job.videoId,
          status: job.status,
          layout: job.layout,
          burnCaptions: job.burnCaptions,
          durationSeconds: job.durationSeconds,
          lastError: job.lastError,
          moments: job.moments,
        }}
      />
    </>
  );
}
