"use client";

import { LoaderCircle, Zap } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setFullAutomationAction } from "@/app/(studio)/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/form-controls";
import { cn } from "@/lib/utils";

export interface AutomationChannel {
  id: string;
  name: string;
  on: boolean;
  youtubeConnected: boolean;
  /** "Daily at 07:00 (Asia/Kolkata)" style summary of the posting schedule, if any. */
  schedule: string | null;
}

/** One master switch per channel: make, post and learn on its own, or stop. */
export function AutomationSwitch({ channels }: { channels: AutomationChannel[] }) {
  return (
    <Card className="h-fit min-w-0 gap-4">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Zap className="size-4" /> Full automation
          </CardTitle>
          <CardDescription className="mt-1.5">
            On: makes each video before its slot, posts it publicly on YouTube, and learns from views to improve the next ones. Off: stops
            making and posting.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Link href="/channels/new" className="text-foreground underline underline-offset-4">
              Add a channel
            </Link>{" "}
            first.
          </p>
        ) : (
          channels.map((channel) => <ChannelRow key={channel.id} channel={channel} />)
        )}
      </CardContent>
    </Card>
  );
}

function ChannelRow({ channel }: { channel: AutomationChannel }) {
  const [busy, startTransition] = useTransition();
  const [on, setOptimisticOn] = useOptimistic(channel.on);

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setOptimisticOn(next);
      const result = await setFullAutomationAction(channel.id, next);
      if (!result.ok) toast.error(result.error);
      else if (next) toast.success(`${channel.name}: full automation ON. Videos are made, posted and improved on their own.`);
      else toast.success(`${channel.name}: full automation OFF.`);
    });

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{channel.name}</p>
        <p className={cn("text-xs", !channel.youtubeConnected && !on ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
          {!channel.youtubeConnected && !on
            ? "Connect YouTube on the channel page first"
            : on
              ? `ON · posts ${channel.schedule ?? "daily at 7 am"}`
              : "OFF"}
        </p>
      </div>
      {busy ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
      <Switch
        checked={on}
        disabled={busy || (!channel.youtubeConnected && !on)}
        onChange={(e) => toggle(e.target.checked)}
        aria-label={`Full automation for ${channel.name}`}
        className="h-6 w-11 before:size-5 checked:before:translate-x-5"
      />
    </div>
  );
}
