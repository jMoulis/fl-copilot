import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { AuthSessionResponse } from "@fl-copilot/sync-contracts";
import { authSessionResponseSchema } from "@fl-copilot/sync-contracts";
import { z } from "zod";

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

/** Preserve only original ownership, never credentials, before confirmed database isolation logs out. */
export async function clearStoredSessionForDatabaseRecovery(
  generation: string,
) {
  z.uuid().parse(generation);
  if (Platform.OS === "web") throw new Error("LOCAL_RECOVERY_NATIVE_ONLY");
  const raw = await SecureStore.getItemAsync(SESSION_MARKER_KEY);
  let marker: StoredSessionMarker | null = null;
  if (raw) {
    try {
      marker = authSessionResponseSchema
        .pick({ user: true, stores: true })
        .parse(JSON.parse(raw));
    } catch {
      /* Unknown ownership is retained as unknown, never inferred from the new login. */
    }
  }
  const value = JSON.stringify({
    version: 1,
    ownerId: marker?.user.id ?? null,
    storeIds: marker?.stores.map((store) => store.storeId) ?? [],
  });
  const key = `auth.local-recovery.${generation}`;
  const existing = await SecureStore.getItemAsync(key);
  if (existing !== null && existing !== value)
    throw new Error("LOCAL_RECOVERY_OWNER_CHANGED");
  await SecureStore.setItemAsync(key, value);
  if ((await SecureStore.getItemAsync(key)) !== value)
    throw new Error("LOCAL_RECOVERY_OWNER_NOT_PERSISTED");
  await clearStoredSession();
}
