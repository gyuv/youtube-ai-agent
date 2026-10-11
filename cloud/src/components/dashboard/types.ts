import type { ProjectStatus } from "@/generated/prisma/enums";

/** Dashboard rows as the client components receive them (dates as ISO strings). */
export interface VideoCard {
  id: string;
  title: string;
  topic: string;
  status: ProjectStatus;
  format: "SHORT" | "LONG_FORM";
  channelId: string;
  channelName: string;
  timeZone: string;
  thumbnail: string | null;
  renderedVideoUrl: string | null;
  youtubeVideoId: string | null;
  scheduledFor: string | null;
  slotLabel: string | null;
  goesLiveAt: string | null;
  updatedAt: string;
  updatedAgo: string;
  autopilot: boolean;
  missedSlot: boolean;
  youtubeLocked: boolean;
  lastError: string | null;
  scenesReady: number;
  sceneCount: number;
  viewCount: number | null;
}

export interface WeekEntry {
  key: string;
  at: string;
  day: string;
  time: string;
  channelId: string;
  channelName: string;
  project: { id: string; title: string; status: ProjectStatus; thumbnail: string | null; movable: boolean; locked: boolean } | null;
}

export const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
