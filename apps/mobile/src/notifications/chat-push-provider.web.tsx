import type { PropsWithChildren } from "react";
export function ChatPushProvider({ children }: PropsWithChildren) {
  return children;
}
export function useChatPush() {
  return {
    enabled: false,
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
