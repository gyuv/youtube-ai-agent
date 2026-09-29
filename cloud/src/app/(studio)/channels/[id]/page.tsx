import { CheckCircle2, Link2, Unlink, Youtube } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { GOOGLE_PERMISSIONS_URL } from "@/lib/publicInfo";
import { disconnectChannelAction } from "../actions";
import { ChannelForm } from "../channel-form";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, "success" | "error"> = { connected: "success", disconnected: "success", denied: "error", error: "error" };

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; youtube?: string; message?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const channel = await prisma.channel.findUnique({ where: { id } });
  if (!channel) notFound();

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
              Lumen asks only for upload access and your channel&apos;s name. Tokens are encrypted at rest. Disconnect revokes the access at
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

      <ChannelForm channelId={channel.id} initial={channel} youtubeConnected={Boolean(channel.youtubeChannelId)} />
    </div>
  );
}
