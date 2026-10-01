"use client";

import { LoaderCircle, Youtube } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label, Switch } from "@/components/ui/form-controls";
import { publishProjectAction, setAutoPublishAction } from "../../actions";

interface PublishPanelProps {
  projectId: string;
  channelId: string;
  autoPublish: boolean;
  youtubeConnected: boolean;
  /** RENDERED with an mp4 and no YouTube video yet. */
  canPublish: boolean;
}

export function PublishPanel({ projectId, channelId, autoPublish, youtubeConnected, canPublish }: PublishPanelProps) {
  const [publishing, startPublish] = useTransition();
  const [switching, startSwitch] = useTransition();
  const [enabled, setOptimisticEnabled] = useOptimistic(autoPublish);

  const publish = () =>
    startPublish(async () => {
      toast.message("Uploading to YouTube… this can take a minute.");
      const result = await publishProjectAction(projectId);
      if (!result.ok) toast.error(result.error);
      else if (result.data.locked) toast.warning("Uploaded, but YouTube kept it private (your Google Cloud project needs the YouTube API audit).");
      else toast.success("Published to YouTube");
    });

  const toggle = (next: boolean) =>
    startSwitch(async () => {
      setOptimisticEnabled(next);
      const result = await setAutoPublishAction(projectId, channelId, next);
      if (!result.ok) toast.error(result.error);
      else toast.success(next ? "Auto-publish on: finished videos go to YouTube by themselves" : "Auto-publish off");
    });

  return (
    <div className="grid gap-3">
      {canPublish ? (
        <Button onClick={publish} disabled={publishing || !youtubeConnected} className="justify-self-start">
          {publishing ? <LoaderCircle className="animate-spin" /> : <Youtube />} Publish to YouTube
        </Button>
      ) : null}
      <Label className="gap-2 text-sm font-normal" title="Applies to every video on this channel">
        {switching ? <LoaderCircle className="size-4 animate-spin" /> : null}
        <Switch checked={enabled} disabled={switching || (!youtubeConnected && !enabled)} onChange={(e) => toggle(e.target.checked)} />
        Auto-publish to YouTube
      </Label>
      <p className="text-xs text-muted-foreground">
        {!youtubeConnected
          ? "Connect this channel to YouTube first (Channels → Connect YouTube)."
          : enabled
            ? "On for this channel: new renders upload by themselves, and the autopilot publishes any rendered video still waiting (every 3 hours)."
            : "Off: rendered videos wait for you to click Publish to YouTube."}
      </p>
    </div>
  );
}
