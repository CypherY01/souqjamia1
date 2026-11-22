"use client";

// Task 4.0 (item C): false while the server renders and while React hydrates, then true. A
// control that only works with JavaScript stays disabled until then, so an early click is never
// lost without a sign (a full page load, a slow phone). Client-side navigations mount it as
// true at once: only a hydrated page has a getServerSnapshot pass.
import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => undefined;
}

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
