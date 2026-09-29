import { CalendarClock, CheckCircle2, CircleDashed, Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listChannels } from "@/services/channels";
import { formatSlot, isValidCron, nextPostingTimes } from "@/services/schedule";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const channels = await listChannels();
  return (
    <>
      <PageHeader
        title="Channels"
        description="Niche, voice, visual style and posting schedule for each YouTube channel."
        actions={
          <Link href="/channels/new" className={buttonVariants()}>
            <Plus />
            New channel
          </Link>
        }
      />
      {channels.length === 0 ? (
        <p className="text-sm text-muted-foreground">No channels yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {channels.map((channel) => {
            const next = channel.postingCron && isValidCron(channel.postingCron) ? nextPostingTimes(channel.postingCron, channel.postingTimezone, 1)[0] : null;
            return (
              <Link key={channel.id} href={`/channels/${channel.id}`} className="group">
                <Card className="h-full transition-colors group-hover:border-ring/60">
                  <CardHeader>
                    <div className="min-w-0">
                      <CardTitle className="truncate">{channel.name}</CardTitle>
                      <CardDescription className="mt-1.5 line-clamp-2">{channel.niche}</CardDescription>
                    </div>
                    {channel.isActive ? null : <Badge variant="secondary">Paused</Badge>}
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      {channel.youtubeChannelId ? (
                        <>
                          <CheckCircle2 className="size-4 text-emerald-500" /> YouTube connected
                          {channel.autoPublish ? <Badge variant="outline">Auto-publish</Badge> : null}
                        </>
                      ) : (
                        <>
                          <CircleDashed className="size-4 text-muted-foreground" />
                          <span className="text-muted-foreground">YouTube not connected</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CalendarClock className="size-4" />
                      {next ? `Next slot ${formatSlot(next, channel.postingTimezone)}` : "No posting schedule"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {channel._count.projects} video{channel._count.projects === 1 ? "" : "s"} · {channel.defaultVoice} ·{" "}
                      {channel.defaultFormat === "SHORT" ? "Shorts" : "Long-form"}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
