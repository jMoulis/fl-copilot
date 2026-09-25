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
import { ApiClient, ApiClientError } from "@fl-copilot/api-client";
import type { AuthSessionResponse } from "@fl-copilot/sync-contracts";
import { useDeviceIdentity } from "@/providers/database-provider";
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
} from "./auth-storage";

type SessionView = Pick<AuthSessionResponse, "user" | "stores"> & {
  accessToken?: string;
  accessTokenExpiresAt?: string;
};

type PendingChallenge = { challengeId: string; email: string };

type AuthContextValue = {
  status: "loading" | "anonymous" | "authenticated";
  session: SessionView | null;
  pendingChallenge: PendingChallenge | null;
  requestCode(email: string): Promise<void>;
  verifyCode(code: string): Promise<void>;
  resendCode(): Promise<void>;
  changeEmail(): void;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function defaultApiUrl() {
  if (Platform.OS === "android") return "http://10.0.2.2:3000";
  return "http://127.0.0.1:3000";
}

export function AuthProvider({ children }: PropsWithChildren) {
  const deviceId = useDeviceIdentity();
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [session, setSession] = useState<SessionView | null>(null);
  const [pendingChallenge, setPendingChallenge] =
    useState<PendingChallenge | null>(null);
  const api = useMemo(
    () => new ApiClient(process.env.EXPO_PUBLIC_API_URL ?? defaultApiUrl()),
    [],
  );

  const applySession = useCallback(async (next: AuthSessionResponse) => {
    await saveStoredSession(next);
    setSession({
      user: next.user,
      stores: next.stores,
      accessToken: next.accessToken,
      accessTokenExpiresAt: next.accessTokenExpiresAt,
    });
    setPendingChallenge(null);
    setStatus("authenticated");
  }, []);

  useEffect(() => {
    let active = true;

    void loadStoredSession()
      .then(async (stored) => {
        if (!active) return;
        if (!stored) {
          setStatus("anonymous");
          return;
        }
        setSession(stored.marker);
        setStatus("authenticated");
        try {
          const refreshed = await api.refreshSession(
            deviceId,
            stored.refreshToken,
          );
          if (active) await applySession(refreshed);
        } catch (error) {
          if (
            active &&
            error instanceof ApiClientError &&
            error.status === 401
          ) {
            await clearStoredSession();
            setSession(null);
            setStatus("anonymous");
          }
          // A network failure keeps the local authenticated marker usable offline.
        }
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setStatus("anonymous");
      });
    return () => {
      active = false;
    };
  }, [api, applySession, deviceId]);

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
      await applySession(
        await api.verifyLoginCode(pendingChallenge.challengeId, code),
      );
    },
    [api, applySession, pendingChallenge],
  );

  const resendCode = useCallback(async () => {
    if (!pendingChallenge) throw new Error("Aucun code n’a été demandé.");
    await requestCode(pendingChallenge.email);
  }, [pendingChallenge, requestCode]);

  const changeEmail = useCallback(() => setPendingChallenge(null), []);

  const logout = useCallback(async () => {
    const accessToken = session?.accessToken;
    if (accessToken) {
      try {
        await api.logout(accessToken);
      } catch {
        // Local access is cleared even when remote revocation must be retried later.
      }
    }
    await clearStoredSession();
    setSession(null);
    setPendingChallenge(null);
    setStatus("anonymous");
  }, [api, session?.accessToken]);

  return (
    <AuthContext.Provider
      value={{
        status,
        session,
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
