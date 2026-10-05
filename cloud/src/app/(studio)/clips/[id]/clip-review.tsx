"use client";

import { CheckCircle2, Clapperboard, Download, LoaderCircle, Save, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form-controls";
import type { Moment } from "@/services/clipContract";
import { deleteClipJobAction, renderClipsAction, saveMomentsAction } from "../actions";

interface JobView {
  id: string;
  videoId: string;
  status: "REVIEW" | "RENDERING" | "DONE" | "FAILED";
  layout: string;
  burnCaptions: boolean;
  durationSeconds: number | null;
  lastError: string | null;
  moments: Moment[];
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** "1:23.5", "83.5" or "1:02:03" → seconds. */
function parseTime(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function ClipReview({ job }: { job: JobView }) {
  const [moments, setMoments] = useState(job.moments);
  const [times, setTimes] = useState(() => Object.fromEntries(job.moments.map((m) => [m.id, { start: fmt(m.start), end: fmt(m.end) }])));
  const [pending, start] = useTransition();
  const locked = job.status === "RENDERING";
  const selected = moments.filter((m) => m.selected && m.status !== "done").length;

  const edits = () => {
    const out = [];
    for (const m of moments) {
      const s = parseTime(times[m.id].start);
      const e = parseTime(times[m.id].end);
      if (s === null || e === null) throw new Error(`Check the start/end times of "${m.title}" (use m:ss).`);
      out.push({ id: m.id, start: s, end: e, title: m.title, selected: m.selected });
    }
    return out;
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) toast.success(success);
        else toast.error(r.error);
      } catch (error) {
        toast.error((error as Error).message);
      }
    });

  const patch = (id: string, p: Partial<Moment>) => setMoments((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));

  return (
    <div className="grid gap-4">
      {job.lastError ? (
        <Alert variant="destructive">
          <AlertDescription className="col-span-2 col-start-1">{job.lastError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{job.layout === "fit" ? "Whole frame on blurred background" : "Fill 9:16, centred on the speaker"}</Badge>
        <Badge variant="secondary">{job.burnCaptions ? "Captions burned in" : "No captions"}</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending || locked} onClick={() => run(() => saveMomentsAction(job.id, edits()), "Saved.")}>
            <Save />
            Save changes
          </Button>
          <Button disabled={pending || locked || selected === 0} onClick={() => run(() => renderClipsAction(job.id, edits()), "Rendering started on GitHub Actions.")}>
            {pending || locked ? <LoaderCircle className="animate-spin" /> : <Clapperboard />}
            {locked ? "Rendering…" : `Render ${selected} clip${selected === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
      {locked ? <p className="text-sm text-muted-foreground">The worker downloads, cuts and captions each clip; this page updates by itself. A few minutes per clip.</p> : null}

      {moments.map((m, i) => (
        <Card key={m.id} className={m.selected || m.status === "done" ? "" : "opacity-60"}>
          <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="aspect-video overflow-hidden rounded-md bg-muted">
              {m.status === "done" && m.videoUrl ? (
                <video src={m.videoUrl} controls preload="metadata" className="mx-auto h-full" />
              ) : (
                <iframe
                  key={`${times[m.id].start}-${times[m.id].end}`}
                  src={`https://www.youtube-nocookie.com/embed/${job.videoId}?start=${Math.floor(parseTime(times[m.id].start) ?? m.start)}&end=${Math.ceil(parseTime(times[m.id].end) ?? m.end)}&rel=0`}
                  title={m.title}
                  className="h-full w-full"
                  allow="encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              )}
            </div>
            <div className="grid content-start gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">#{i + 1}</span>
                <Badge>{m.score}/100</Badge>
                {m.status === "done" ? (
                  <Badge variant="secondary"><CheckCircle2 /> clipped</Badge>
                ) : m.status === "failed" ? (
                  <Badge variant="destructive"><XCircle /> failed</Badge>
                ) : m.status === "rendering" ? (
                  <Badge variant="secondary"><LoaderCircle className="animate-spin" /> rendering</Badge>
                ) : null}
                <label className="ml-auto flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={m.selected} disabled={locked || m.status === "done"} onChange={(e) => patch(m.id, { selected: e.target.checked })} />
                  Include
                </label>
              </div>
              <Input value={m.title} maxLength={100} disabled={locked || m.status === "done"} onChange={(e) => patch(m.id, { title: e.target.value })} aria-label="Clip title" />
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`s-${m.id}`}>Start</Label>
                  <Input id={`s-${m.id}`} className="w-28" value={times[m.id].start} disabled={locked || m.status === "done"} onChange={(e) => setTimes((t) => ({ ...t, [m.id]: { ...t[m.id], start: e.target.value } }))} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`e-${m.id}`}>End</Label>
                  <Input id={`e-${m.id}`} className="w-28" value={times[m.id].end} disabled={locked || m.status === "done"} onChange={(e) => setTimes((t) => ({ ...t, [m.id]: { ...t[m.id], end: e.target.value } }))} />
                </div>
                <span className="pb-2 text-xs text-muted-foreground">
                  {(() => {
                    const s = parseTime(times[m.id].start);
                    const e = parseTime(times[m.id].end);
                    return s !== null && e !== null ? `${Math.round(e - s)} s` : "invalid time";
                  })()}
                </span>
              </div>
              <p className="text-sm"><span className="font-medium">Hook:</span> {m.hook}</p>
              <p className="text-sm text-muted-foreground">{m.reason}</p>
              {m.error ? <p className="text-sm text-destructive">{m.error}</p> : null}
              {m.status === "done" ? (
                <div className="flex flex-wrap gap-2">
                  {m.projectId ? (
                    <Link href={`/projects/${m.projectId}`} className={buttonVariants({ size: "sm" })}>
                      Open to publish
                    </Link>
                  ) : null}
                  {m.videoUrl ? (
                    <a href={m.videoUrl} download className={buttonVariants({ size: "sm", variant: "outline" })}>
                      <Download />
                      Download
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}

      <form action={deleteClipJobAction.bind(null, job.id)} className="pt-4">
        <Button type="submit" variant="ghost" size="sm" disabled={locked}>
          <Trash2 />
          Delete this clip job
        </Button>
      </form>
    </div>
  );
}
