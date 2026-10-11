"use client";

import {
  ArrowDownUp,
  Bot,
  CalendarClock,
  CalendarX2,
  Check,
  Clapperboard,
  Columns3,
  Eye,
  Film,
  LayoutList,
  LoaderCircle,
  Play,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { bulkProjectsAction, type BulkKind } from "@/app/(studio)/actions";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-controls";
import { RENDERABLE_STATUSES } from "@/lib/statuses";
import { cn } from "@/lib/utils";
import { Thumb } from "./now-strip";
import { compactNumber, type VideoCard } from "./types";

const COLUMNS = [
  { key: "planned", label: "Planned", statuses: ["DRAFT"], accent: "from-zinc-400/60" },
  { key: "scripted", label: "Scripted", statuses: ["SCRIPTED"], accent: "from-sky-400/60" },
  { key: "assets", label: "Voice & visuals", statuses: ["ASSETS_READY"], accent: "from-indigo-400/60" },
  { key: "rendering", label: "Rendering", statuses: ["QUEUED_FOR_RENDER", "RENDERING"], accent: "from-amber-400/70" },
  { key: "rendered", label: "Rendered", statuses: ["RENDERED"], accent: "from-teal-400/60" },
  { key: "live", label: "On YouTube", statuses: ["PUBLISHED"], accent: "from-emerald-400/60" },
  { key: "failed", label: "Failed", statuses: ["FAILED"], accent: "from-red-400/70" },
] as const;

const FILTERS = {
  all: { label: "Everything", match: () => true },
  active: { label: "In production", match: (v: VideoCard) => v.status !== "PUBLISHED" },
  attention: { label: "Needs you", match: (v: VideoCard) => v.status === "FAILED" || v.youtubeLocked },
  missed: { label: "Missed slot", match: (v: VideoCard) => v.missedSlot },
  scheduled: { label: "Scheduled", match: (v: VideoCard) => Boolean(v.goesLiveAt) },
} as const;
type Filter = keyof typeof FILTERS;

const SORTS = {
  slot: { label: "Posting slot", compare: (a: VideoCard, b: VideoCard) => (a.scheduledFor ?? "9").localeCompare(b.scheduledFor ?? "9") },
  updated: { label: "Recently updated", compare: (a: VideoCard, b: VideoCard) => b.updatedAt.localeCompare(a.updatedAt) },
  views: { label: "Most views", compare: (a: VideoCard, b: VideoCard) => (b.viewCount ?? -1) - (a.viewCount ?? -1) },
  title: { label: "Title A–Z", compare: (a: VideoCard, b: VideoCard) => a.title.localeCompare(b.title) },
} as const;
type Sort = keyof typeof SORTS;

interface Prefs {
  view: "board" | "list";
  sort: Sort;
  channel: string;
}
const PREFS_KEY = "lumen.dashboard.prefs";
const DEFAULT_PREFS: Prefs = { view: "board", sort: "slot", channel: "all" };

// Remembered per browser through a tiny external store, so the server render stays deterministic.
let cachedRaw: string | null | undefined;
let cachedPrefs: Prefs = DEFAULT_PREFS;
const listeners = new Set<() => void>();

function readPrefs(): Prefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PREFS_KEY);
  } catch {
    /* storage blocked */
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedPrefs = { ...DEFAULT_PREFS, ...JSON.parse(raw ?? "{}") };
    } catch {
      cachedPrefs = DEFAULT_PREFS;
    }
  }
  return cachedPrefs;
}

function writePrefs(next: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    cachedPrefs = next; // private mode: kept for this page only
    cachedRaw = undefined;
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function PipelineBoard({ videos, channels, initialFilter }: { videos: VideoCard[]; channels: { id: string; name: string }[]; initialFilter: string }) {
  const prefs = useSyncExternalStore(subscribe, readPrefs, () => DEFAULT_PREFS);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter in FILTERS ? (initialFilter as Filter) : "all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<VideoCard | null>(null);

  const update = (patch: Partial<Prefs>) => writePrefs({ ...prefs, ...patch });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return videos
      .filter((v) => FILTERS[filter].match(v))
      .filter((v) => prefs.channel === "all" || v.channelId === prefs.channel)
      .filter((v) => !q || v.title.toLowerCase().includes(q) || v.topic.toLowerCase().includes(q))
      .sort(SORTS[prefs.sort].compare);
  }, [videos, filter, prefs.channel, prefs.sort, query]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedVideos = videos.filter((v) => selected.has(v.id));

  return (
    <section id="board" aria-label="Pipeline" className="glass animate-rise scroll-mt-24 rounded-3xl border">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto flex items-center gap-2 font-semibold tracking-tight">
            <Film className="size-4 text-brand-2" /> Pipeline
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs font-normal text-muted-foreground tabular-nums">{shown.length}</span>
          </h2>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search videos" aria-label="Search videos" className="h-8 pl-8 text-sm" />
          </div>
          {channels.length > 1 ? (
            <Select value={prefs.channel} onChange={(e) => update({ channel: e.target.value })} aria-label="Channel" className="h-8 w-auto text-sm">
              <option value="all">All channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : null}
          <label className="relative flex items-center">
            <ArrowDownUp className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
            <Select value={prefs.sort} onChange={(e) => update({ sort: e.target.value as Sort })} aria-label="Sort by" className="h-8 w-auto pl-8 text-sm">
              {(Object.keys(SORTS) as Sort[]).map((k) => (
                <option key={k} value={k}>
                  {SORTS[k].label}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex rounded-lg border bg-white/[0.03] p-0.5" role="group" aria-label="Layout">
            {(
              [
                ["board", Columns3, "Board"],
                ["list", LayoutList, "List"],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => update({ view: key })}
                aria-pressed={prefs.view === key}
                title={label}
                className={cn("grid size-7 place-items-center rounded-md transition-colors", prefs.view === key ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
        </div>
        <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filter">
          {(Object.keys(FILTERS) as Filter[]).map((key) => {
            const count = videos.filter((v) => FILTERS[key].match(v)).length;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs transition-all",
                  filter === key ? "bg-white/[0.08] font-medium text-foreground shadow-[0_0_0_1px_oklch(0.7_0.21_292/40%)]" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                {FILTERS[key].label}
                <span className={cn("ml-1.5 tabular-nums", key === "missed" && count ? "text-amber-300" : key === "attention" && count ? "text-red-300" : "opacity-60")}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="px-5 py-14 text-center text-sm text-muted-foreground">
          {query ? `No video matches "${query}".` : "Nothing here."}{" "}
          <Link href="/projects/new" className="text-foreground underline underline-offset-4">
            Start a new video
          </Link>
        </div>
      ) : prefs.view === "board" ? (
        <div className="scrollbar-none flex snap-x scroll-px-4 gap-3 overflow-x-auto p-4 sm:scroll-px-5 sm:p-5">
          {COLUMNS.map((col) => {
            const cards = shown.filter((v) => (col.statuses as readonly string[]).includes(v.status));
            if (cards.length === 0 && (col.key === "failed" || filter !== "all")) return null;
            return (
              <div key={col.key} className="flex w-64 shrink-0 snap-start flex-col">
                <div className="mb-2.5 flex items-center gap-2 px-1">
                  <span className={cn("h-3 w-1 rounded-full bg-gradient-to-b to-transparent", col.accent)} aria-hidden />
                  <span className="text-xs font-semibold tracking-wide uppercase">{col.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{cards.length}</span>
                </div>
                <div className="scrollbar-none grid max-h-[34rem] content-start gap-2.5 overflow-y-auto pr-0.5">
                  {cards.length === 0 ? <div className="rounded-2xl border border-dashed py-6 text-center text-xs text-muted-foreground">Empty</div> : null}
                  {cards.map((v) => (
                    <BoardCard key={v.id} video={v} selected={selected.has(v.id)} onToggle={() => toggle(v.id)} onPreview={() => setPreview(v)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y">
          {shown.map((v) => (
            <ListRow key={v.id} video={v} selected={selected.has(v.id)} onToggle={() => toggle(v.id)} onPreview={() => setPreview(v)} />
          ))}
        </ul>
      )}

      {selectedVideos.length > 0 ? <BulkBar videos={selectedVideos} onDone={() => setSelected(new Set())} /> : null}
      {preview ? <PreviewDialog video={preview} onClose={() => setPreview(null)} /> : null}
    </section>
  );
}

function SelectBox({ selected, onToggle, className }: { selected: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={selected}
      aria-label={selected ? "Deselect" : "Select"}
      className={cn(
        "relative z-10 grid size-5 place-items-center rounded-md border backdrop-blur transition-all",
        selected ? "border-transparent bg-primary text-white" : "border-white/30 bg-black/40 text-transparent hover:border-white/60",
        className,
      )}
    >
      <Check className="size-3" />
    </button>
  );
}

function SceneMeter({ video }: { video: VideoCard }) {
  if (video.sceneCount === 0) return <span className="text-[11px] text-muted-foreground">No script yet</span>;
  const ratio = video.scenesReady / video.sceneCount;
  return (
    <span className="flex items-center gap-1.5" title={`${video.scenesReady} of ${video.sceneCount} scenes have voice and visual`}>
      <span className="flex gap-0.5">
        {Array.from({ length: Math.min(video.sceneCount, 12) }, (_, i) => (
          <span key={i} className={cn("h-1.5 w-1.5 rounded-sm", i < Math.round(ratio * Math.min(video.sceneCount, 12)) ? (ratio === 1 ? "bg-emerald-400" : "bg-brand-1") : "bg-white/10")} />
        ))}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {video.scenesReady}/{video.sceneCount}
      </span>
    </span>
  );
}

function BoardCard({ video, selected, onToggle, onPreview }: { video: VideoCard; selected: boolean; onToggle: () => void; onPreview: () => void }) {
  const playable = Boolean(video.renderedVideoUrl || video.thumbnail);
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-white/[0.03] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white/[0.05]",
        selected && "border-primary/70 bg-primary/10 ring-1 ring-primary/40",
      )}
    >
      <div className="relative aspect-[16/9] overflow-hidden">
        <Thumb src={video.thumbnail} className="size-full rounded-none border-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" aria-hidden />
        <SelectBox selected={selected} onToggle={onToggle} className={cn("absolute top-2 left-2", !selected && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")} />
        {playable ? (
          <button
            type="button"
            onClick={onPreview}
            aria-label="Preview"
            className="absolute inset-0 z-[5] m-auto grid size-10 place-items-center rounded-full bg-white/15 text-white opacity-0 backdrop-blur transition-all group-hover:opacity-100 hover:scale-110 hover:bg-white/25"
          >
            {video.renderedVideoUrl ? <Play className="size-4 fill-current" /> : <Eye className="size-4" />}
          </button>
        ) : null}
        <div className="absolute top-2 right-2 flex gap-1">
          {video.autopilot ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-violet-200 backdrop-blur" title="Made by the autopilot">
              <Bot className="size-3" />
            </span>
          ) : null}
          <span className="rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80 backdrop-blur">{video.format === "SHORT" ? "9:16" : "16:9"}</span>
        </div>
        {video.viewCount !== null && video.status === "PUBLISHED" ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
            <Eye className="size-3" /> {compactNumber.format(video.viewCount)}
          </span>
        ) : null}
      </div>
      <div className="grid gap-1.5 p-3">
        <Link href={`/projects/${video.id}`} className="line-clamp-2 text-sm leading-snug font-medium after:absolute after:inset-0 after:z-[1] hover:underline">
          {video.title}
        </Link>
        <div className="truncate text-[11px] text-muted-foreground">{video.channelName}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {video.status === "PUBLISHED" || video.status === "FAILED" || video.youtubeLocked ? (
            <StatusBadge status={video.status} goesLiveAt={video.goesLiveAt ? new Date(video.goesLiveAt) : null} locked={video.youtubeLocked} timeZone={video.timeZone} className="px-1.5 py-0 text-[10px]" />
          ) : (
            <SceneMeter video={video} />
          )}
          {video.missedSlot ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-300">
              <CalendarX2 className="size-3" /> Missed
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarClock className="size-3 shrink-0" />
          <span className={cn("truncate", video.missedSlot && "line-through decoration-amber-500/60")}>{video.slotLabel ?? "Not scheduled"}</span>
        </div>
        {video.status === "FAILED" && video.lastError ? (
          <p className="line-clamp-2 text-[11px] text-red-300/90" title={video.lastError}>
            {video.lastError}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function ListRow({ video, selected, onToggle, onPreview }: { video: VideoCard; selected: boolean; onToggle: () => void; onPreview: () => void }) {
  return (
    <li className={cn("group relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-primary/[0.05] sm:px-5", selected && "bg-primary/10")}>
      <SelectBox selected={selected} onToggle={onToggle} />
      <button type="button" onClick={onPreview} className="relative z-10 shrink-0" aria-label="Preview">
        <Thumb src={video.thumbnail} className="h-10 w-16 rounded-lg" />
      </button>
      <div className="min-w-0 flex-1">
        <Link href={`/projects/${video.id}`} className="line-clamp-1 text-sm font-medium after:absolute after:inset-0 hover:underline">
          {video.title}
        </Link>
        <div className="truncate text-xs text-muted-foreground">
          {video.channelName} · {video.slotLabel ?? "Not scheduled"}
        </div>
      </div>
      <div className="hidden sm:block">
        <SceneMeter video={video} />
      </div>
      {video.viewCount !== null && video.status === "PUBLISHED" ? (
        <span className="hidden w-16 text-right text-xs text-muted-foreground tabular-nums md:inline">{compactNumber.format(video.viewCount)} views</span>
      ) : null}
      <StatusBadge status={video.status} goesLiveAt={video.goesLiveAt ? new Date(video.goesLiveAt) : null} locked={video.youtubeLocked} timeZone={video.timeZone} className="hidden sm:inline-flex" />
      {video.missedSlot ? <CalendarX2 className="size-4 shrink-0 text-amber-300" aria-label="Missed slot" /> : null}
      <span className="hidden w-24 text-right text-xs text-muted-foreground lg:inline">{video.updatedAgo}</span>
    </li>
  );
}

const BULK_LABEL: Record<BulkKind, string> = { reschedule: "moved to the next slots", render: "sent to the renderer", delete: "deleted" };

function BulkBar({ videos, onDone }: { videos: VideoCard[]; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const movable = videos.filter((v) => !v.youtubeVideoId && v.status !== "PUBLISHED" && v.status !== "RENDERING" && v.status !== "QUEUED_FOR_RENDER");
  const renderable = videos.filter((v) => (RENDERABLE_STATUSES as readonly string[]).includes(v.status) && v.sceneCount > 0 && v.scenesReady === v.sceneCount);
  const deletable = videos.filter((v) => v.status !== "RENDERING" && v.status !== "QUEUED_FOR_RENDER");

  const run = (kind: BulkKind, list: VideoCard[]) =>
    start(async () => {
      const result = await bulkProjectsAction(kind, list.map((v) => v.id));
      setConfirmDelete(false);
      if (!result.ok) return void toast.error(result.error);
      const { done, failed } = result.data;
      if (done) toast.success(`${done} video${done === 1 ? "" : "s"} ${BULK_LABEL[kind]}.`);
      if (failed.length) toast.error(`${failed.length} couldn't be ${BULK_LABEL[kind]}: ${failed[0]}`);
      onDone();
    });

  return (
    <div className="sticky bottom-4 z-20 mx-4 mb-4 flex animate-rise flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-[oklch(0.17_0.03_290)]/90 p-2 pl-4 shadow-[0_20px_50px_-12px_oklch(0_0_0/70%),0_0_0_1px_oklch(0.7_0.21_292/20%)] backdrop-blur-xl sm:mx-5">
      <span className="mr-auto text-sm font-medium">
        {videos.length} selected
      </span>
      {pending ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
      <Button size="sm" variant="outline" disabled={pending || movable.length === 0} onClick={() => run("reschedule", movable)} title="Move each to its channel's next free slot, keeping its files">
        <CalendarClock /> Next slots{movable.length !== videos.length ? ` (${movable.length})` : ""}
      </Button>
      <Button size="sm" variant="outline" disabled={pending || renderable.length === 0} onClick={() => run("render", renderable)} title="Send to the cloud renderer">
        <Clapperboard /> Render{renderable.length !== videos.length ? ` (${renderable.length})` : ""}
      </Button>
      {confirmDelete ? (
        <Button size="sm" variant="destructive" disabled={pending || deletable.length === 0} onClick={() => run("delete", deletable)}>
          <Trash2 /> Delete {deletable.length}?
        </Button>
      ) : (
        <Button size="sm" variant="ghost" className="text-red-300 hover:text-red-200" disabled={pending || deletable.length === 0} onClick={() => setConfirmDelete(true)}>
          <Trash2 /> Delete
        </Button>
      )}
      <Button size="icon-sm" variant="ghost" onClick={onDone} aria-label="Clear selection">
        <X />
      </Button>
    </div>
  );
}

function PreviewDialog({ video, onClose }: { video: VideoCard; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const vertical = video.format === "SHORT";
  return (
    <div role="dialog" aria-modal="true" aria-label={`Preview of ${video.title}`} className="fixed inset-0 z-50 grid animate-rise place-items-center bg-black/70 p-4 backdrop-blur-md" onClick={onClose}>
      <div className="glass w-full max-w-3xl overflow-hidden rounded-3xl border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{video.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {video.channelName} · {video.slotLabel ?? "Not scheduled"}
            </p>
          </div>
          <Link href={`/projects/${video.id}`} className="text-xs text-muted-foreground hover:text-foreground">
            Open in studio →
          </Link>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close preview">
            <X />
          </Button>
        </div>
        <div className="grid place-items-center bg-black">
          {video.renderedVideoUrl ? (
            <video src={video.renderedVideoUrl} controls autoPlay playsInline className={cn("max-h-[75vh] w-full", vertical && "aspect-[9/16] w-auto")} />
          ) : video.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote storage URL
            <img src={video.thumbnail} alt="" className="max-h-[75vh] w-auto" />
          ) : null}
        </div>
        {video.youtubeVideoId ? (
          <a href={`https://youtu.be/${video.youtubeVideoId}`} target="_blank" rel="noreferrer" className="block border-t px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground">
            Watch on YouTube ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
