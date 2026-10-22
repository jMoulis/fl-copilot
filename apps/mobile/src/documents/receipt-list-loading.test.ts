import { createContext, createElement, useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WasteScreen from "../app/(tabs)/waste";
import type { ReceiptList } from "./receipt-list";
import type { ComponentProps } from "react";
import type { LocalWasteReceiptSummary } from "./waste-receipt-repository";

const runtime = vi.hoisted(() => ({
  list: vi.fn(),
  db: {},
  owner: "owner",
  store: "store",
}));
const Focus = createContext(true);
const Sync = createContext({
  status: "syncing",
  lastSyncedAt: undefined as string | undefined,
});
let latest: ComponentProps<typeof ReceiptList>;
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useFocusEffect: (callback: () => void | (() => void)) => {
    const focused = useContext(Focus);
    useEffect(() => (focused ? callback() : undefined), [focused, callback]);
  },
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: runtime.owner },
      stores: [{ storeId: runtime.store }],
    },
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.db }),
}));
vi.mock("../sync/sync-provider", () => ({ useSync: () => useContext(Sync) }));
vi.mock("../components/ui", () => ({
  AppHeader: () => null,
  AppScreen: () => null,
  InlineAlert: () => null,
}));
vi.mock("./waste-receipt-repository", () => ({
  WasteReceiptRepository: class {
    listReceipts = runtime.list;
  },
}));
vi.mock("./receipt-list", () => ({
  ReceiptList: (props: ComponentProps<typeof ReceiptList>) => {
    latest = props;
    return null;
  },
}));

const ticket = {
  receipt: { id: "ticket" },
  uploadJob: null,
} as LocalWasteReceiptSummary;
let renderer: ReactTestRenderer | undefined;
function tree(status = "syncing", focused = true, lastSyncedAt?: string) {
  return createElement(
    Focus.Provider,
    { value: focused },
    createElement(
      Sync.Provider,
      { value: { status, lastSyncedAt } },
      createElement(WasteScreen),
    ),
  );
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  runtime.list.mockReset().mockResolvedValue([ticket]);
  runtime.owner = "owner";
  runtime.store = "store";
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.useRealTimers();
});
it("reads retained local tickets even while a synchronization never finishes", async () => {
  await act(async () => {
    renderer = create(tree());
  });
  expect(runtime.list).toHaveBeenCalledWith("store");
  expect(latest.receipts).toEqual([ticket]);
  expect(latest.loading).toBe(false);
});
it("does not discard an in-flight local read when synchronization starts", async () => {
  let release!: (rows: LocalWasteReceiptSummary[]) => void;
  runtime.list.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await act(async () => {
    renderer = create(tree("pending"));
  });
  await act(async () => renderer!.update(tree("syncing")));
  await act(async () => release([ticket]));
  expect(runtime.list).toHaveBeenCalledTimes(1);
  expect(latest.receipts).toEqual([ticket]);
  expect(latest.loading).toBe(false);
});
it("preserves displayed tickets and exposes a failed local refresh instead of clearing the list", async () => {
  await act(async () => {
    renderer = create(tree());
  });
  runtime.list.mockRejectedValueOnce(Error("local read failed"));
  await act(async () => latest.onRefresh());
  expect(latest.receipts).toEqual([ticket]);
  expect(latest.error).toContain("restent conservées");
  expect(latest.refreshing).toBe(false);
});
it("shares a slow local read across polling ticks and manual refreshes", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const pending = {
    ...ticket,
    uploadJob: { status: "RUNNING" },
  } as LocalWasteReceiptSummary;
  runtime.list.mockResolvedValue([pending]);
  await act(async () => {
    renderer = create(tree("pending"));
  });
  let release!: (rows: LocalWasteReceiptSummary[]) => void;
  runtime.list.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const before = runtime.list.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
    latest.onRefresh();
  });
  expect(runtime.list.mock.calls.length - before).toBe(1);
  await act(async () => release([ticket]));
  expect(latest.receipts).toEqual([ticket]);
  expect(latest.refreshing).toBe(false);
});
it("ignores a blurred read and reloads the current scope on focus and successful sync", async () => {
  let release!: (rows: LocalWasteReceiptSummary[]) => void;
  runtime.list.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await act(async () => {
    renderer = create(tree());
  });
  await act(async () => renderer!.update(tree("syncing", false)));
  await act(async () => release([ticket]));
  expect(latest.receipts).toEqual([]);
  await act(async () => renderer!.update(tree()));
  expect(latest.receipts).toEqual([ticket]);
  const next = { ...ticket, receipt: { ...ticket.receipt, id: "next" } };
  runtime.list.mockResolvedValue([next]);
  await act(async () =>
    renderer!.update(tree("synced", true, "2026-10-22T20:00:00Z")),
  );
  expect(latest.receipts).toEqual([next]);
});
it("never shares a pending read or its result across account/store changes", async () => {
  let release!: (rows: LocalWasteReceiptSummary[]) => void;
  runtime.list.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await act(async () => {
    renderer = create(tree());
  });
  const other = {
    ...ticket,
    receipt: { ...ticket.receipt, id: "other-ticket" },
  };
  runtime.list.mockResolvedValue([other]);
  runtime.owner = "other-owner";
  runtime.store = "other-store";
  await act(async () => renderer!.update(tree()));
  expect(runtime.list).toHaveBeenLastCalledWith("other-store");
  expect(latest.receipts).toEqual([other]);
  await act(async () => release([ticket]));
  expect(latest.receipts).toEqual([other]);
});
