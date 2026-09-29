import { PageHeader } from "@/components/page-header";
import { ChannelForm } from "../channel-form";

export default function NewChannelPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New channel" description="You can connect it to YouTube after saving." />
      <ChannelForm channelId={null} initial={null} youtubeConnected={false} />
    </div>
  );
}
