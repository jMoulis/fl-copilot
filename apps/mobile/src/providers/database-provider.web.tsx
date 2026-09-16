import type { PropsWithChildren } from "react";

/**
 * The browser build is a UI preview. The production data path is native SQLite.
 */
export function DatabaseProvider({ children }: PropsWithChildren) {
  return children;
}

export function useLocalDatabase(): never {
  throw new Error("Local SQLite is only available in native builds.");
}
