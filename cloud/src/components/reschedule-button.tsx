"use client";

import { CalendarClock, LoaderCircle } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { rescheduleProjectAction } from "@/app/(studio)/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Moves a video that missed its slot to the next free one, keeping its script, voice, visuals and render. */
export function RescheduleButton({ projectId, className, label = "Next slot" }: { projectId: string; className?: string; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className={cn("relative z-10", className)}
      disabled={pending}
      title="Move to the channel's next free posting slot, reusing its existing files"
      onClick={() =>
        start(async () => {
          const result = await rescheduleProjectAction(projectId);
          if (result.ok) toast.success(result.data.message);
          else toast.error(result.error);
        })
      }
    >
      {pending ? <LoaderCircle className="animate-spin" /> : <CalendarClock />} {label}
    </Button>
  );
}
