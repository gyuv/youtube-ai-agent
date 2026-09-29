import { Bot, ChevronLeft, CircleAlert, ExternalLink, Github, Lock, Radio, Youtube } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { timeAgo } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectStatus } from "@/generated/prisma/enums";
import { EDITABLE_STATUSES, IN_FLIGHT_STATUSES, RENDERABLE_STATUSES } from "@/lib/statuses";
import { sceneHasAssets } from "@/services/pipeline";
import { getStudioProject } from "@/services/projects";
import { actionsRunUrl } from "@/services/renderDispatcher";
import { formatSlot } from "@/services/schedule";
import { AUDIT_FORM_URL } from "@/services/youtubeVisibility";
import { AutoRefresh } from "./_components/auto-refresh";
import { MetadataForm } from "./_components/metadata-form";
import { PreviewPlayer } from "./_components/preview-player";
import { SceneCard } from "./_components/scene-card";
import { StudioToolbar } from "./_components/studio-toolbar";
import { TimelineStrip } from "./_components/timeline-strip";
import { formatDuration, type StudioScene } from "./_components/types";
import { VisibilityCheck } from "./_components/visibility-check";

export const dynamic = "force-dynamic";
// Gemini, edge-tts and Pollinations calls run inside this page's server actions.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ autoscript?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const project = await getStudioProject((await params).id);
  return { title: `${project?.title ?? project?.topic ?? "Project"} · Lumen Cloud` };
}

const Words = z.array(z.object({ word: z.string(), startMs: z.number(), endMs: z.number() }));
const ScriptOutline = z.object({ timestamps: z.array(z.object({ kind: z.string(), heading: z.string().nullable() })) });

export default async function StudioPage({ params, searchParams }: Params) {
  const [{ id }, { autoscript }] = await Promise.all([params, searchParams]);
  const project = await getStudioProject(id);
  if (!project) notFound();

  // Hook/CTA labels come from the script outline while scenes still mirror it.
  const outline = ScriptOutline.safeParse(project.script);
  const beats = outline.success && outline.data.timestamps.length === project.scenes.length ? outline.data.timestamps : null;

  const scenes: StudioScene[] = project.scenes.map((s, i) => {
    const words = Words.safeParse(s.wordTimings);
    const beat = beats?.[i];
    return {
      id: s.id,
      sceneIndex: s.sceneIndex,
      kind: beat?.kind === "hook" ? "Hook" : beat?.kind === "cta" ? "Call to action" : null,
      heading: beat?.heading ?? null,
      narrationText: s.narrationText,
      voiceAudioUrl: s.voiceAudioUrl,
      words: words.success ? words.data : [],
      visualPrompt: s.visualPrompt,
      stockQuery: s.stockQuery,
      imageUrl: s.imageUrl,
      videoClipUrl: s.videoClipUrl,
      visualSource: s.visualSource,
      durationSeconds: s.durationSeconds,
      locked: s.locked,
      ready: sceneHasAssets(s),
      updatedAt: s.updatedAt.toISOString(),
    };
  });

  const editable = EDITABLE_STATUSES.includes(project.status);
  const inFlight = IN_FLIGHT_STATUSES.includes(project.status);
  const readyCount = scenes.filter((s) => s.ready).length;
  const pending = scenes.filter((s) => !s.ready && !s.locked).map((s) => ({ id: s.id, sceneIndex: s.sceneIndex }));
  const renderBlocker = inFlight
    ? "A render is already running"
    : project.status === ProjectStatus.PUBLISHED
      ? "This video is already published"
      : scenes.length === 0
        ? "Write the script first"
        : readyCount < scenes.length
          ? `${scenes.length - readyCount} scene(s) still need a voice or a visual`
          : !RENDERABLE_STATUSES.includes(project.status)
            ? `Can't render from ${project.status}`
            : null;

  let runUrl: string | null = null;
  try {
    runUrl = project.renderRunId ? actionsRunUrl(project.renderRunId) : null;
  } catch {
    runUrl = null; // GitHub env not configured on this deployment
  }
  const totalSeconds = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);

  return (
    <>
      <AutoRefresh active={inFlight} />
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Dashboard
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={project.status} />
            {project.autopilot ? (
              <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium" title="Created and advanced by the autopilot">
                <Bot className="size-3" /> Autopilot
              </span>
            ) : null}
            <span className="text-sm text-muted-foreground">
              <Link href={`/channels/${project.channelId}`} className="hover:text-foreground hover:underline">
                {project.channel.name}
              </Link>{" "}
              · {project.format === "SHORT" ? "Short 9:16" : "Long-form 16:9"}
              {scenes.length ? ` · ${scenes.length} scenes · ${formatDuration(totalSeconds)}` : ""} · cost ${Number(project.cost).toFixed(2)}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{project.title ?? project.topic}</h1>
          {project.title ? <p className="mt-1 text-sm text-muted-foreground">{project.topic}</p> : null}
        </div>
        {project.scheduledFor ? (
          <div className="rounded-lg border px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Scheduled</div>
            {formatSlot(project.scheduledFor, project.channel.postingTimezone)}
          </div>
        ) : null}
      </div>

      <StudioToolbar
        projectId={project.id}
        editable={editable}
        inFlight={inFlight}
        sceneCount={scenes.length}
        lockedCount={scenes.filter((s) => s.locked).length}
        pending={pending}
        renderBlocker={renderBlocker}
        autoScript={autoscript === "1"}
      />

      {inFlight ? (
        <Alert variant="warning" className="mb-6">
          <Radio className="animate-pulse" />
          <AlertTitle>{project.status === ProjectStatus.QUEUED_FOR_RENDER ? "Waiting for a GitHub runner…" : "Rendering in the cloud…"}</AlertTitle>
          <AlertDescription>
            Scenes are frozen until the render finishes. This page refreshes on its own.
            {runUrl ? (
              <>
                {" "}
                <a href={runUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  Watch the run on GitHub
                </a>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {project.autopilot && project.channel.autopilotReview && project.status === ProjectStatus.ASSETS_READY ? (
        <Alert className="mb-6">
          <Bot />
          <AlertTitle>Ready for your review</AlertTitle>
          <AlertDescription>
            The autopilot prepared every scene and is waiting for you. Watch the preview, repair anything, then Dispatch Cloud Render.
          </AlertDescription>
        </Alert>
      ) : null}
      {project.status === ProjectStatus.PUBLISHED && project.youtubeLocked ? (
        <Alert variant="warning" className="mb-6">
          <Lock />
          <AlertTitle>YouTube kept this video private</AlertTitle>
          <AlertDescription className="grid gap-2">
            <p>
              You asked for {project.privacy === "PUBLIC" ? "Public" : "Unlisted"}, but YouTube reports the video as private. YouTube does this to every
              upload from a Google Cloud project that hasn&apos;t passed the YouTube API Services audit: the video is locked private, whatever the
              request said.
            </p>
            <ul className="list-disc pl-5">
              <li>
                <a href={AUDIT_FORM_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  Apply for the audit
                </a>{" "}
                with the Google Cloud project that holds your OAuth client. Once approved, new uploads keep the visibility you choose.
              </li>
              <li>Until then, download the rendered MP4 below and upload it yourself in YouTube Studio, then delete the locked copy.</li>
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <VisibilityCheck projectId={project.id} variant="secondary" />
              {project.youtubeCheckedAt ? <span className="text-xs">Checked {timeAgo(project.youtubeCheckedAt)}</span> : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {project.lastError ? (
        <Alert variant="destructive" className="mb-6">
          <CircleAlert />
          <AlertTitle>{project.status === ProjectStatus.FAILED ? "Render failed" : "Needs attention"}</AlertTitle>
          <AlertDescription>{project.lastError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="grid min-w-0 gap-6">
          <PreviewPlayer format={project.format} scenes={scenes} />
          {project.renderedVideoUrl || project.youtubeVideoId ? (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Output</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {project.youtubeVideoId ? (
                  <a href={`https://youtu.be/${project.youtubeVideoId}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
                    <Youtube className="size-4 text-red-500" /> Watch on YouTube <ExternalLink className="size-3" />
                  </a>
                ) : null}
                {project.renderedVideoUrl ? (
                  <a href={project.renderedVideoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
                    <ExternalLink className="size-4" /> Rendered MP4
                  </a>
                ) : null}
                {runUrl ? (
                  <a href={runUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-muted-foreground hover:text-foreground hover:underline">
                    <Github className="size-4" /> Render log
                  </a>
                ) : null}
                {project.status === ProjectStatus.PUBLISHED && project.youtubeVideoId && !project.youtubeLocked ? (
                  <div className="mt-1">
                    <VisibilityCheck projectId={project.id} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <MetadataForm
            projectId={project.id}
            title={project.title ?? ""}
            description={project.description ?? ""}
            tags={project.tags}
            privacy={project.privacy}
            scheduledFor={project.scheduledFor?.toISOString() ?? null}
            readOnly={project.status === ProjectStatus.PUBLISHED}
          />
        </aside>

        <section className="grid min-w-0 gap-4" aria-label="Scenes">
          {scenes.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No scenes yet. <strong className="text-foreground">Write script with Gemini</strong> turns the topic into a hook, scenes and a call to action.
            </div>
          ) : (
            <>
              <TimelineStrip scenes={scenes} />
              {scenes.map((scene) => (
                // Remount when the server copy changes so local edits never shadow fresh data.
                <SceneCard key={`${scene.id}-${scene.updatedAt}`} projectId={project.id} scene={scene} format={project.format} editable={editable} />
              ))}
            </>
          )}
        </section>
      </div>
    </>
  );
}
