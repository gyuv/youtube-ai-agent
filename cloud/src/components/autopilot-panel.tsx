"use client";

import { Bot, LoaderCircle, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createVideoNowAction, runAutopilotNowAction } from "@/app/(studio)/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface AutopilotEventView {
  id: string;
  action: string;
  level: string;
  message: string;
  projectId: string | null;
  ago: string;
}

export interface ChannelOption {
  id: string;
  name: string;
  autopilot: boolean;
}

export function AutopilotPanel({ channelsOn, events, channels }: { channelsOn: number; events: AutopilotEventView[]; channels: ChannelOption[] }) {
  const router = useRouter();
  const [running, startTransition] = useTransition();
  const [creating, startCreate] = useTransition();
  const [channelId, setChannelId] = useState(channels.find((c) => c.autopilot)?.id ?? channels[0]?.id ?? "");

  const createNow = () =>
    startCreate(async () => {
      const result = await createVideoNowAction(channelId);
      if (!result.ok) return void toast.error(result.error);
      const { projectId, topic, autopilot, runError } = result.data;
      if (!autopilot) {
        // No autopilot on this channel: open the video and write its script right away.
        toast.success(`Created "${topic}". Writing the script…`);
        router.push(`/projects/${projectId}?autoscript=1`);
      } else if (runError) {
        toast.warning(`Created "${topic}", but the autopilot run didn't start (${runError}). The next scheduled run will make it.`);
      } else {
        toast.success(`Created "${topic}". The autopilot is making it now: script, voice, visuals, render.`);
      }
    });

  const runNow = () =>
    startTransition(async () => {
      const result = await runAutopilotNowAction();
      if (result.ok) toast.success("Autopilot run requested on GitHub Actions. New activity appears here as it works.");
      else toast.error(result.error);
    });

  return (
    <Card className="h-fit min-w-0 gap-4">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4" /> Autopilot
          </CardTitle>
          <CardDescription className="mt-1.5">
            {channelsOn > 0 ? (
              <>
                On for {channelsOn} channel{channelsOn === 1 ? "" : "s"}; runs every 3 hours.
              </>
            ) : (
              <>
                Off.{" "}
                <Link href="/channels" className="text-foreground underline underline-offset-4">
                  Turn it on for a channel
                </Link>
              </>
            )}
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={running || channelsOn === 0} onClick={runNow} title="Start an autopilot run on GitHub Actions now">
          {running ? <LoaderCircle className="animate-spin" /> : <Play />} Run now
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {channels.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {channels.length > 1 ? (
              <Select value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Channel for the new video" className="h-8 w-auto min-w-0 flex-1 text-sm">
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button size="sm" disabled={creating || !channelId} onClick={createNow} title="Plan a video now and have the autopilot make it, without waiting for a slot">
              {creating ? <LoaderCircle className="animate-spin" /> : <Plus />} Create a video now
            </Button>
          </div>
        ) : null}
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No autopilot activity yet.</p>
        ) : (
          <ol className="grid grid-cols-1 gap-3" aria-label="Autopilot activity">
            {events.map((event) => (
              <li key={event.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 text-sm">
                <span className={cn("mt-1.5 size-2 rounded-full", event.level === "error" ? "bg-red-500" : "bg-emerald-500")} aria-hidden />
                <div className="min-w-0">
                  <p className="line-clamp-3 break-words" title={event.message}>
                    {event.projectId ? (
                      <Link href={`/projects/${event.projectId}`} className="hover:underline">
                        {event.message}
                      </Link>
                    ) : (
                      event.message
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {event.action} · {event.ago}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
