import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { ApiClient } from "@fl-copilot/api-client";
import { NativeSessionManager, type SessionSnapshot } from "./session-manager";
import { getApiBaseUrl } from "@/config/environment";
import { useDeviceIdentity } from "@/providers/database-provider";
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
} from "./auth-storage";

type PendingChallenge = { challengeId: string; email: string };

type AuthContextValue = {
  status: "loading" | "anonymous" | "authenticated";
  session: SessionSnapshot["session"];
  sessionExpired: boolean;
  withAccessToken<T>(operation: (token: string) => Promise<T>): Promise<T>;
  pendingChallenge: PendingChallenge | null;
  requestCode(email: string): Promise<void>;
  verifyCode(code: string): Promise<void>;
  resendCode(): Promise<void>;
  changeEmail(): void;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const deviceId = useDeviceIdentity();

  const [pendingChallenge, setPendingChallenge] =
    useState<PendingChallenge | null>(null);
  const api = useMemo(() => new ApiClient(getApiBaseUrl()), []);

  const manager = useMemo(
    () =>
      new NativeSessionManager(
        {
          load: loadStoredSession,
          save: saveStoredSession,
          clear: clearStoredSession,
        },
        (token) => api.refreshSession(deviceId, token),
      ),
    [api, deviceId],
  );
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() =>
    manager.getSnapshot(),
  );
  const { status, session, sessionExpired } = snapshot;
  useEffect(() => {
    setSnapshot(manager.getSnapshot());
    const unsubscribe = manager.subscribe(setSnapshot);
    void manager.restore().catch(() => {
      void manager.logout();
    });
    return unsubscribe;
  }, [manager]);
  const withAccessToken = useCallback(
    <T,>(operation: (token: string) => Promise<T>) =>
      manager.request(operation),
    [manager],
  );

  const requestCode = useCallback(
    async (email: string) => {
      const response = await api.requestLoginCode({
        email: email.trim().toLowerCase(),
        deviceId,
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
        appVersion: Constants.expoConfig?.version ?? "0.0.0",
      });
      setPendingChallenge({
        challengeId: response.challengeId,
        email: email.trim().toLowerCase(),
      });
    },
    [api, deviceId],
  );

  const verifyCode = useCallback(
    async (code: string) => {
      if (!pendingChallenge) throw new Error("Aucun code n’a été demandé.");
      await manager.establish(
        await api.verifyLoginCode(pendingChallenge.challengeId, code),
      );
      setPendingChallenge(null);
    },
    [api, manager, pendingChallenge],
  );

  const resendCode = useCallback(async () => {
    if (!pendingChallenge) throw new Error("Aucun code n’a été demandé.");
    await requestCode(pendingChallenge.email);
  }, [pendingChallenge, requestCode]);

  const changeEmail = useCallback(() => setPendingChallenge(null), []);

  const logout = useCallback(async () => {
    const accessToken = manager.getSnapshot().session?.accessToken;
    await manager.logout();
    setPendingChallenge(null);
    if (accessToken) {
      try {
        await api.logout(accessToken);
      } catch {
        /* Local access is already cleared. */
      }
    }
  }, [api, manager]);

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
