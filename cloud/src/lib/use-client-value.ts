"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * A browser-only value (time zone, local time) without a hydration mismatch: the server and the
 * hydration pass use `serverValue`, then React re-renders with the real one.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribe, read, () => serverValue);
}
