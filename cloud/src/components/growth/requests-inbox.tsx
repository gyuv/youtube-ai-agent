"use client";

import { Check, Copy, Inbox, X } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { resolveRequestAction } from "@/app/(studio)/growth-lab/actions";
import { Button } from "@/components/ui/button";

export interface RequestView {
  id: string;
  kind: string;
  title: string;
  body: string;
  channelName: string;
  ago: string;
}

const KIND_LABEL: Record<string, string> = {
  avatar: "Profile picture",
  banner: "Banner",
  community_post: "Community post",
  live_video: "Live video",
  collaboration: "Collaboration",
  other: "Request",
};

/** What the mastermind needs from you: the only things it can't do on its own. */
export function RequestsInbox({ requests, showChannel }: { requests: RequestView[]; showChannel?: boolean }) {
  const [pending, start] = useTransition();
  const resolve = (id: string, status: "done" | "dismissed") =>
    start(async () => {
      const result = await resolveRequestAction(id, status);
      if (!result.ok) toast.error(result.error);
    });

  if (requests.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        <Inbox className="size-4" /> Nothing needs you. The mastermind is handling everything it can.
      </p>
    );
  }
  return (
    <ul className="grid gap-3">
      {requests.map((r) => (
        <li key={r.id} className="glow-edge rounded-2xl border bg-white/[0.03] p-4" data-active>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-violet-200">{KIND_LABEL[r.kind] ?? r.kind}</span>
            {showChannel ? <span>{r.channelName}</span> : null}
            <span className="ml-auto">{r.ago}</span>
          </div>
          <p className="mt-2 font-medium">{r.title}</p>
          <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{r.body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => resolve(r.id, "done")}>
              <Check /> Done
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard?.writeText(r.body).then(() => toast.success("Copied."), () => toast.error("Couldn't copy."))}
            >
              <Copy /> Copy text
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => resolve(r.id, "dismissed")}>
              <X /> Dismiss
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
