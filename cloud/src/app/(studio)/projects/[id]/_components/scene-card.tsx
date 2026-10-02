"use client";

import { Check, CircleAlert, Clapperboard, Film, ImageIcon, LoaderCircle, Lock, Mic, Save, Search, Sparkles, X } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Switch, Textarea } from "@/components/ui/form-controls";
import type { ActionResult } from "@/lib/action";
import { cn } from "@/lib/utils";
import { cancelAiClipAction, queueAiClipAction, regenerateAudioAction, regenerateVisualAction, saveNarrationAction, setSceneLockedAction } from "../../actions";
import type { StudioScene } from "./types";

type Busy = "save" | "voice" | "visual" | "clip" | "lock" | null;
type Source = "POLLINATIONS" | "PEXELS" | "PINTEREST" | "WAN2GP";

function initialSource(scene: StudioScene): Source {
  if (scene.aiClipEngine === "PINTEREST" || scene.visualSource === "PINTEREST") return "PINTEREST";
  if (scene.aiClipStatus || scene.visualSource === "WAN2GP" || scene.visualSource === "MUAPI") return "WAN2GP";
  return scene.visualSource === "PEXELS" ? "PEXELS" : "POLLINATIONS";
}

export function SceneCard({
  projectId,
  scene,
  format,
  editable,
  muapi,
}: {
  projectId: string;
  scene: StudioScene;
  format: "SHORT" | "LONG_FORM";
  editable: boolean;
  /** Muapi image-to-video models, or null when MUAPI_API_KEY isn't set. */
  muapi: Array<{ endpoint: string; label: string }> | null;
}) {
  const [text, setText] = useState(scene.narrationText);
  const [prompt, setPrompt] = useState(scene.visualPrompt ?? "");
  const [query, setQuery] = useState(scene.stockQuery ?? "");
  const [source, setSource] = useState<Source>(initialSource(scene));
  const [clipPrompt, setClipPrompt] = useState(scene.aiClipPrompt ?? scene.visualPrompt ?? "");
  const [engine, setEngine] = useState<"WAN2GP" | "MUAPI">(scene.aiClipEngine === "MUAPI" || (muapi && scene.visualSource === "MUAPI") ? "MUAPI" : "WAN2GP");
  const [muapiModel, setMuapiModel] = useState(muapi?.[0]?.endpoint ?? "");
  const [busy, setBusy] = useState<Busy>(null);
  const [, startTransition] = useTransition();
  // The switch flips immediately and falls back to the server value if the action fails.
  const [locked, setOptimisticLocked] = useOptimistic(scene.locked);

  const label = `Scene ${scene.sceneIndex + 1}`;
  const dirty = text.trim() !== scene.narrationText;
  const disabled = !editable || locked || busy !== null;

  const run = (kind: Exclude<Busy, null>, action: () => Promise<ActionResult<unknown>>, success: string, optimistic?: () => void) => {
    setBusy(kind);
    startTransition(async () => {
      optimistic?.();
      const result = await action();
      setBusy(null);
      if (result.ok) toast.success(success);
      else toast.error(`${label}: ${result.error}`);
    });
  };

  const spinner = (kind: Busy, icon: React.ReactNode) => (busy === kind ? <LoaderCircle className="animate-spin" /> : icon);

  return (
    <article
      id={`scene-${scene.id}`}
      className={cn("scroll-mt-24 rounded-xl border bg-card p-4 transition-colors", locked && "border-dashed bg-muted/20", !scene.ready && !locked && "border-amber-500/40")}
    >
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-semibold">{label}</h3>
        {scene.kind ? <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium">{scene.kind}</span> : null}
        {scene.heading ? <span className="truncate text-sm text-muted-foreground">{scene.heading}</span> : null}
        <span className="text-xs tabular-nums text-muted-foreground">{scene.durationSeconds.toFixed(1)}s</span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          <Readiness ok={Boolean(scene.voiceAudioUrl)} label="Voice" />
          <Readiness ok={Boolean(scene.imageUrl || scene.videoClipUrl)} label="Visual" />
        </span>
        <Label className="gap-2 text-xs font-normal text-muted-foreground" title="Locked scenes are skipped by bulk generation and can't be regenerated">
          {busy === "lock" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
          Lock
          <Switch
            checked={locked}
            disabled={!editable || busy !== null}
            onChange={(e) => {
              const next = e.target.checked;
              run("lock", () => setSceneLockedAction(projectId, scene.id, next), next ? `${label} locked` : `${label} unlocked`, () => setOptimisticLocked(next));
            }}
            aria-label={`Lock ${label}`}
          />
        </Label>
      </header>

      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <Thumbnail scene={scene} format={format} />

        <div className="grid min-w-0 gap-4">
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`narration-${scene.id}`} className="text-xs text-muted-foreground">
                <Mic className="size-3.5" /> Narration
              </Label>
              <span className={cn("text-xs tabular-nums", dirty ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                {dirty ? "Unsaved · " : ""}
                {text.length}/3000
              </span>
            </div>
            <Textarea id={`narration-${scene.id}`} value={text} onChange={(e) => setText(e.target.value)} disabled={!editable || locked} rows={3} maxLength={3000} />
            <div className="flex flex-wrap items-center gap-2">
              {scene.voiceAudioUrl ? (
                <audio key={scene.voiceAudioUrl} controls preload="none" src={scene.voiceAudioUrl} className="h-8 min-w-0 flex-1 basis-56" aria-label={`${label} voiceover`} />
              ) : (
                <span className="flex-1 basis-56 text-xs text-muted-foreground">No voiceover yet</span>
              )}
              {dirty ? (
                <Button size="sm" variant="outline" disabled={disabled || !text.trim()} onClick={() => run("save", () => saveNarrationAction(projectId, scene.id, text), `${label} narration saved; re-voice it before rendering`)}>
                  {spinner("save", <Save />)} Save text
                </Button>
              ) : null}
              <Button
                size="sm"
                variant={dirty || !scene.voiceAudioUrl ? "default" : "secondary"}
                disabled={disabled || !text.trim()}
                onClick={() => run("voice", () => regenerateAudioAction(projectId, scene.id, text), `${label} voiced`)}
              >
                {spinner("voice", <Mic />)} {dirty ? "Save & regenerate audio" : "Regenerate audio"}
              </Button>
            </div>
          </section>

          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ImageIcon className="size-3.5" /> Visual
              </span>
              <div className="flex rounded-md border p-0.5 text-xs" role="radiogroup" aria-label={`${label} visual source`}>
                {(
                  [
                    ["POLLINATIONS", "AI image"],
                    ["PEXELS", "Stock B-roll"],
                    ["PINTEREST", "Pinterest"],
                    ["WAN2GP", "AI video"],
                  ] as const
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={source === value}
                    onClick={() => setSource(value)}
                    className={cn("rounded px-2 py-1 transition-colors", source === value ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
            {source === "POLLINATIONS" ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} disabled={!editable || locked} placeholder="Describe one cinematic frame" aria-label={`${label} image prompt`} className="min-h-0" />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || !prompt.trim()}
                  onClick={() => run("visual", () => regenerateVisualAction(projectId, scene.id, { source: "POLLINATIONS", visualPrompt: prompt }), `${label}: new image generated`)}
                >
                  {spinner("visual", <Sparkles />)} Regenerate image
                </Button>
              </div>
            ) : source === "WAN2GP" ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Engine</span>
                  <Select value={engine} onChange={(e) => setEngine(e.target.value as "WAN2GP" | "MUAPI")} disabled={!editable || locked} aria-label={`${label} AI video engine`} className="h-7 w-auto text-xs">
                    <option value="WAN2GP">Wan2GP · free (Colab worker)</option>
                    <option value="MUAPI" disabled={!muapi}>
                      Muapi · paid (Kling, Seedance, Veo…){muapi ? "" : " — add MUAPI_API_KEY"}
                    </option>
                  </Select>
                  {engine === "MUAPI" && muapi ? (
                    <Select value={muapiModel} onChange={(e) => setMuapiModel(e.target.value)} disabled={!editable || locked} aria-label={`${label} Muapi model`} className="h-7 w-auto text-xs">
                      {muapi.map((m) => (
                        <option key={m.endpoint} value={m.endpoint}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <Textarea value={clipPrompt} onChange={(e) => setClipPrompt(e.target.value)} rows={2} disabled={!editable || locked} placeholder="Describe the motion: subject, action, camera" aria-label={`${label} AI video prompt`} className="min-h-0" />
                  {scene.aiClipStatus === "QUEUED" || scene.aiClipStatus === "RUNNING" ? (
                    <Button size="sm" variant="outline" disabled={disabled} onClick={() => run("clip", () => cancelAiClipAction(projectId, scene.id), `${label}: AI video request cancelled`)}>
                      {spinner("clip", <X />)} Cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled}
                      onClick={() =>
                        run(
                          "clip",
                          () => queueAiClipAction(projectId, scene.id, clipPrompt, engine, engine === "MUAPI" ? muapiModel : undefined),
                          engine === "MUAPI" ? `${label}: sent to Muapi; the clip appears in a few minutes` : `${label}: AI video queued for the Wan2GP worker`,
                        )
                      }
                    >
                      {spinner("clip", <Film />)} {scene.visualSource === "WAN2GP" || scene.visualSource === "MUAPI" ? "Generate another" : engine === "MUAPI" ? "Animate with Muapi" : "Queue AI video"}
                    </Button>
                  )}
                </div>
                <ClipStatus scene={scene} />
              </div>
            ) : source === "PINTEREST" ? (
              <div className="grid gap-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} disabled={!editable || locked} placeholder="e.g. rainy city street" aria-label={`${label} Pinterest search`} />
                  {scene.aiClipEngine === "PINTEREST" && (scene.aiClipStatus === "QUEUED" || scene.aiClipStatus === "RUNNING") ? (
                    <Button size="sm" variant="outline" disabled={disabled} onClick={() => run("clip", () => cancelAiClipAction(projectId, scene.id), `${label}: Pinterest search cancelled`)}>
                      {spinner("clip", <X />)} Cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled || !query.trim()}
                      onClick={() => run("visual", () => regenerateVisualAction(projectId, scene.id, { source: "PINTEREST", stockQuery: query }), `${label}: Pinterest search queued for the worker`)}
                    >
                      {spinner("visual", <Search />)} {scene.visualSource === "PINTEREST" ? "Find another Pin" : "Find on Pinterest"}
                    </Button>
                  )}
                </div>
                <PinterestStatus scene={scene} />
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} disabled={!editable || locked} placeholder="e.g. rainy city street" aria-label={`${label} stock search`} />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || !query.trim()}
                  onClick={() => run("visual", () => regenerateVisualAction(projectId, scene.id, { source: "PEXELS", stockQuery: query }), `${label}: new B-roll found`)}
                >
                  {spinner("visual", <Search />)} {scene.videoClipUrl ? "Find another clip" : "Find B-roll"}
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}

function ClipStatus({ scene }: { scene: StudioScene }) {
  const muapi = scene.aiClipEngine === "MUAPI";
  const text = muapi && scene.aiClipStatus === "RUNNING"
    ? "Muapi is animating this scene's image (usually 1-5 minutes). This page checks on it by itself."
    : muapi && scene.aiClipStatus === "FAILED"
      ? `Muapi failed: ${scene.aiClipError ?? "unknown error"}`
      : scene.visualSource === "MUAPI" && !scene.aiClipStatus
        ? "Using a Muapi clip. Short clips loop to cover the narration."
        : scene.aiClipStatus === "QUEUED"
      ? "Waiting for the Wan2GP worker. Start the Colab notebook if it isn't running."
      : scene.aiClipStatus === "RUNNING"
        ? "Generating on the GPU worker (a few minutes per clip). The current visual stays until it's done."
        : scene.aiClipStatus === "FAILED"
          ? `Wan2GP failed: ${scene.aiClipError ?? "unknown error"}`
          : scene.visualSource === "WAN2GP"
            ? "Using a Wan2GP clip. Short clips loop to cover the narration."
            : "Clips are made by Wan2GP on a GPU worker (see the Colab notebook). The current visual is used until the clip arrives.";
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", scene.aiClipStatus === "FAILED" ? "text-destructive" : "text-muted-foreground")}>
      {scene.aiClipStatus === "QUEUED" || scene.aiClipStatus === "RUNNING" ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : null}
      {text}
    </p>
  );
}

function PinterestStatus({ scene }: { scene: StudioScene }) {
  const ours = scene.aiClipEngine === "PINTEREST";
  const status = ours ? scene.aiClipStatus : null;
  const text =
    status === "QUEUED"
      ? "Waiting for the Pinterest worker. Start cloud/pinterest/pinterest_source.py --worker if it isn't running."
      : status === "RUNNING"
        ? "The worker is searching Pinterest and downloading the first video Pin. The current visual stays until it's done."
        : status === "FAILED"
          ? `Pinterest search failed: ${scene.aiClipError ?? "unknown error"}`
          : scene.visualSource === "PINTEREST"
            ? "Using a Pinterest video. Short clips loop to cover the narration."
            : "A worker outside Vercel searches Pinterest for this phrase and uses the first video Pin it can download.";
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>
      {status === "QUEUED" || status === "RUNNING" ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : null}
      {text}
    </p>
  );
}

function Readiness({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("flex items-center gap-1", ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
      {ok ? <Check className="size-3.5" /> : <CircleAlert className="size-3.5" />}
      {label}
    </span>
  );
}

function Thumbnail({ scene, format }: { scene: StudioScene; format: "SHORT" | "LONG_FORM" }) {
  const size = format === "SHORT" ? "w-24 aspect-[9/16]" : "w-40 aspect-video";
  return (
    <div className={cn("relative overflow-hidden rounded-lg border bg-muted", size)}>
      {scene.videoClipUrl ? (
        <video src={scene.videoClipUrl} poster={scene.imageUrl ?? undefined} muted loop playsInline preload="metadata" className="size-full object-cover" onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
      ) : scene.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote, user-generated assets; next/image adds nothing here
        <img src={scene.imageUrl} alt={scene.visualPrompt ?? ""} loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center text-muted-foreground">
          <ImageIcon className="size-5" />
        </div>
      )}
      {scene.videoClipUrl ? (
        <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">
          <Clapperboard className="size-3" /> Clip
        </span>
      ) : null}
    </div>
  );
}
