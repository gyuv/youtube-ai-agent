"use client";

import { Brain, LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { refreshStatsAction, runMastermindNowAction } from "@/app/(studio)/growth-lab/actions";
import { Button } from "@/components/ui/button";

export function RunMastermindButton({ channelId, size = "sm" }: { channelId: string; size?: "sm" | "default" }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size={size}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await runMastermindNowAction(channelId);
          if (result.ok) {
            toast.success(`Mastermind finished: ${result.data.applied ? `changed ${result.data.applied} video(s)` : "kept every video"}. ${result.data.diagnosis}`, { duration: 15_000 });
            router.refresh();
          } else toast.error(`Mastermind didn't finish: ${result.error}`, { duration: 15_000 });
        })
      }
    >
      {pending ? <LoaderCircle className="animate-spin" /> : <Brain />} {pending ? "Running… about a minute" : "Run mastermind now"}
    </Button>
  );
}

export function RefreshStatsButton({ channelId }: { channelId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await refreshStatsAction(channelId);
          if (result.ok) toast.success("Channel numbers refreshed from YouTube.");
          else toast.error(result.error);
        })
      }
    >
      {pending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Refresh numbers
    </Button>
  );
}
