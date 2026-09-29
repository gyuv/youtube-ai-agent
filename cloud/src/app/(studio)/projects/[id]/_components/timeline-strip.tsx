"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, type StudioScene } from "./types";

/** Scenes laid end to end, each as wide as its narration; click to jump to the scene. */
export function TimelineStrip({ scenes }: { scenes: StudioScene[] }) {
  const total = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const ready = scenes.filter((s) => s.ready).length;

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Timeline · {scenes.length} scenes · {formatDuration(total)}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-emerald-500" /> ready {ready}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-amber-500" /> needs work {scenes.length - ready}
          </span>
        </span>
      </div>
      <div className="flex h-10 gap-0.5 overflow-hidden rounded-md">
        {scenes.map((scene) => (
          <button
            key={scene.id}
            type="button"
            onClick={() => document.getElementById(`scene-${scene.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
            title={`Scene ${scene.sceneIndex + 1} · ${scene.durationSeconds.toFixed(1)}s${scene.ready ? "" : " · missing voice or visual"}${scene.locked ? " · locked" : ""}`}
            style={{ flexGrow: Math.max(scene.durationSeconds, 0.5), flexBasis: 0 }}
            className={cn(
              "relative flex min-w-7 items-center justify-center text-[11px] font-medium tabular-nums transition-opacity hover:opacity-80",
              scene.ready ? "bg-emerald-500/25 text-emerald-700 dark:text-emerald-200" : "bg-amber-500/25 text-amber-700 dark:text-amber-200",
            )}
          >
            {scene.locked ? <Lock className="size-3" aria-label="locked" /> : scene.sceneIndex + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
