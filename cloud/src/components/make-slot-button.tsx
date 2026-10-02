"use client";

import { LoaderCircle, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { makeSlotNowAction } from "@/app/(studio)/actions";

/** On an open schedule slot: make that slot's video now instead of waiting for the lead window. */
export function MakeSlotButton({ channelId, at }: { channelId: string; at: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const make = () =>
    startTransition(async () => {
      const result = await makeSlotNowAction(channelId, at);
      if (!result.ok) return void toast.error(result.error);
      const { projectId, topic, autopilot, runError } = result.data;
      if (!autopilot) {
        toast.success(`Created "${topic}". Writing the script…`);
        router.push(`/projects/${projectId}?autoscript=1`);
      } else if (runError) toast.warning(`Created "${topic}" for this slot; the autopilot run didn't start (${runError}). The next run will make it.`);
      else toast.success(`Making "${topic}" for this slot now.`);
    });
  return (
    <button
      type="button"
      onClick={make}
      disabled={busy}
      title="Make this slot's video now"
      className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
    >
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Make now
    </button>
  );
}
