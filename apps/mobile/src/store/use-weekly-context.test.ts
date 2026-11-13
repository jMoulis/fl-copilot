import { createContext, createElement, useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "@fl-copilot/api-client";
import type { WeeklyContext } from "@fl-copilot/domain";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { StoreContextRepository } from "./context-repository";
import { WeeklyContextRepository } from "./weekly-context-repository";
import { useWeeklyContext } from "./use-weekly-context";

const runtime = vi.hoisted(() => ({
  sqlite: {},
  token: async (work: (s: string) => Promise<unknown>) => work("token"),
}));
const Focus = createContext(true),
  Sync = createContext({ lastSyncedAt: undefined as string | undefined });
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const focus = useContext(Focus);
    useEffect(() => (focus ? callback() : undefined), [focus, callback]);
  },
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: { user: { id: "owner" } },
    withAccessToken: runtime.token,
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite }),
}));
vi.mock("../sync/sync-provider", () => ({ useSync: () => useContext(Sync) }));
vi.mock("../config/environment", () => ({
  getApiBaseUrl: () => "https://test.invalid",
}));
let rendered: ReactTestRenderer | undefined;
let value: ReturnType<typeof useWeeklyContext>;
let settings = storeContextFixture(),
  cached = weeklyContextFixture(settings);
let auto = false;
function Probe() {
  value = useWeeklyContext(settings.storeId, cached.weekStart, auto);
  return null;
}
async function render(focus = true, lastSyncedAt?: string) {
  await act(async () => {
    const element = createElement(
      Focus.Provider,
      { value: focus },
      createElement(
        Sync.Provider,
        { value: { lastSyncedAt } },
        createElement(Probe),
      ),
    );
    if (rendered) rendered.update(element);
    else rendered = create(element);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
  settings = storeContextFixture();
  cached = weeklyContextFixture(settings);
  auto = false;
  vi.spyOn(StoreContextRepository.prototype, "get").mockImplementation(
    async () => ({
      entity: settings,
      syncState: "SYNCED",
      remoteVersion: 1,
      remote: settings,
      lastErrorCode: null,
    }),
  );
  vi.spyOn(WeeklyContextRepository.prototype, "get").mockImplementation(
    async () => cached,
  );
});
afterEach(async () => {
  await act(() => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});
it("reads cached content once through 100 renders and performs no implicit API call in the weekly view", async () => {
  const call = vi.spyOn(ApiClient.prototype, "weeklyContext");
  await render();
  expect(value.context).toBe(cached);
  for (let i = 0; i < 100; i++) await render();
  expect(WeeklyContextRepository.prototype.get).toHaveBeenCalledTimes(1);
  expect(call).not.toHaveBeenCalled();
});
it("retains local context on network failure and backs off rather than retrying on every focus", async () => {
  auto = true;
  const call = vi
    .spyOn(ApiClient.prototype, "weeklyContext")
    .mockRejectedValue(Error("Hors connexion"));
  await render();
  expect(value.context).toBe(cached);
  expect(value.error).toBe("Hors connexion");
  await render(false);
  await render(true);
  expect(call).toHaveBeenCalledTimes(1);
  expect(value.context).toBe(cached);
});
it("ignores a previous store's late refresh response before writing the local cache", async () => {
  auto = true;
  const previous = cached;
  let resolve!: (c: WeeklyContext) => void;
  const pending = new Promise<WeeklyContext>((r) => {
    resolve = r;
  });
  let resolveNext!: (c: WeeklyContext) => void;
  const next = new Promise<WeeklyContext>((r) => {
    resolveNext = r;
  });
  const call = vi
    .spyOn(ApiClient.prototype, "weeklyContext")
    .mockReturnValueOnce(pending)
    .mockReturnValueOnce(next);
  const save = vi
    .spyOn(WeeklyContextRepository.prototype, "save")
    .mockImplementation(async (input) => input);
  await render();
  expect(value.context).toBe(previous);
  settings = storeContextFixture();
  cached = weeklyContextFixture(settings);
  await render();
  expect(value.context?.storeId).toBe(settings.storeId);
  expect(call).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolveNext(cached);
    await next;
  });
  expect(value.busy).toBe(false);
  await act(async () => {
    resolve(previous);
    await pending;
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(cached, settings);
  expect(value.context?.storeId).toBe(settings.storeId);
});

it("collects only on explicit demand, deduplicates repeated presses and keeps local context while pending", async () => {
  let resolve!: (c: WeeklyContext) => void;
  const pending = new Promise<WeeklyContext>((r) => {
    resolve = r;
  });
  const call = vi
    .spyOn(ApiClient.prototype, "weeklyContext")
    .mockReturnValue(pending);
  const save = vi
    .spyOn(WeeklyContextRepository.prototype, "save")
    .mockImplementation(async (input) => input);
  await render();
  expect(call).not.toHaveBeenCalled();
  await act(async () => {
    void value.collect();
    void value.collect();
  });
  expect(value.busy).toBe(true);
  expect(value.context).toBe(cached);
  expect(call).toHaveBeenCalledExactlyOnceWith(
    "token",
    settings.storeId,
    cached.weekStart,
    true,
    false,
    false,
    false,
    true,
  );
  await act(async () => {
    resolve(cached);
    await pending;
  });
  expect(save).toHaveBeenCalledExactlyOnceWith(cached, settings);
  expect(value.busy).toBe(false);
});
it("preserves local context after a failed manual collection without automatic write retries", async () => {
  const call = vi
    .spyOn(ApiClient.prototype, "weeklyContext")
    .mockRejectedValue(Error("Hors connexion"));
  const save = vi.spyOn(WeeklyContextRepository.prototype, "save");
  await render();
  await act(async () => {
    await value.collect();
  });
  expect(value.context).toBe(cached);
  expect(value.busy).toBe(false);
  expect(value.error).toBe("Hors connexion");
  expect(save).not.toHaveBeenCalled();
  await render(false);
  await render(true);
  expect(call).toHaveBeenCalledTimes(1);
});
