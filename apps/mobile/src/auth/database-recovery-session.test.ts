import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { clearStoredSessionForDatabaseRecovery } from "./auth-storage";
const state = vi.hoisted(() => ({
  values: new Map<string, string>(),
  fail: false,
  reads: [] as string[],
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => {
    state.reads.push(key);
    return state.values.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    if (state.fail) throw Error("KEYCHAIN_FULL");
    state.values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    state.values.delete(key);
  },
}));
beforeEach(() => {
  state.values.clear();
  state.fail = false;
  state.reads = [];
});
function fixture() {
  const generation = randomUUID(),
    ownerId = randomUUID(),
    storeId = randomUUID();
  state.values.set(
    "auth.refresh-token",
    "private-refresh-token-not-for-archive",
  );
  state.values.set(
    "auth.session-marker",
    JSON.stringify({
      user: { id: ownerId, email: "owner@example.test", displayName: "Owner" },
      stores: [{ storeId, name: "Store", role: "MANAGER" }],
    }),
  );
  return {
    generation,
    ownerId,
    storeId,
    key: `auth.local-recovery.${generation}`,
  };
}
it("preserves original account/store identity before logout without reading/copying tokens or retaining personal fields", async () => {
  const f = fixture();
  await clearStoredSessionForDatabaseRecovery(f.generation);
  expect(JSON.parse(state.values.get(f.key)!)).toEqual({
    version: 1,
    ownerId: f.ownerId,
    storeIds: [f.storeId],
  });
  expect([...state.values.keys()]).toEqual([f.key]);
  expect(state.reads).not.toContain("auth.refresh-token");
  expect(state.values.get(f.key)).not.toContain("example.test");
  expect(state.values.get(f.key)).not.toContain("private-refresh");
});
it("preserves an unreadable or absent previous owner as unknown instead of assigning a future account", async () => {
  for (const marker of [
    null,
    "broken",
    JSON.stringify({ user: { id: "invalid" }, stores: [] }),
  ]) {
    const f = fixture();
    if (marker === null) state.values.delete("auth.session-marker");
    else state.values.set("auth.session-marker", marker);
    await clearStoredSessionForDatabaseRecovery(f.generation);
    expect(JSON.parse(state.values.get(f.key)!)).toEqual({
      version: 1,
      ownerId: null,
      storeIds: [],
    });
  }
});
it("does not clear credentials when ownership preservation fails or would overwrite another account", async () => {
  const f = fixture();
  state.fail = true;
  await expect(
    clearStoredSessionForDatabaseRecovery(f.generation),
  ).rejects.toThrow("KEYCHAIN_FULL");
  expect(state.values.has("auth.refresh-token")).toBe(true);
  state.fail = false;
  state.values.set(
    f.key,
    JSON.stringify({ version: 1, ownerId: randomUUID(), storeIds: [] }),
  );
  await expect(
    clearStoredSessionForDatabaseRecovery(f.generation),
  ).rejects.toThrow("LOCAL_RECOVERY_OWNER_CHANGED");
  expect(state.values.has("auth.session-marker")).toBe(true);
});
