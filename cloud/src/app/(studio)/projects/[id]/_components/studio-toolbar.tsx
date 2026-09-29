"use client";

import { CloudUpload, LoaderCircle, RefreshCw, Sparkles, Square, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-controls";
import { deleteProjectAction, dispatchRenderAction, fillSceneAction, generateScriptAction } from "../../actions";

interface ToolbarProps {
  projectId: string;
  editable: boolean;
  inFlight: boolean;
  sceneCount: number;
  lockedCount: number;
  /** Unlocked scenes still missing a voice or a visual, in order. */
  pending: Array<{ id: string; sceneIndex: number }>;
  renderBlocker: string | null;
  autoScript: boolean;
}

export function StudioToolbar({ projectId, editable, inFlight, sceneCount, lockedCount, pending, renderBlocker, autoScript }: ToolbarProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<"script" | "assets" | "render" | "delete" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [visualSource, setVisualSource] = useState("POLLINATIONS");
  const [, startTransition] = useTransition();
  const stopRequested = useRef(false);
  const autoStarted = useRef(false);

  const writeScript = (confirmReplace: boolean) => {
    if (confirmReplace && !window.confirm("Rewrite the whole script? Every scene, voiceover and visual will be replaced.")) return;
    setBusy("script");
    setProgress("Gemini is writing the script…");
    startTransition(async () => {
      const result = await generateScriptAction(projectId);
      setBusy(null);
      setProgress(null);
      if (result.ok) toast.success(`Script ready: ${result.data.scenes} scenes`);
      else toast.error(result.error);
    });
  };

  // "Write the script right away" from the new-video form lands here with ?autoscript=1.
  useEffect(() => {
    if (!autoScript) return;
    // Deferred, and the guard is set inside the callback, so React's dev double-mount can't run it twice.
    const timer = setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      router.replace(`/projects/${projectId}`, { scroll: false });
      if (sceneCount === 0 && editable) writeScript(false);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on arrival
  }, []);

  const fillAssets = () => {
    stopRequested.current = false;
    setBusy("assets");
    startTransition(async () => {
      let failures = 0;
      for (const [i, scene] of pending.entries()) {
        if (stopRequested.current) break;
        setProgress(`Scene ${scene.sceneIndex + 1} · ${i + 1} of ${pending.length}`);
        const result = await fillSceneAction(projectId, scene.id, visualSource);
        const errors = result.ok ? result.data.errors : [result.error];
        if (errors.length) {
          failures++;
          toast.error(`Scene ${scene.sceneIndex + 1}: ${errors.join(" · ")}`);
        }
      }
      setBusy(null);
      setProgress(null);
      if (stopRequested.current) toast.message("Stopped. Finished scenes were kept.");
      else if (failures === 0) toast.success("Every scene has a voice and a visual");
      else toast.warning(`${failures} scene${failures === 1 ? "" : "s"} still need attention`);
    });
  };

  const dispatch = () => {
    setBusy("render");
    startTransition(async () => {
      const result = await dispatchRenderAction(projectId);
      setBusy(null);
      if (result.ok) toast.success("Render dispatched to GitHub Actions. This page updates as it progresses.");
      else toast.error(result.error);
    });
  };

  const remove = () => {
    if (!window.confirm("Delete this video project? Its scenes are removed; files already uploaded stay in storage.")) return;
    setBusy("delete");
    startTransition(async () => {
      const result = await deleteProjectAction(projectId);
      if (result && !result.ok) {
        setBusy(null);
        toast.error(result.error);
      }
    });
  };

  const locked = busy !== null || !editable;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
      {sceneCount === 0 ? (
        <Button disabled={locked} onClick={() => writeScript(false)}>
          {busy === "script" ? <LoaderCircle className="animate-spin" /> : <Sparkles />} Write script with Gemini
        </Button>
      ) : (
        <Button
          variant="outline"
          disabled={locked || lockedCount > 0}
          onClick={() => writeScript(true)}
          title={lockedCount > 0 ? "Unlock every scene to rewrite the whole script" : "Replace all scenes with a fresh Gemini script"}
        >
          {busy === "script" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Rewrite script
        </Button>
      )}

      {pending.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" disabled={locked} onClick={fillAssets}>
            {busy === "assets" ? <LoaderCircle className="animate-spin" /> : <Wand2 />} Generate missing assets ({pending.length})
          </Button>
          <Select value={visualSource} onChange={(e) => setVisualSource(e.target.value)} disabled={locked} aria-label="Visual source for missing visuals" className="h-9 w-auto">
            <option value="POLLINATIONS">with AI images</option>
            <option value="PEXELS">with stock B-roll</option>
          </Select>
          {busy === "assets" ? (
            <Button variant="ghost" size="sm" onClick={() => (stopRequested.current = true)}>
              <Square /> Stop
            </Button>
          ) : null}
        </div>
      ) : null}

      {progress ? (
        <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          {progress}
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" disabled={busy !== null || inFlight} onClick={remove} aria-label="Delete project" title="Delete project">
          <Trash2 />
        </Button>
        <Button disabled={busy !== null || renderBlocker !== null} onClick={dispatch} title={renderBlocker ?? "Render this video on a GitHub Actions runner"}>
          {busy === "render" ? <LoaderCircle className="animate-spin" /> : <CloudUpload />} Dispatch Cloud Render
        </Button>
      </div>
    </div>
  );
}
