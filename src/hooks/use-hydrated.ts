import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False during server render and hydration, true once React controls the page.
 * Forms stay disabled until then so input typed on a slow device is never lost
 * or merged with server-rendered values.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
