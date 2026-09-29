"use client";

import { Bot, LoaderCircle, Play } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { runAutopilotNowAction } from "@/app/(studio)/actions";
import { Button } from "@/components/ui/button";
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

export function AutopilotPanel({ channelsOn, events }: { channelsOn: number; events: AutopilotEventView[] }) {
  const [running, startTransition] = useTransition();

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
      <CardContent className="grid grid-cols-1">
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
