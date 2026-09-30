"use client";

import { LoaderCircle, Youtube } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { publishToYouTubeAction } from "../../actions";
import { Button } from "@/components/ui/button";

/** Uploads the stored render to YouTube (1,600 quota units). Takes up to a couple of minutes. */
export function PublishButton({ projectId }: { projectId: string }) {
  const [publishing, startTransition] = useTransition();

  const publish = () =>
    startTransition(async () => {
      const result = await publishToYouTubeAction(projectId);
      if (!result.ok) toast.error(result.error);
      else if (result.data.locked) toast.warning("Uploaded, but YouTube kept it private. See the note at the top of the page.");
      else if (result.data.scheduled) toast.success("Uploaded. YouTube will make it public at the scheduled time.");
      else toast.success(`Published to YouTube${result.data.visibility ? ` as ${result.data.visibility}` : ""}.`);
    });

  return (
    <Button size="sm" disabled={publishing} onClick={publish} className="justify-self-start">
      {publishing ? <LoaderCircle className="animate-spin" /> : <Youtube />} {publishing ? "Uploading to YouTube…" : "Publish to YouTube"}
    </Button>
  );
}
