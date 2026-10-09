import { BadgeDollarSign, Brain, CheckCircle2, Inbox, Link2, Palette, Target, Unlink, Youtube } from "lucide-react";
import { BrandStudio } from "@/components/growth/brand-studio";
import { GoalPicker } from "@/components/growth/goal-picker";
import { MonetizationTracker } from "@/components/growth/monetization-tracker";
import { RequestsInbox } from "@/components/growth/requests-inbox";
import { RefreshStatsButton, RunMastermindButton } from "@/components/growth/run-mastermind-button";
import { timeAgo } from "@/components/page-header";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { canSetBanner, recentBrandAssets } from "@/services/branding";
import { openRequests } from "@/services/mastermind";
import { hasAnalyticsScope, monetizationProgress } from "@/services/monetization";
import { GOOGLE_PERMISSIONS_URL } from "@/lib/publicInfo";
import { disconnectChannelAction } from "../actions";
import { ChannelForm } from "../channel-form";

export const dynamic = "force-dynamic";
// The mastermind and brand designer call Gemini and the image service from server actions here.
export const maxDuration = 300;

const NOTICES: Record<string, "success" | "error"> = { connected: "success", disconnected: "success", denied: "error", error: "error" };

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; youtube?: string; message?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const now = new Date();
  const channel = await prisma.channel.findUnique({ where: { id } });
  if (!channel) notFound();
  const [uploads90d, assets, requests, report] = await Promise.all([
    prisma.videoProject.count({ where: { channelId: id, status: "PUBLISHED", publishedAt: { gte: new Date(now.getTime() - 90 * 86_400_000) } } }),
    recentBrandAssets(id),
    openRequests(id),
    prisma.labReport.findFirst({ where: { channelId: id, toolId: "mastermind" }, orderBy: { createdAt: "desc" } }),
  ]);
  const tiers = monetizationProgress(channel, uploads90d, now);

  const notice = query.youtube ? NOTICES[query.youtube] : query.saved ? "success" : undefined;
  const noticeText =
    query.message ??
    (query.saved ? "Channel saved." : query.youtube === "disconnected" ? "YouTube disconnected. Auto-publish is now off." : null);
  const oauthConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={channel.name}
        description={channel.niche}
        actions={
          <Link href={`/projects/new?channelId=${channel.id}`} className={buttonVariants({ variant: "outline" })}>
            New video on this channel
          </Link>
        }
      />

      {notice && noticeText ? (
        <Alert variant={notice === "error" ? "destructive" : "default"} className="mb-6">
          <AlertDescription className="col-span-2 col-start-1">{noticeText}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Youtube className="size-4 text-red-500" /> YouTube
            </CardTitle>
            <CardDescription className="mt-1.5">
              Lumen asks to upload videos, read your channel&apos;s stats and analytics (for the monetization tracker) and set a banner you
              choose. Tokens are encrypted at rest. Disconnect revokes the access at
              Google and deletes the tokens; you can also revoke it in your{" "}
              <a href={GOOGLE_PERMISSIONS_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                Google security settings
              </a>
              .
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          {channel.youtubeChannelId ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-emerald-500" />
                Connected to{" "}
                <a href={`https://www.youtube.com/channel/${channel.youtubeChannelId}`} target="_blank" rel="noreferrer" className="font-mono text-xs underline underline-offset-4">
                  {channel.youtubeChannelId}
                </a>
              </div>
              <form action={disconnectChannelAction.bind(null, channel.id)}>
                <Button type="submit" variant="outline" size="sm">
                  <Unlink /> Disconnect
                </Button>
              </form>
            </>
          ) : oauthConfigured ? (
            <>
              <p className="text-sm text-muted-foreground">Not connected. Videos can still be rendered and downloaded.</p>
              {/* A plain link: the OAuth flow is a full-page redirect to Google. */}
              <a href={`/api/oauth/google/start?channelId=${channel.id}`} className={buttonVariants({ size: "sm" })}>
                <Link2 /> Connect YouTube
              </a>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to enable connecting YouTube.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <BadgeDollarSign className="size-4 text-brand-3" /> Road to monetization
            </CardTitle>
            <CardDescription className="mt-1.5">YouTube Partner Program thresholds, from your channel&apos;s live numbers.</CardDescription>
          </div>
          {channel.oauthRefreshTokenEnc ? <RefreshStatsButton channelId={channel.id} /> : null}
        </CardHeader>
        <CardContent>
          <MonetizationTracker
            tiers={tiers}
            connected={Boolean(channel.oauthRefreshTokenEnc)}
            analytics={hasAnalyticsScope(channel)}
            updatedLabel={channel.channelStatsAt ? timeAgo(channel.channelStatsAt, now) : null}
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-4 text-brand-1" /> Growth goal
            </CardTitle>
            <CardDescription className="mt-1.5">Steers every topic, script and title on this channel.</CardDescription>
          </div>
          <RunMastermindButton channelId={channel.id} />
        </CardHeader>
        <CardContent className="grid gap-5">
          <GoalPicker channelId={channel.id} goal={channel.growthGoal} mastermind={channel.mastermind} />
          {report ? (
            <div className="rounded-2xl border bg-white/[0.02] p-4">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Brain className="size-3.5 text-brand-2" /> Mastermind, {timeAgo(report.createdAt, now)}
              </p>
              <p className="mt-2 text-sm">{report.summary}</p>
              {channel.mastermindNotes ? (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Current strategy</summary>
                  <p className="mt-2 whitespace-pre-line text-muted-foreground">{channel.mastermindNotes}</p>
                </details>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">The mastermind hasn&apos;t run on this channel yet. It runs within the next Autopilot run, or now with the button above.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4 text-amber-300" /> Needs you
              {requests.length ? <span className="rounded-full bg-amber-500/20 px-2 text-xs text-amber-200">{requests.length}</span> : null}
            </CardTitle>
            <CardDescription className="mt-1.5">Only what the mastermind can&apos;t do itself.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <RequestsInbox requests={requests.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, channelName: r.channel.name, ago: timeAgo(r.createdAt, now) }))} />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4 text-brand-2" /> Brand studio
            </CardTitle>
            <CardDescription className="mt-1.5">Profile picture, banner and community posts designed to turn visitors into subscribers.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <BrandStudio
            channelId={channel.id}
            canSetBanner={canSetBanner(channel)}
            assets={assets.map((a) => ({ id: a.id, kind: a.kind as "avatar" | "banner" | "post", imageUrl: a.imageUrl, text: a.text, applied: Boolean(a.appliedAt), ago: timeAgo(a.createdAt, now) }))}
          />
        </CardContent>
      </Card>

      <ChannelForm channelId={channel.id} initial={channel} youtubeConnected={Boolean(channel.youtubeChannelId)} />
    </div>
  );
}
