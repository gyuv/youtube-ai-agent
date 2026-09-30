import { ProjectStatus } from "@/generated/prisma/enums";

/** Single source of truth for what each pipeline state allows; used by services and the UI. */

/** Operators may change scenes. In-flight renders and published videos are frozen. */
export const EDITABLE_STATUSES: readonly ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.SCRIPTED,
  ProjectStatus.ASSETS_READY,
  ProjectStatus.RENDERED,
  ProjectStatus.FAILED,
];

/** A (re-)render may be dispatched. */
export const RENDERABLE_STATUSES: readonly ProjectStatus[] = [ProjectStatus.ASSETS_READY, ProjectStatus.RENDERED, ProjectStatus.FAILED];

/** How long a YouTube upload may hold a project before another attempt can take over. */
export const PUBLISH_LEASE_MS = 20 * 60_000;

/** Prisma filter: no YouTube upload is in progress (or the last one's lease has expired). */
export function publishLeaseFree(now: Date) {
  return { OR: [{ publishStartedAt: null }, { publishStartedAt: { lt: new Date(now.getTime() - PUBLISH_LEASE_MS) } }] };
}

/** A GitHub runner owns the project. */
export const IN_FLIGHT_STATUSES: readonly ProjectStatus[] = [ProjectStatus.QUEUED_FOR_RENDER, ProjectStatus.RENDERING];

export const STATUS_META: Record<ProjectStatus, { label: string; tone: string; pulse?: boolean }> = {
  DRAFT: { label: "Draft", tone: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/25" },
  SCRIPTED: { label: "Scripted", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25" },
  ASSETS_READY: { label: "Assets ready", tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/25" },
  QUEUED_FOR_RENDER: { label: "Queued", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25", pulse: true },
  RENDERING: { label: "Rendering", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25", pulse: true },
  RENDERED: { label: "Rendered", tone: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/25" },
  PUBLISHED: { label: "Published", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25" },
  FAILED: { label: "Failed", tone: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/25" },
};
