import type { PropsWithChildren } from "react";
export function ChatPushProvider({ children }: PropsWithChildren) {
  return children;
}
export function useChatPush() {
  return {
    enabled: false,
    emailEnabled: false,
    documentsEnabled: false,
    setEmailEnabled: async (enabled: boolean) => {
      void enabled;
    },
    setDocumentsEnabled: async (enabled: boolean) => {
      void enabled;
    },
    ready: false,
    busy: false,
    available: false,
    error: undefined,
    setEnabled: async (enabled: boolean) => {
      void enabled;
    },
    refresh: async () => {},
  };
}
