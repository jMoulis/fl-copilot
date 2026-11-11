import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import type { DevicePushToken } from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { ApiClient } from "@fl-copilot/api-client";
import { expoPushTokenSchema } from "@fl-copilot/sync-contracts";
import { drainPendingLogouts } from "@/auth/auth-storage";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { getApiBaseUrl } from "@/config/environment";
import {
  notificationModule,
  nativeRegistrationIsCurrent,
  requestReminderPermission,
} from "@/reminders/native";
import { CoalescedReminderRunner } from "@/reminders/coalesced-runner";
import {
  ChatPushRegistration,
  type ChatPushState,
} from "./chat-push-registration";
type State = ChatPushState & {
  available: boolean;
  setDocumentsEnabled(enabled: boolean): Promise<void>;
  setEmailEnabled(enabled: boolean): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  refresh(): Promise<void>;
};
const Context = createContext<State | null>(null);
async function pushToken(
  native: { current: DevicePushToken | undefined },
  reading: { current: number },
  current: () => boolean,
) {
  const n = await notificationModule();
  const projectId =
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId;
  if (!current()) throw Error("CHAT_PUSH_CONTEXT_CHANGED");
  if (!n || !projectId) throw Error("CHAT_PUSH_UNAVAILABLE");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await Promise.race([
      (async () => {
        if (!native.current) {
          reading.current++;
          try {
            const token = await n.getDevicePushTokenAsync();
            native.current ??= token;
          } finally {
            reading.current--;
          }
        }
        if (!current()) throw Error("CHAT_PUSH_CONTEXT_CHANGED");
        return n.getExpoPushTokenAsync({
          projectId,
          devicePushToken: native.current,
        });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("CHAT_PUSH_TIMEOUT")), 15_000);
      }),
    ]);
    return expoPushTokenSchema.parse(token.data);
  } finally {
    clearTimeout(timer);
  }
}
export function ChatPushProvider({ children }: PropsWithChildren) {
  const { session, status, withAccessToken } = useAuth(),
    { deviceId, sqlite } = useLocalDatabase();
  const ownerId = session?.user.id,
    storeId = session?.stores[0]?.storeId;
  const scope = useMemo(
    () => ({ ownerId, storeId, deviceId, sqlite, status }),
    [ownerId, storeId, deviceId, sqlite, status],
  );
  const active = useRef<typeof scope | undefined>(scope);
  active.current = scope;
  const [state, setState] = useState<{
    scope: typeof scope;
    value: ChatPushState;
  }>();
  // Expo's native token read itself emits a token event. Reuse that value
  // instead of recursively asking native registration from its own listener.
  const nativeToken = useMemo(
    () => ({ scope, current: undefined as DevicePushToken | undefined }),
    [scope],
  );
  const nativeReads = useMemo(() => ({ scope, current: 0 }), [scope]);
  const available = Platform.OS === "ios" && Constants.appOwnership !== "expo";
  const registration = useMemo(() => {
    const key = `fl.chat-push.${ownerId}.${storeId}.${deviceId}`;
    const nativeCurrent = nativeRegistrationIsCurrent();
    const current = () =>
      active.current === scope &&
      available &&
      status === "authenticated" &&
      !!ownerId &&
      !!storeId &&
      nativeCurrent();
    return new ChatPushRegistration({
      current,
      read: () => SecureStore.getItemAsync(key),
      write: (value) => SecureStore.setItemAsync(key, value),
      email: {
        read: () =>
          SecureStore.getItemAsync(
            `fl.email-push.${ownerId}.${storeId}.${deviceId}`,
          ),
        write: (value) =>
          SecureStore.setItemAsync(
            `fl.email-push.${ownerId}.${storeId}.${deviceId}`,
            value,
          ),
      },
      documents: {
        read: () =>
          SecureStore.getItemAsync(
            `fl.documents-push.${ownerId}.${storeId}.${deviceId}`,
          ),
        write: (value) =>
          SecureStore.setItemAsync(
            `fl.documents-push.${ownerId}.${storeId}.${deviceId}`,
            value,
          ),
      },
      permission: async (request) => {
        if (request) return requestReminderPermission();
        const n = await notificationModule();
        if (!n) return false;
        const p = await n.getPermissionsAsync();
        return (
          p.granted || p.ios?.status === n.IosAuthorizationStatus.PROVISIONAL
        );
      },
      token: async () => {
        await drainPendingLogouts((token) =>
          new ApiClient(getApiBaseUrl()).logoutSession(token),
        );
        if (!current()) throw Error("CHAT_PUSH_CONTEXT_CHANGED");
        return pushToken(nativeToken, nativeReads, current);
      },
      save: (token, channels) =>
        withAccessToken((accessToken) => {
          if (active.current !== scope)
            throw Error("CHAT_PUSH_CONTEXT_CHANGED");
          return new ApiClient(getApiBaseUrl()).updateDevicePushToken(
            accessToken,
            deviceId,
            storeId!,
            token,
            channels,
          );
        }, ownerId),
      publish: (value) => {
        if (active.current === scope) setState({ scope, value });
      },
    });
  }, [
    scope,
    available,
    status,
    ownerId,
    storeId,
    deviceId,
    withAccessToken,
    nativeToken,
    nativeReads,
  ]);
  const queue = useMemo(() => new CoalescedReminderRunner(), []);
  const refresh = useMemo(
    () => () => queue.run(() => registration.refresh()),
    [queue, registration],
  );
  useEffect(() => {
    active.current = scope;
    if (AppState.currentState === "active") void refresh();
    const subscription = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    let stop: (() => void) | undefined,
      alive = true;
    if (available)
      void notificationModule()
        .then((n) => {
          if (!n || !alive) return;
          const listener = n.addPushTokenListener((token) => {
            const previous = nativeToken.current;
            // An unsolicited late event does not prove this session registered with iOS.
            if (!previous) return;
            nativeToken.current = token;
            if (
              nativeReads.current === 0 &&
              (previous?.type !== token.type || previous.data !== token.data) &&
              AppState.currentState === "active"
            )
              void refresh();
          });
          stop = () => listener.remove();
        })
        .catch(() => undefined);
    return () => {
      alive = false;
      if (active.current === scope) active.current = undefined;
      stop?.();
      subscription.remove();
    };
  }, [
    refresh,
    available,
    scope,
    session?.accessToken,
    nativeToken,
    nativeReads,
  ]);
  const value =
    state?.scope === scope
      ? state.value
      : { enabled: false, ready: false, busy: false };
  return (
    <Context.Provider
      value={{
        ...value,
        available,
        setDocumentsEnabled: (enabled) =>
          registration.setDocumentsEnabled(enabled),
        setEmailEnabled: (enabled) => registration.setEmailEnabled(enabled),
        setEnabled: (enabled) => registration.setEnabled(enabled),
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useChatPush() {
  const value = useContext(Context);
  if (!value) throw Error("ChatPushProvider absent");
  return value;
}
