"use client";

import { CalendarDays, GripVertical, LoaderCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { moveToSlotAction } from "@/app/(studio)/actions";
import { MakeSlotButton } from "@/components/make-slot-button";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { Thumb } from "./now-strip";
import type { WeekEntry } from "./types";

const DRAG_TYPE = "application/x-lumen-project";

/**
 * The next seven days of posting slots as columns. Drag a planned video onto an open slot (same
 * channel) to move it there; open slots can be made on the spot.
 */
export function WeekBoard({ entries }: { entries: WeekEntry[] }) {
  const days = useMemo(() => {
    const map = new Map<string, WeekEntry[]>();
    for (const e of entries) map.set(e.day, [...(map.get(e.day) ?? []), e]);
    return [...map.entries()];
  }, [entries]);
  const [dragging, setDragging] = useState<{ projectId: string; channelId: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, startMove] = useTransition();
  const [movingTo, setMovingTo] = useState<string | null>(null);

  const drop = (entry: WeekEntry) => {
    const source = dragging;
    setOver(null);
    setDragging(null);
    if (!source || entry.project || source.channelId !== entry.channelId) return;
    setMovingTo(entry.key);
    startMove(async () => {
      const result = await moveToSlotAction(source.projectId, entry.at);
      setMovingTo(null);
      if (result.ok) toast.success(result.data.message);
      else toast.error(result.error);
    });
  };

  return (
    <section aria-label="This week" className="glass animate-rise rounded-3xl border p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold tracking-tight">
          <CalendarDays className="size-4 text-brand-1" /> This week
        </h2>
        <p className="text-xs text-muted-foreground">
          <GripVertical className="mr-0.5 inline size-3.5" />
          Drag a video onto an open slot to move it
        </p>
      </div>
      {days.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No posting slots this week.{" "}
          <Link href="/channels" className="text-foreground underline underline-offset-4">
            Set a posting schedule
          </Link>
        </p>
      ) : (
        <div className="scrollbar-none -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 lg:grid lg:grid-cols-7 lg:overflow-visible">
          {days.map(([day, list], i) => (
            <div key={day} className="w-44 shrink-0 snap-start lg:w-auto">
              <div className={cn("mb-2 flex items-baseline gap-1.5 px-1 text-xs", i === 0 ? "text-foreground" : "text-muted-foreground")}>
                <span className="font-semibold tracking-wide uppercase">{day.split(" ")[0]}</span>
                <span>{day.split(" ").slice(1).join(" ")}</span>
                {i === 0 ? <span className="ml-auto size-1.5 rounded-full bg-brand-2 shadow-[0_0_8px_var(--brand-2)]" aria-label="today" /> : null}
              </div>
              <ul className="grid gap-2">
                {list.map((entry) => {
                  const canDrop = Boolean(dragging && !entry.project && dragging.channelId === entry.channelId);
                  return (
                    <li
                      key={entry.key}
                      onDragOver={(e) => {
                        if (!canDrop) return;
                        e.preventDefault();
                        setOver(entry.key);
                      }}
                      onDragLeave={() => setOver((k) => (k === entry.key ? null : k))}
                      onDrop={(e) => {
                        e.preventDefault();
                        drop(entry);
                      }}
                      className={cn(
                        "rounded-2xl border p-2 text-xs transition-all duration-200",
                        entry.project ? "bg-white/[0.035]" : "border-dashed",
                        canDrop && "border-primary/50 bg-primary/[0.06]",
                        over === entry.key && "scale-[1.03] border-primary bg-primary/15 shadow-[0_0_24px_-6px_oklch(0.62_0.24_310/70%)]",
                        dragging && !canDrop && !entry.project && "opacity-40",
                      )}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-1 text-muted-foreground">
                        <span className="font-mono tabular-nums">{entry.time}</span>
                        <span className="truncate text-[10px]">{entry.channelName}</span>
                      </div>
                      {entry.project ? (
                        <div
                          draggable={entry.project.movable}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_TYPE, entry.project!.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDragging({ projectId: entry.project!.id, channelId: entry.channelId });
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setOver(null);
                          }}
                          className={cn("group flex gap-2", entry.project.movable && "cursor-grab active:cursor-grabbing", dragging?.projectId === entry.project.id && "opacity-50")}
                        >
                          <Thumb src={entry.project.thumbnail} className="h-12 w-9 rounded-lg" />
                          <div className="min-w-0 flex-1">
                            <Link href={`/projects/${entry.project.id}`} className="line-clamp-2 leading-snug font-medium text-foreground hover:underline" draggable={false}>
                              {entry.project.title}
                            </Link>
                            <StatusBadge status={entry.project.status} locked={entry.project.locked} className="mt-1 px-1.5 py-0 text-[10px]" />
                          </div>
                        </div>
                      ) : movingTo === entry.key && moving ? (
                        <div className="flex h-12 items-center justify-center gap-1.5 text-muted-foreground">
                          <LoaderCircle className="size-3.5 animate-spin" /> Moving…
                        </div>
                      ) : canDrop ? (
                        <div className="flex h-12 items-center justify-center gap-1 font-medium text-violet-200">
                          <Plus className="size-3.5" /> Drop here
                        </div>
                      ) : (
                        <div className="flex h-12 items-center justify-between gap-1">
                          <Link
                            href={`/projects/new?channelId=${entry.channelId}&at=${encodeURIComponent(entry.at)}`}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            Open slot
                          </Link>
                          <MakeSlotButton channelId={entry.channelId} at={entry.at} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
