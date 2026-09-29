"use client";

import { Eye, LoaderCircle } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { checkVisibilityAction } from "../../actions";
import { Button } from "@/components/ui/button";

/** Reads the video's visibility back from YouTube (1 quota unit) and updates the lock warning. */
export function VisibilityCheck({ projectId, variant = "outline" }: { projectId: string; variant?: "outline" | "secondary" }) {
  const [checking, startTransition] = useTransition();

  const check = () =>
    startTransition(async () => {
      const result = await checkVisibilityAction(projectId);
      if (!result.ok) toast.error(result.error);
      else if (result.data.locked) toast.warning("YouTube still reports this video as private.");
      else if (result.data.visibility) toast.success(`YouTube reports this video as ${result.data.visibility}.`);
      else toast.error("YouTube no longer has this video. It may have been deleted.");
    });

  return (
    <Button size="sm" variant={variant} disabled={checking} onClick={check} className="justify-self-start">
      {checking ? <LoaderCircle className="animate-spin" /> : <Eye />} Check visibility
    </Button>
  );
}
