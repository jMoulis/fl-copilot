import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { AuthSessionResponse } from "@fl-copilot/sync-contracts";

const REFRESH_TOKEN_KEY = "auth.refresh-token";
const SESSION_MARKER_KEY = "auth.session-marker";

export type StoredSessionMarker = Pick<AuthSessionResponse, "user" | "stores">;
type StoredSession = { refreshToken: string; marker: StoredSessionMarker };

let previewSession: StoredSession | null = null;

export async function loadStoredSession(): Promise<StoredSession | null> {
  if (Platform.OS === "web") return previewSession;
  const [refreshToken, marker] = await Promise.all([
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.getItemAsync(SESSION_MARKER_KEY),
  ]);
  if (!refreshToken || !marker) return null;
  try {
    return { refreshToken, marker: JSON.parse(marker) as StoredSessionMarker };
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function saveStoredSession(session: AuthSessionResponse) {
  const marker = { user: session.user, stores: session.stores };
  if (Platform.OS === "web") {
    previewSession = { refreshToken: session.refreshToken, marker };
    return;
  }
  await Promise.all([
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken),
    SecureStore.setItemAsync(SESSION_MARKER_KEY, JSON.stringify(marker)),
  ]);
}

export async function clearStoredSession() {
  if (Platform.OS === "web") {
    previewSession = null;
    return;
  }
  await Promise.all([
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(SESSION_MARKER_KEY),
  ]);
}
