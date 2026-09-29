import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { firstFreeSlot, formatSlot } from "@/services/schedule";
import { NewProjectForm } from "./new-project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ channelId?: string; at?: string }> }) {
  const { channelId, at } = await searchParams;
  const now = new Date();
  const [channels, taken] = await Promise.all([
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } }),
    prisma.videoProject.findMany({ where: { scheduledFor: { gte: now } }, select: { channelId: true, scheduledFor: true } }),
  ]);

  if (channels.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="New video" description="Create a channel first; it sets the niche, voice and schedule." />
        <Link href="/channels/new" className={buttonVariants()}>
          Create a channel
        </Link>
      </div>
    );
  }

  const options = channels.map((c) => {
    const slot = firstFreeSlot(c, taken.filter((t) => t.channelId === c.id).map((t) => t.scheduledFor!), now);
    return {
      id: c.id,
      name: c.name,
      defaultFormat: c.defaultFormat,
      hasSchedule: Boolean(c.postingCron),
      nextFreeSlot: slot ? formatSlot(slot, c.postingTimezone) : null,
    };
  });
  const validAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New video" description="Start with a topic. You'll review every scene before anything renders." />
      <NewProjectForm channels={options} initialChannelId={channels.some((c) => c.id === channelId) ? channelId! : null} initialAt={validAt} />
    </div>
  );
}
