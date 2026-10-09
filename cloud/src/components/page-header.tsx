import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex animate-rise flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          <span className="bg-gradient-to-b from-white to-white/65 bg-clip-text text-transparent">{title}</span>
        </h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function timeAgo(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === "minute") return relative.format(Math.round(diff / ms), unit);
  }
  return "just now";
}
