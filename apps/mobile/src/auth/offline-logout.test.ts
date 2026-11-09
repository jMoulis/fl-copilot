import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthSessionResponse } from "@fl-copilot/sync-contracts";
import {
  loadStoredSession,
  saveStoredSession,
  clearStoredSession,
  drainPendingLogouts,
} from "./auth-storage";
const runtime = vi.hoisted(() => ({
  values: new Map<string, string>(),
  failDelete: false,
  retire: vi.fn(async () => {}),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("../reminders/native", () => ({
  retirePrivateNotifications: runtime.retire,
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => runtime.values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    runtime.values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    if (runtime.failDelete) throw Error("storage unavailable");
    runtime.values.delete(key);
  },
}));
function session(token = "a".repeat(43)): AuthSessionResponse {
  return {
    accessToken: "memory-only",
    accessTokenExpiresAt: "2026-11-10T00:00:00Z",
    refreshToken: token,
    user: {
      id: randomUUID(),
      email: "owner@example.test",
      displayName: "Owner",
    },
    stores: [{ storeId: randomUUID(), name: "Store", role: "MANAGER" }],
  };
}
const pending = () =>
  JSON.parse(runtime.values.get("auth.pending-logouts") ?? "[]") as string[];
beforeEach(() => {
  runtime.values.clear();
  runtime.failDelete = false;
  runtime.retire.mockReset().mockResolvedValue(undefined);
});
it("persists revocation before erasing credentials, retires notifications without network, then retries after restart", async () => {
  const s = session();
  await saveStoredSession(s);
  await clearStoredSession();
  expect(pending()).toEqual([s.refreshToken]);
  expect(runtime.values.has("auth.refresh-token")).toBe(false);
  expect(runtime.values.has("auth.session-marker")).toBe(false);
  expect(runtime.retire).toHaveBeenCalledTimes(1);
  const revoke = vi.fn(async () => {
    throw Error("offline");
  });
  await expect(drainPendingLogouts(revoke)).rejects.toThrow("offline");
  expect(pending()).toEqual([s.refreshToken]);
  vi.resetModules();
  const restarted = await import("./auth-storage");
  expect(await restarted.loadStoredSession()).toBeNull();
  const ack = vi.fn(async () => {});
  await restarted.drainPendingLogouts(ack);
  expect(ack).toHaveBeenCalledExactlyOnceWith(s.refreshToken);
  expect(pending()).toEqual([]);
});
it("never restores credentials left behind after the durable logout intent", async () => {
  const s = session();
  await saveStoredSession(s);
  runtime.failDelete = true;
  await expect(clearStoredSession()).rejects.toThrow("storage unavailable");
  expect(pending()).toEqual([s.refreshToken]);
  runtime.failDelete = false;
  expect(await loadStoredSession()).toBeNull();
  await drainPendingLogouts(async () => {});
  expect(runtime.values.has("auth.refresh-token")).toBe(false);
  expect(runtime.values.has("auth.session-marker")).toBe(false);
});
it("an old revocation acknowledgement cannot clear a new login; new intents join the same drain", async () => {
  const first = session(),
    second = session("b".repeat(43)),
    third = session("c".repeat(43));
  await saveStoredSession(first);
  await clearStoredSession();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const revoke = vi.fn(async (token: string) => {
    if (token === first.refreshToken) await gate;
  });
  const drain = drainPendingLogouts(revoke);
  expect(drainPendingLogouts(revoke)).toBe(drain);
  await vi.waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
  await saveStoredSession(second);
  await clearStoredSession();
  await saveStoredSession(third);
  release();
  await drain;
  expect(revoke.mock.calls).toEqual([
    [first.refreshToken],
    [second.refreshToken],
  ]);
  expect((await loadStoredSession())?.marker.user.id).toBe(third.user.id);
  expect(runtime.values.get("auth.refresh-token")).toBe(third.refreshToken);
  expect(pending()).toEqual([]);
});
it("serializes privacy retirement before a replacement provider can persist its login", async () => {
  const old = session(),
    next = session("d".repeat(43));
  await saveStoredSession(old);
  let release!: () => void;
  runtime.retire.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const logout = clearStoredSession();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const saving = saveStoredSession(next);
  expect(runtime.values.has("auth.refresh-token")).toBe(false);
  release();
  await Promise.all([logout, saving]);
  expect((await loadStoredSession())?.marker.user.id).toBe(next.user.id);
  expect(pending()).toEqual([old.refreshToken]);
});
it("keeps the revocation intent when native retirement fails and denies the previous login", async () => {
  const s = session();
  await saveStoredSession(s);
  runtime.retire.mockRejectedValueOnce(Error("native unavailable"));
  await expect(clearStoredSession()).rejects.toThrow("native unavailable");
  expect(pending()).toEqual([s.refreshToken]);
  expect(await loadStoredSession()).toBeNull();
});
it("an unreadable intent list never exposes retained credentials or erases the unreadable proof", async () => {
  await saveStoredSession(session());
  runtime.values.set("auth.pending-logouts", "unreadable");
  await expect(loadStoredSession()).rejects.toThrow();
  expect(runtime.values.get("auth.pending-logouts")).toBe("unreadable");
  expect(runtime.values.has("auth.refresh-token")).toBe(true);
});

it("retires an orphaned credential instead of losing the ability to revoke it", async () => {
  const s = session();
  await saveStoredSession(s);
  runtime.values.delete("auth.session-marker");
  expect(await loadStoredSession()).toBeNull();
  expect(pending()).toEqual([s.refreshToken]);
  expect(runtime.values.has("auth.refresh-token")).toBe(false);
});
