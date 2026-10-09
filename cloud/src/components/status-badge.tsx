import type { ProjectStatus } from "@/generated/prisma/enums";
import { STATUS_META } from "@/lib/statuses";
import { cn } from "@/lib/utils";

/**
 * A video's stage. A published video is shown as "Scheduled" until its go-live time (YouTube holds it
 * private until then), and as "Private on YouTube" when YouTube locked it.
 */
export function StatusBadge({
  status,
  className,
  goesLiveAt,
  locked,
  timeZone,
}: {
  status: ProjectStatus;
  className?: string;
  /** Pass only when it is still in the future (callers compute this server-side). */
  goesLiveAt?: Date | null;
  locked?: boolean;
  timeZone?: string;
}) {
  let meta = STATUS_META[status];
  if (status === "PUBLISHED" && locked) {
    meta = { label: "Private on YouTube", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25" };
  } else if (status === "PUBLISHED" && goesLiveAt) {
    const when = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(goesLiveAt);
    meta = { label: `Scheduled · live ${when}`, tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25" };
  }
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap backdrop-blur", meta.tone, className)}>
      <span className={cn("size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]", meta.pulse && "animate-pulse")} aria-hidden />
      {meta.label}
    </span>
  );
}
