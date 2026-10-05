import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { listChannels } from "@/services/channels";
import { ResearchWorkspace } from "./research-workspace";

export const metadata: Metadata = { title: "Research" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function Page() {
  const channels = (await listChannels()).map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <PageHeader
        title="Research"
        description="Look up any YouTube video or playlist: details, stats and a searchable transcript you can export or turn into a new video."
      />
      <ResearchWorkspace channels={channels} />
    </>
  );
}
