import { timeAgo } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

/**
 * Live Google Flow progress for a channel: every video waiting on Flow clips, how many are done,
 * which one the worker is making right now, and the last error of any that failed (they are asked
 * for again automatically). The worker makes one clip at a time, oldest request first.
 */
export async function FlowQueue({ channelId }: { channelId: string }) {
  const now = new Date();
  const projects = await prisma.videoProject.findMany({
    where: { channelId, youtubeVideoId: null, status: { notIn: ["PUBLISHED"] }, scenes: { some: { aiClipEngine: "FLOW" } } },
    orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }],
    select: {
      id: true,
      title: true,
      topic: true,
      status: true,
      scheduledFor: true,
      scenes: { orderBy: { sceneIndex: "asc" }, select: { sceneIndex: true, aiClipEngine: true, aiClipStatus: true, aiClipError: true, aiClipUpdatedAt: true, videoClipUrl: true } },
    },
  });
  if (!projects.length) return <p className="text-xs text-muted-foreground">No videos are waiting on Flow clips.</p>;

  const queuedEverywhere = await prisma.scene.count({ where: { aiClipEngine: "FLOW", aiClipStatus: "QUEUED" } });
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        The worker makes one clip at a time, oldest first: {queuedEverywhere} clip{queuedEverywhere === 1 ? "" : "s"} waiting in all. A video renders and
        is scheduled once every scene is done.
      </p>
      {projects.map((p) => {
        const flow = p.scenes.filter((s) => s.aiClipEngine === "FLOW");
        const done = flow.filter((s) => !s.aiClipStatus && s.videoClipUrl).length;
        const running = flow.find((s) => s.aiClipStatus === "RUNNING");
        const failed = flow.filter((s) => s.aiClipStatus === "FAILED");
        return (
          <div key={p.id} className="rounded-2xl border bg-white/[0.02] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium">{p.title ?? p.topic}</p>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {done}/{p.scenes.length} clips
              </span>
            </div>
            <div className="mt-2 flex gap-1">
              {p.scenes.map((s) => {
                const state = s.aiClipEngine !== "FLOW" ? "none" : s.aiClipStatus ?? (s.videoClipUrl ? "done" : "none");
                return (
                  <span
                    key={s.sceneIndex}
                    title={`Scene ${s.sceneIndex + 1}: ${state.toLowerCase()}`}
                    className={cn(
                      "h-2 flex-1 rounded-full",
                      state === "done" && "bg-emerald-400",
                      state === "RUNNING" && "animate-pulse bg-sky-400",
                      state === "QUEUED" && "bg-white/20",
                      state === "FAILED" && "bg-amber-400",
                      state === "none" && "bg-white/10",
                    )}
                  />
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {done === p.scenes.length
                ? "All clips done: renders on the next hourly autopilot run."
                : running
                  ? `Making scene ${running.sceneIndex + 1} now (started ${running.aiClipUpdatedAt ? timeAgo(running.aiClipUpdatedAt, now) : "just now"}).`
                  : "Waiting for its turn."}
              {failed.length
                ? ` ${failed.length} scene${failed.length === 1 ? "" : "s"} failed and will be asked for again within the hour: ${(failed[0].aiClipError ?? "").slice(0, 160)}`
                : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
