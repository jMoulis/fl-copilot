import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { ApiClient } from "@fl-copilot/api-client";
import {
  NativeSessionManager,
  SessionChangedError,
  type SessionSnapshot,
} from "./session-manager";
import { getApiBaseUrl } from "@/config/environment";
import {
  useDatabaseAccessBinding,
  useDeviceIdentity,
} from "@/providers/database-provider";
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
  assertRestoredSessionOwner,
  markRestoredSessionVerified,
} from "./auth-storage";

type PendingChallenge = { challengeId: string; email: string };

type AuthContextValue = {
  status: "loading" | "anonymous" | "authenticated";
  session: SessionSnapshot["session"];
  sessionExpired: boolean;
  withAccessToken<T>(
    operation: (token: string) => Promise<T>,
    expectedOwnerId?: string,
  ): Promise<T>;
  pendingChallenge: PendingChallenge | null;
  requestCode(email: string): Promise<void>;
  verifyCode(code: string): Promise<void>;
  resendCode(): Promise<void>;
  changeEmail(): void;
  logout(options?: { localOnly?: boolean }): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const deviceId = useDeviceIdentity();
  const binding = useDatabaseAccessBinding();
  const accessOwnerId = binding?.ownerId,
    accessGeneration = binding?.generation;

  const [pendingChallenge, setPendingChallenge] =
    useState<PendingChallenge | null>(null);
  const api = useMemo(() => new ApiClient(getApiBaseUrl()), []);

  const manager = useMemo(
    () =>
      new NativeSessionManager(
        {
          load: async () => {
            const stored = await loadStoredSession();
            if (active.current !== manager) throw new SessionChangedError();
            if (accessOwnerId && accessGeneration && stored) {
              try {
                await assertRestoredSessionOwner(
                  accessGeneration,
                  accessOwnerId,
                  stored.marker.user.id,
                );
              } catch {
                await clearStoredSession();
                return null;
              }
            }
            return stored;
          },
          save: async (session) => {
            if (active.current !== manager) throw new SessionChangedError();
            if (accessOwnerId && accessGeneration)
              await assertRestoredSessionOwner(
                accessGeneration,
                accessOwnerId,
                session.user.id,
              );
            await saveStoredSession(session);
            if (accessOwnerId && accessGeneration)
              await markRestoredSessionVerified(
                accessGeneration,
                accessOwnerId,
                session.user.id,
              );
          },
          clear: clearStoredSession,
        },
        (token) => api.refreshSession(deviceId, token),
      ),
    [api, deviceId, accessOwnerId, accessGeneration],
  );
  const active = useRef<NativeSessionManager | null>(manager);
  const challengeEpoch = useRef(0);
  useLayoutEffect(() => {
    active.current = manager;
    return () => {
      active.current = null;
    };
  }, [manager]);
  const assertActive = useCallback(() => {
    if (active.current !== manager) throw new SessionChangedError();
  }, [manager]);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() =>
    manager.getSnapshot(),
  );
  const { status, session, sessionExpired } = snapshot;
  useEffect(() => {
    setSnapshot(manager.getSnapshot());
    const unsubscribe = manager.subscribe(setSnapshot);
    void manager.restore().catch(() => {
      if (active.current === manager) void manager.logout();
    });
    return unsubscribe;
  }, [manager]);
  const withAccessToken = useCallback(
    async <T,>(
      operation: (token: string) => Promise<T>,
      expectedOwnerId?: string,
    ) => {
      assertActive();
      return manager.request(operation, expectedOwnerId);
    },
    [manager, assertActive],
  );

  const requestCode = useCallback(
    async (email: string) => {
      assertActive();
      const epoch = ++challengeEpoch.current;
      const response = await api.requestLoginCode({
        email: email.trim().toLowerCase(),
        deviceId,
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
        appVersion: Constants.expoConfig?.version ?? "0.0.0",
      });
      assertActive();
      if (epoch !== challengeEpoch.current) throw new SessionChangedError();
      setPendingChallenge({
        challengeId: response.challengeId,
        email: email.trim().toLowerCase(),
      });
    },
    [api, deviceId, assertActive],
  );

  const verifyCode = useCallback(
    async (code: string) => {
      if (!pendingChallenge) throw new Error("Aucun code n’a été demandé.");
      assertActive();
      const epoch = challengeEpoch.current;
      const response = await api.verifyLoginCode(
        pendingChallenge.challengeId,
        code,
      );
      assertActive();
      if (epoch !== challengeEpoch.current) throw new SessionChangedError();
      await manager.establish(response);
      assertActive();
      setPendingChallenge(null);
    },
    [api, manager, pendingChallenge, assertActive],
  );

  const resendCode = useCallback(async () => {
    if (!pendingChallenge) throw new Error("Aucun code n’a été demandé.");
    await requestCode(pendingChallenge.email);
  }, [pendingChallenge, requestCode]);

  const changeEmail = useCallback(() => {
    challengeEpoch.current++;
    setPendingChallenge(null);
  }, []);

  const logout = useCallback(
    async (options?: { localOnly?: boolean }) => {
      assertActive();
      challengeEpoch.current++;
      const accessToken = manager.getSnapshot().session?.accessToken;
      await manager.logout();
      if (active.current === manager) setPendingChallenge(null);
      if (accessToken && !options?.localOnly) {
        try {
          await api.logout(accessToken);
        } catch {
          /* Local access is already cleared. */
        }
      }
    },
    [api, manager, assertActive],
  );

  return (
    <AuthContext.Provider
      value={{
        status,
        session,
        sessionExpired,
        withAccessToken,
        pendingChallenge,
        requestCode,
        verifyCode,
        resendCode,
        changeEmail,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
