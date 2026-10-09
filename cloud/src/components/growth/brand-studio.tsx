"use client";

import { Check, Copy, Download, ImagePlus, LoaderCircle, Megaphone, Sparkles, UserRound, Wand2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { applyBannerAction, generateBrandAssetAction, markBrandAssetUsedAction } from "@/app/(studio)/growth-lab/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BrandAssetView {
  id: string;
  kind: "avatar" | "banner" | "post";
  imageUrl: string | null;
  text: string | null;
  applied: boolean;
  ago: string;
}

const KINDS = [
  { kind: "avatar", label: "Profile picture", icon: UserRound, note: "Upload it yourself: YouTube has no API for profile pictures." },
  { kind: "banner", label: "Banner", icon: ImagePlus, note: "Lumen can set it on YouTube for you." },
  { kind: "post", label: "Community post", icon: Megaphone, note: "Copy it into YouTube Studio → Create → Post." },
] as const;

export function BrandStudio({ channelId, assets, canSetBanner }: { channelId: string; assets: BrandAssetView[]; canSetBanner: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  const generate = (kind: BrandAssetView["kind"]) => {
    setBusy(kind);
    start(async () => {
      const result = await generateBrandAssetAction(channelId, kind);
      setBusy(null);
      if (result.ok) toast.success("Generated. It's below.");
      else toast.error(result.error);
    });
  };
  const run = (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(key);
    start(async () => {
      const result = await fn();
      setBusy(null);
      if (result.ok) toast.success(ok);
      else toast.error(result.error ?? "Something went wrong.");
    });
  };

  return (
    <div className="grid gap-5">
      <div className="grid gap-2 sm:grid-cols-3">
        {KINDS.map(({ kind, label, icon: Icon, note }) => (
          <button
            key={kind}
            type="button"
            onClick={() => generate(kind)}
            disabled={busy !== null}
            className="glow-edge group rounded-2xl border bg-white/[0.02] p-3 text-left transition-all hover:bg-white/[0.05] disabled:opacity-60"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="bg-brand grid size-7 place-items-center rounded-lg text-white">
                {busy === kind ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
              </span>
              {busy === kind ? "Designing…" : `New ${label.toLowerCase()}`}
              <Wand2 className="ml-auto size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
            <span className="mt-2 block text-xs text-muted-foreground">{note}</span>
          </button>
        ))}
      </div>

      {assets.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
          <Sparkles className="size-4" /> Nothing generated yet. Each design follows the channel&apos;s niche, goal and current strategy.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <li key={a.id} className={cn("overflow-hidden rounded-2xl border bg-white/[0.03]", a.applied && "border-emerald-500/40")}>
              {a.imageUrl ? (
                <div className={cn("relative overflow-hidden bg-black", a.kind === "banner" ? "aspect-video" : "aspect-square")}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote storage URL */}
                  <img src={a.imageUrl} alt="" loading="lazy" className={cn("size-full object-cover", a.kind === "avatar" && "scale-90 rounded-full")} />
                  {a.kind === "banner" ? (
                    // What phones show: the centre 1235x338 of 2048x1152.
                    <span className="pointer-events-none absolute inset-x-[19.8%] inset-y-[35.3%] rounded border border-dashed border-white/60" title="Visible on every device" />
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-2 p-3 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="font-medium text-foreground capitalize">{a.kind === "post" ? "Community post" : a.kind === "avatar" ? "Profile picture" : "Banner"}</span>
                  <span>{a.applied ? <span className="text-emerald-300">✓ in use</span> : a.ago}</span>
                </div>
                {a.text ? <p className="line-clamp-5 whitespace-pre-line text-muted-foreground">{a.text}</p> : null}
                <div className="flex flex-wrap gap-1.5">
                  {a.imageUrl ? (
                    <a href={a.imageUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-white/5">
                      <Download className="size-3" /> Image
                    </a>
                  ) : null}
                  {a.text ? (
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(a.text!).then(() => toast.success("Copied."), () => toast.error("Couldn't copy."))}
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-white/5"
                    >
                      <Copy className="size-3" /> Text
                    </button>
                  ) : null}
                  {a.kind === "banner" && !a.applied ? (
                    <Button
                      size="sm"
                      className="h-6 px-2 text-xs"
                      disabled={!canSetBanner || busy !== null}
                      title={canSetBanner ? "Upload to YouTube and make it the channel banner" : "Reconnect YouTube to grant banner permission"}
                      onClick={() => run(a.id, () => applyBannerAction(a.id, channelId), "Banner set on YouTube.")}
                    >
                      {busy === a.id ? <LoaderCircle className="size-3 animate-spin" /> : <Check className="size-3" />} Set on YouTube
                    </Button>
                  ) : null}
                  {a.kind !== "banner" && !a.applied ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => run(a.id, () => markBrandAssetUsedAction(a.id, channelId), "Marked as in use.")}
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-white/5"
                    >
                      <Check className="size-3" /> I used it
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
