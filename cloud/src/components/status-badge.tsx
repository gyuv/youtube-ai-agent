import type { ProjectStatus } from "@/generated/prisma/enums";
import { STATUS_META } from "@/lib/statuses";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap", meta.tone, className)}>
      <span className={cn("size-1.5 rounded-full bg-current", meta.pulse && "animate-pulse")} aria-hidden />
      {meta.label}
    </span>
  );
}
