import { createContext, createElement, useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TodaySummaryRepository, type TodaySummary } from "./today-summary";
import { useTodaySummary } from "./use-today-summary";

const runtime = vi.hoisted(() => ({
  sqlite: {},
  storeId: "store-a" as string | undefined,
}));
const Focus = createContext(true);
const Sync = createContext({
  pendingCount: 0,
  conflictCount: 0,
  failedCount: 0,
  lastSyncedAt: undefined as string | undefined,
  status: "synced",
});
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const focused = useContext(Focus);
    useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: { stores: runtime.storeId ? [{ storeId: runtime.storeId }] : [] },
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite }),
}));
vi.mock("../sync/sync-provider", () => ({ useSync: () => useContext(Sync) }));

let rendered: ReactTestRenderer | undefined;
let value: ReturnType<typeof useTodaySummary>;
let state = {
  pendingCount: 0,
  conflictCount: 0,
  failedCount: 0,
  lastSyncedAt: undefined as string | undefined,
  status: "synced",
};
function Probe() {
  value = useTodaySummary();
  return null;
}
async function render(focused = true) {
  await act(async () => {
    const element = createElement(
      Focus.Provider,
      { value: focused },
      createElement(
        Sync.Provider,
        { value: { ...state } },
        createElement(Probe),
      ),
    );
    if (rendered) rendered.update(element);
    else rendered = create(element);
  });
}
function summary(businessDate = "2026-10-23"): TodaySummary {
  return {
    businessDate,
    computedAt: "2026-10-23T12:00:00Z",
    origin: "LOCAL",
    productCount: 0,
    kpis: [],
    priorities: [],
    movements: [],
    tensions: [],
    dataQuality: {
      unresolvedProductCount: 0,
      incompleteKpiLabels: [],
      alertMessage: null,
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    original(...args);
  });
  runtime.storeId = "store-a";
  state = {
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
    lastSyncedAt: undefined,
    status: "synced",
  };
});
afterEach(async () => {
  await act(() => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});

it("retains the snapshot through 100 sync counter changes and reads once the pipeline settles", async () => {
  const cached = summary("2026-10-22"),
    updated = summary();
  const read = vi
    .spyOn(TodaySummaryRepository.prototype, "load")
    .mockResolvedValueOnce(cached)
    .mockResolvedValue(updated);
  await render();
  expect(value.summary).toBe(cached);
  state.status = "syncing";
  for (let pending = 100; pending >= 0; pending--) {
    state.pendingCount = pending;
    await render();
    expect(value.summary).toBe(cached);
    expect(value.loading).toBe(false);
  }
  expect(read).toHaveBeenCalledTimes(1);
  state.status = "synced";
  state.lastSyncedAt = "2026-10-23T13:00:00Z";
  await render();
  expect(read).toHaveBeenCalledTimes(2);
  expect(value.summary).toBe(updated);
});

it("refreshes a successful pull with unchanged counters and no intermediate rendered sync status", async () => {
  const updated = summary();
  const read = vi
    .spyOn(TodaySummaryRepository.prototype, "load")
    .mockResolvedValueOnce(summary("2026-10-22"))
    .mockResolvedValue(updated);
  await render();
  state.lastSyncedAt = "2026-10-23T13:00:00Z";
  await render();
  expect(read).toHaveBeenCalledTimes(2);
  expect(value.summary).toBe(updated);
});

it("reads existing SQLite data on a first visit during sync without waiting for the network", async () => {
  state.status = "syncing";
  state.pendingCount = 100;
  const cached = summary();
  const read = vi
    .spyOn(TodaySummaryRepository.prototype, "load")
    .mockResolvedValue(cached);
  await render();
  expect(value.summary).toBe(cached);
  expect(value.loading).toBe(false);
  state.pendingCount = 99;
  await render();
  expect(read).toHaveBeenCalledTimes(1);
});

it("keeps offline figures after a refresh failure and supports deliberate retry", async () => {
  const cached = summary();
  const read = vi
    .spyOn(TodaySummaryRepository.prototype, "load")
    .mockResolvedValueOnce(cached)
    .mockRejectedValueOnce(new Error("locked"))
    .mockResolvedValue(cached);
  await render();
  state.status = "offline";
  await render();
  expect(value.summary).toBe(cached);
  expect(value.error).toBeDefined();
  expect(value.loading).toBe(false);
  await act(async () => {
    await value.refresh();
  });
  expect(read).toHaveBeenCalledTimes(3);
  expect(value.error).toBeUndefined();
  expect(value.refreshing).toBe(false);
  expect(value.summary).toBe(cached);
});

it("does not read on hidden tabs and reloads current local values on return", async () => {
  const read = vi
    .spyOn(TodaySummaryRepository.prototype, "load")
    .mockResolvedValue(summary());
  await render();
  await render(false);
  state.lastSyncedAt = "2026-10-23T13:00:00Z";
  await render(false);
  expect(read).toHaveBeenCalledTimes(1);
  await render();
  expect(read).toHaveBeenCalledTimes(2);
});

it("ignores a late former-store read after the active store changes", async () => {
  let complete!: (value: TodaySummary) => void;
  vi.spyOn(TodaySummaryRepository.prototype, "load")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(null);
  await render();
  runtime.storeId = "store-b";
  await render();
  await act(async () => {
    complete(summary());
  });
  expect(value.summary).toBeNull();
  expect(value.loading).toBe(false);
  runtime.storeId = undefined;
  await render();
  expect(value.storeMissing).toBe(true);
  expect(value.summary).toBeNull();
});
