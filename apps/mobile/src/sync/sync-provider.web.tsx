import { createContext, useContext, type PropsWithChildren } from "react";

interface SyncContextValue {
  syncNow(): Promise<undefined>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: PropsWithChildren) {
  return (
    <SyncContext.Provider value={{ syncNow: async () => undefined }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used within SyncProvider.");
  return value;
}
