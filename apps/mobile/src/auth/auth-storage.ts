import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { AuthSessionResponse } from "@fl-copilot/sync-contracts";
import { authSessionResponseSchema } from "@fl-copilot/sync-contracts";
import { z } from "zod";
import {
  recoveryOwnerSchema,
  LocalCopyError,
  type RecoveryOwner,
} from "../db/local-copy-contracts";

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

/** No token or personal profile field is read or archived by local-copy ownership. */
export async function currentDatabaseOwner(): Promise<RecoveryOwner> {
  if (Platform.OS === "web") throw new Error("LOCAL_RECOVERY_NATIVE_ONLY");
  const raw = await SecureStore.getItemAsync(SESSION_MARKER_KEY);
  if (raw) {
    try {
      const marker = authSessionResponseSchema
        .pick({ user: true, stores: true })
        .parse(JSON.parse(raw));
      return {
        version: 1,
        ownerId: marker.user.id,
        storeIds: marker.stores.map((s) => s.storeId),
      };
    } catch {
      /* Unknown remains unknown, never inferred from a later login. */
    }
  }
  return { version: 1, ownerId: null, storeIds: [] };
}
export async function readDatabaseRecoveryOwner(
  id: string,
): Promise<RecoveryOwner | null> {
  z.uuid().parse(id);
  const raw = await SecureStore.getItemAsync(`auth.local-recovery.${id}`);
  return raw === null ? null : recoveryOwnerSchema.parse(JSON.parse(raw));
}
export async function preserveDatabaseRecoveryOwner(
  id: string,
  owner: RecoveryOwner,
) {
  z.uuid().parse(id);
  recoveryOwnerSchema.parse(owner);
  const key = `auth.local-recovery.${id}`;
  const existing = await readDatabaseRecoveryOwner(id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(owner))
    throw new Error("LOCAL_RECOVERY_OWNER_CHANGED");
  const value = JSON.stringify(owner);
  await SecureStore.setItemAsync(key, value);
  if ((await SecureStore.getItemAsync(key)) !== value)
    throw new Error("LOCAL_RECOVERY_OWNER_NOT_PERSISTED");
}
export async function assertDatabaseCopyOwner(
  ownerId: string,
  storeId: string,
) {
  const current = await currentDatabaseOwner();
  if (current.ownerId !== ownerId || !current.storeIds.includes(storeId))
    throw new LocalCopyError("OWNER");
  return current;
}
/** Preserve original ownership before confirmed isolation; retry after logout is idempotent. */
export async function clearStoredSessionForDatabaseRecovery(
  generation: string,
) {
  z.uuid().parse(generation);
  const current = await currentDatabaseOwner();
  const existing = await readDatabaseRecoveryOwner(generation);
  if (
    existing &&
    current.ownerId &&
    JSON.stringify(existing) !== JSON.stringify(current)
  )
    throw new Error("LOCAL_RECOVERY_OWNER_CHANGED");
  await preserveDatabaseRecoveryOwner(generation, existing ?? current);
  await clearStoredSession();
}

/** A restored copy requires its original owner once, then normal account switching resumes. */
export async function assertRestoredSessionOwner(
  generation: string,
  expectedOwnerId: string,
  actualOwnerId: string,
) {
  const owner = await readDatabaseRecoveryOwner(generation);
  if (owner?.ownerId !== expectedOwnerId) throw new LocalCopyError("OWNER");
  const verified = await SecureStore.getItemAsync(
    `auth.local-restore-verified.${generation}`,
  );
  if (verified === expectedOwnerId) return;
  if (verified !== null || actualOwnerId !== expectedOwnerId)
    throw new LocalCopyError("OWNER");
}
export async function markRestoredSessionVerified(
  generation: string,
  expectedOwnerId: string,
  actualOwnerId: string,
) {
  await assertRestoredSessionOwner(generation, expectedOwnerId, actualOwnerId);
  const key = `auth.local-restore-verified.${generation}`;
  if ((await SecureStore.getItemAsync(key)) === expectedOwnerId) return;
  // This marker is written only after the owner's normal authenticated session has been saved.
  if (actualOwnerId !== expectedOwnerId) throw new LocalCopyError("OWNER");
  await SecureStore.setItemAsync(key, expectedOwnerId);
  if ((await SecureStore.getItemAsync(key)) !== expectedOwnerId)
    throw new LocalCopyError("UNAVAILABLE");
}
