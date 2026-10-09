"use client";

import { Bot, Check, LoaderCircle, Play, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { clearAutopilotActivityAction, createVideosAheadAction, runAutopilotNowAction } from "@/app/(studio)/actions";
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

  const [count, setCount] = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, startClear] = useTransition();

  const clear = () =>
    startClear(async () => {
      const result = await clearAutopilotActivityAction();
      setConfirmClear(false);
      if (result.ok) toast.success(`Cleared ${result.data.cleared} activity entr${result.data.cleared === 1 ? "y" : "ies"}.`);
      else toast.error(result.error);
    });

  const createNow = () =>
    startCreate(async () => {
      const result = await createVideosAheadAction(channelId, count);
      if (!result.ok) return void toast.error(result.error);
      const { projectIds, topics, autopilot, runError } = result.data;
      const what = topics.length === 1 ? `"${topics[0]}"` : `${topics.length} videos`;
      if (!autopilot) {
        // No autopilot on this channel: open the (first) video and write its script right away.
        toast.success(`Created ${what}. Writing the script…`);
        router.push(`/projects/${projectIds[0]}?autoscript=1`);
      } else if (runError) {
        toast.warning(`Created ${what} for the next slots, but the autopilot run didn't start (${runError}). The next scheduled run will make them.`);
      } else {
        toast.success(`Making ${what} for the next posting slots now: script, voice, visuals, render.`);
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
            <span className="bg-brand grid size-6 place-items-center rounded-lg text-white">
              <Bot className="size-3.5" />
            </span>
            Autopilot
            {channelsOn > 0 ? <span className="size-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_oklch(0.75_0.17_155)]" aria-label="on" /> : null}
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
            <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many upcoming slots" className="h-8 w-auto text-sm">
              <option value="1">Next slot</option>
              <option value="3">Next 3 slots</option>
              <option value="7">Next 7 slots</option>
            </Select>
            <Button size="sm" disabled={creating || !channelId} onClick={createNow} title="Make the videos for the upcoming posting slots now, even if they are days away">
              {creating ? <LoaderCircle className="animate-spin" /> : <Plus />} Make videos ahead
            </Button>
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="mb-2 flex h-7 items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Activity</span>
            {events.length > 0 ? (
              confirmClear ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  Clear all?
                  <Button size="icon-sm" variant="ghost" className="size-7 text-red-400 hover:text-red-300" disabled={clearing} onClick={clear} aria-label="Yes, clear the activity log">
                    {clearing ? <LoaderCircle className="animate-spin" /> : <Check />}
                  </Button>
                  <Button size="icon-sm" variant="ghost" className="size-7" disabled={clearing} onClick={() => setConfirmClear(false)} aria-label="Keep the activity log">
                    <X />
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setConfirmClear(true)} title="Delete every entry in the activity log">
                  <Trash2 className="size-3.5" /> Clear
                </Button>
              )
            ) : null}
          </div>
          {events.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No autopilot activity yet.</p>
          ) : (
            <ol
              className="scrollbar-none relative grid max-h-96 grid-cols-1 gap-3 overflow-y-auto pr-1 [mask-image:linear-gradient(to_bottom,black_85%,transparent)] before:absolute before:top-2 before:bottom-2 before:left-[3.5px] before:w-px before:bg-gradient-to-b before:from-primary/40 before:to-transparent"
              aria-label="Autopilot activity"
            >
              {events.map((event, i) => (
                <li key={event.id} className="relative grid min-w-0 animate-rise grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-sm" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                  <span
                    className={cn(
                      "mt-1.5 size-2 rounded-full ring-4 ring-background",
                      event.level === "error" ? "bg-red-500 shadow-[0_0_10px_oklch(0.65_0.22_25)]" : event.action === "rescheduled" ? "bg-amber-400 shadow-[0_0_10px_oklch(0.8_0.15_75)]" : "bg-emerald-400 shadow-[0_0_10px_oklch(0.75_0.17_155)]",
                    )}
                    aria-hidden
                  />
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
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="rounded bg-white/5 px-1 py-px font-mono text-[10px] uppercase">{event.action}</span> · {event.ago}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
