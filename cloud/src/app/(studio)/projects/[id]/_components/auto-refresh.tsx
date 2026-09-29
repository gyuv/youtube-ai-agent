"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetch the page while a GitHub runner owns the project, so status changes appear on their own. */
export function AutoRefresh({ active, intervalMs = 8000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
