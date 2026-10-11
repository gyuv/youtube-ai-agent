"use client";

import { Clapperboard, LoaderCircle, Save, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { designMascotAction, saveFlowSettingsAction } from "@/app/(studio)/growth-lab/actions";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/form-controls";
import { cn } from "@/lib/utils";

/** Per channel: animate hooks with Google Flow, and the recurring host Flow keeps on-model. */
export interface FlowWorkerView {
  online: boolean;
  ready: boolean;
  creditsLeft: number | null;
  seenAgo: string | null;
}

export function FlowSettings({
  channelId,
  initial,
  worker,
}: {
  channelId: string;
  initial: { flowHookClips: boolean; mascotName: string | null; mascotLook: string | null };
  worker: FlowWorkerView;
}) {
  const [on, setOn] = useState(initial.flowHookClips);
  const [name, setName] = useState(initial.mascotName ?? "");
  const [look, setLook] = useState(initial.mascotLook ?? "");
  const [why, setWhy] = useState<string | null>(null);
  const [designing, startDesign] = useTransition();
  const [saving, startSave] = useTransition();
  const dirty = on !== initial.flowHookClips || name !== (initial.mascotName ?? "") || look !== (initial.mascotLook ?? "");

  const design = () =>
    startDesign(async () => {
      const result = await designMascotAction(channelId);
      if (!result.ok) return void toast.error(result.error);
      setName(result.data.name);
      setLook(result.data.look);
      setWhy(result.data.why);
      toast.success(`Script Lab designed ${result.data.name}. Edit anything, then save.`);
    });
  const save = () =>
    startSave(async () => {
      const result = await saveFlowSettingsAction(channelId, { flowHookClips: on, mascotName: name.trim() || null, mascotLook: look.trim() || null });
      if (result.ok) toast.success("Saved. New Flow clips use these settings.");
      else toast.error(result.error);
    });

  return (
    <div className="grid gap-5">
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-xs",
          worker.ready ? "border-emerald-500/30 bg-emerald-500/[0.06]" : worker.online ? "border-amber-500/30 bg-amber-500/[0.06]" : "bg-white/[0.02]",
        )}
      >
        <span className={cn("mt-1 size-2 shrink-0 rounded-full", worker.ready ? "animate-pulse bg-emerald-400" : worker.online ? "bg-amber-400" : "bg-white/25")} aria-hidden />
        <span className="text-muted-foreground">
          {worker.ready ? (
            <>
              <span className="font-medium text-emerald-300">Flow worker online</span>
              {worker.creditsLeft !== null ? ` · ${worker.creditsLeft} credits left today` : ""}. Hooks are being planned and animated.
            </>
          ) : worker.online ? (
            <>
              <span className="font-medium text-amber-200">Flow worker online, today&apos;s credits used.</span> Videos render with their stills until tomorrow.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">No Flow worker{worker.seenAgo ? ` since ${worker.seenAgo}` : " yet"}.</span> Nothing waits for it: videos
              render and post on time with their still images, and Flow is used automatically whenever a worker checks in.
            </>
          )}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setOn(!on)}
        aria-pressed={on}
        className={cn("flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors", on ? "border-primary/40 bg-primary/[0.07]" : "bg-white/[0.02]")}
      >
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", on ? "bg-brand text-white" : "bg-white/5 text-muted-foreground")}>
          <Clapperboard className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Animate each video&apos;s hook with Google Flow</span>
          <span className="block text-xs text-muted-foreground">
            Script Lab plans the shot first and only spends credits when motion beats the still. Max 15 credits a clip and 25 a day,
            enforced by the Flow worker on your computer. Without a worker online, Flow is skipped and nothing waits.
          </span>
        </span>
        <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-white/15")} aria-hidden>
          <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
        </span>
      </button>

      <div className="grid gap-3 rounded-2xl border bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Channel host</p>
            <p className="text-xs text-muted-foreground">Created once as a Flow character and attached to every Flow clip, so the same face opens every video.</p>
          </div>
          <Button size="sm" variant="outline" onClick={design} disabled={designing}>
            {designing ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {name ? "Redesign" : "Design"} with Script Lab
          </Button>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="mascot-name">Name</Label>
          <Input id="mascot-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Yoyo" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="mascot-look">Look</Label>
          <Textarea id="mascot-look" value={look} onChange={(e) => setLook(e.target.value)} maxLength={900} rows={4} placeholder="Exact visual description Flow redraws every time" />
          <FieldHint>
            {why ?? "Leave both empty to animate each hook's own image instead (Flow can attach a character or start from the image, not both)."}
            {name && look ? " Changing it later makes the worker create a new Flow character." : ""}
          </FieldHint>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? <LoaderCircle className="animate-spin" /> : <Save />} Save Flow settings
        </Button>
      </div>
    </div>
  );
}
