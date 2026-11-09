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

async function retireNotifications() {
  const native = await import("../reminders/native");
  await native.retirePrivateNotifications();
}

const REFRESH_TOKEN_KEY = "auth.refresh-token";
const SESSION_MARKER_KEY = "auth.session-marker";

export type StoredSessionMarker = Pick<AuthSessionResponse, "user" | "stores">;
type StoredSession = { refreshToken: string; marker: StoredSessionMarker };

let previewSession: StoredSession | null = null;
let previewLogouts: string[] = [];
const PENDING_LOGOUTS_KEY = "auth.pending-logouts";
const pendingLogoutsSchema = z.array(z.string().min(32));
// One credential writer across provider/database replacement as well as one manager.
let storageWork: Promise<unknown> = Promise.resolve();
function withStorage<T>(work: () => Promise<T>): Promise<T> {
  const task = storageWork.then(work);
  storageWork = task.catch(() => undefined);
  return task;
}
async function pendingLogouts() {
  if (Platform.OS === "web") return [...previewLogouts];
  const raw = await SecureStore.getItemAsync(PENDING_LOGOUTS_KEY);
  return raw === null ? [] : pendingLogoutsSchema.parse(JSON.parse(raw));
}
async function savePendingLogouts(values: string[]) {
  if (Platform.OS === "web") {
    previewLogouts = values;
    return;
  }
  if (values.length)
    await SecureStore.setItemAsync(PENDING_LOGOUTS_KEY, JSON.stringify(values));
  else await SecureStore.deleteItemAsync(PENDING_LOGOUTS_KEY);
}
async function clearCredentials() {
  previewSession = null;
  if (Platform.OS === "web") return;
  await Promise.all([
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(SESSION_MARKER_KEY),
  ]);
}
export function loadStoredSession(): Promise<StoredSession | null> {
  return withStorage(async () => {
    const pending = await pendingLogouts();
    const [refreshToken, marker] =
      Platform.OS === "web"
        ? [
            previewSession?.refreshToken,
            previewSession ? JSON.stringify(previewSession.marker) : null,
          ]
        : await Promise.all([
            SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
            SecureStore.getItemAsync(SESSION_MARKER_KEY),
          ]);
    if (!refreshToken || !marker || pending.includes(refreshToken)) {
      if (refreshToken && !marker) await persistLogoutAndClearCredentials();
      await retireNotifications();
      return null;
    }
    try {
      return {
        refreshToken,
        marker: authSessionResponseSchema
          .pick({ user: true, stores: true })
          .parse(JSON.parse(marker)),
      };
    } catch {
      try {
        await persistLogoutAndClearCredentials();
      } finally {
        await retireNotifications();
      }
      return null;
    }
  });
}
export function saveStoredSession(session: AuthSessionResponse) {
  return withStorage(async () => {
    const marker = { user: session.user, stores: session.stores };
    if (Platform.OS === "web") {
      previewSession = { refreshToken: session.refreshToken, marker };
      return;
    }
    await Promise.all([
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken),
      SecureStore.setItemAsync(SESSION_MARKER_KEY, JSON.stringify(marker)),
    ]);
  });
}
async function persistLogoutAndClearCredentials() {
  const token =
    Platform.OS === "web"
      ? previewSession?.refreshToken
      : await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (z.string().min(32).safeParse(token).success && token) {
    const pending = await pendingLogouts();
    if (!pending.includes(token)) await savePendingLogouts([...pending, token]);
  }
  await clearCredentials();
}
export function clearStoredSession() {
  return withStorage(async () => {
    try {
      // Persist the revocation intent first; interrupted clearing cannot restore this login.
      await persistLogoutAndClearCredentials();
    } finally {
      await retireNotifications();
    }
  });
}
let logoutDrain: Promise<void> | undefined;
/** Foreground/auth events retry the same secrets; no authenticated session or timer is needed. */
export function drainPendingLogouts(revoke: (token: string) => Promise<void>) {
  if (logoutDrain) return logoutDrain;
  const attempt = (async () => {
    while (true) {
      const pending = await withStorage(pendingLogouts);
      const token = pending[0];
      if (!token) return;
      await revoke(token);
      await withStorage(async () => {
        const currentToken =
          Platform.OS === "web"
            ? previewSession?.refreshToken
            : await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
        // A previous process may have stopped between intent persistence and credential clearing.
        if (currentToken === token) await clearCredentials();
        const latest = await pendingLogouts();
        await savePendingLogouts(latest.filter((value) => value !== token));
      });
    }
  })();
  logoutDrain = attempt;
  void attempt
    .finally(() => {
      if (logoutDrain === attempt) logoutDrain = undefined;
    })
    .catch(() => undefined);
  return attempt;
}

/** No token or personal profile field is read or archived by local-copy ownership. */
export async function currentDatabaseOwner(): Promise<RecoveryOwner> {
  if (Platform.OS === "web") throw new Error("LOCAL_RECOVERY_NATIVE_ONLY");
  await storageWork;
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
  if (!owner?.ownerId) throw new LocalCopyError("UNAVAILABLE");
  if (owner.ownerId !== expectedOwnerId) throw new LocalCopyError("OWNER");
  const verified = await SecureStore.getItemAsync(
    `auth.local-restore-verified.${generation}`,
  );
  if (verified === expectedOwnerId) return;
  if (verified !== null) throw new LocalCopyError("UNAVAILABLE");
  if (actualOwnerId !== expectedOwnerId) throw new LocalCopyError("OWNER");
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
