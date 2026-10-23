import { createContext, createElement, useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Product } from "@fl-copilot/domain";
import {
  ProductMasterRepository,
  type LocalProductMasterRecord,
} from "./product-master-repository";
import { useProductList } from "./use-product-editor";
const runtime = vi.hoisted(() => ({
  sqlite: { getAllAsync: vi.fn(async () => []) },
}));
const Focus = createContext(true);
const initial = () => ({
  status: "offline",
  pendingCount: 0,
  pendingCommandCount: undefined as number | undefined,
  conflictCount: 0,
  failedCount: 0,
  lastSyncedAt: undefined as string | undefined,
});
const Sync = createContext(initial());
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const focused = useContext(Focus);
    useEffect(() => (focused ? callback() : undefined), [focused, callback]);
  },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: { stores: [{ storeId: "store-a" }] } }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite }),
}));
vi.mock("../sync/sync-provider", () => ({ useSync: () => useContext(Sync) }));
let state = initial(),
  value: ReturnType<typeof useProductList>,
  rendered: ReactTestRenderer | undefined;
function Probe() {
  value = useProductList();
  return null;
}
function product(label: string): LocalProductMasterRecord<Product> {
  return {
    entity: {
      id: "11111111-1111-4111-8111-111111111111",
      storeId: "store-a",
      label,
      category: "VEGETABLE",
      nature: "BULK",
      salesUnit: "PIECE",
      packaging: null,
      familyId: null,
      subfamilyId: null,
      status: "ACTIVE",
      version: 1,
      createdAt: "2026-10-23T08:00:00.000Z",
      updatedAt: "2026-10-23T08:00:00.000Z",
      deletedAt: null,
    },
    syncState: "SYNCED",
    remoteVersion: 1,
    dirty: false,
  };
}
async function render(focused = true) {
  await act(async () => {
    const tree = createElement(
      Sync.Provider,
      { value: { ...state } },
      createElement(Focus.Provider, { value: focused }, createElement(Probe)),
    );
    if (rendered) rendered.update(tree);
    else rendered = create(tree);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  state = initial();
  vi.spyOn(
    ProductMasterRepository.prototype,
    "listIdentifiersByStore",
  ).mockResolvedValue([]);
  vi.spyOn(
    ProductMasterRepository.prototype,
    "listAliasesByStore",
  ).mockResolvedValue([]);
});
afterEach(async () => {
  if (rendered) await act(async () => rendered!.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});
it("allows the first slow SQLite read to finish during 300 counter renders instead of discarding/restarting it", async () => {
  let complete!: (rows: LocalProductMasterRecord<Product>[]) => void;
  const read = vi
    .spyOn(ProductMasterRepository.prototype, "listProducts")
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
  state.status = "syncing";
  state.pendingCount = 300;
  await render();
  expect(value.loading).toBe(true);
  for (let n = 299; n >= 0; n--) {
    state.pendingCount = n;
    await render();
  }
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => complete([product("PERSIL BOTTE")]));
  expect(value.loading).toBe(false);
  expect(value.products[0]?.record.entity.label).toBe("PERSIL BOTTE");
});
it("ignores a former focus's late read after returning and loading a newer local snapshot", async () => {
  let complete!: (rows: LocalProductMasterRecord<Product>[]) => void;
  const read = vi
    .spyOn(ProductMasterRepository.prototype, "listProducts")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue([product("VERSION ACTUELLE")]);
  state.status = "syncing";
  await render();
  await render(false);
  await render();
  expect(value.products[0]?.record.entity.label).toBe("VERSION ACTUELLE");
  await act(async () => complete([product("ANCIENNE VERSION")]));
  expect(value.products[0]?.record.entity.label).toBe("VERSION ACTUELLE");
  expect(read).toHaveBeenCalledTimes(2);
});
it("invalidates failed-command changes outside sync, preserves displayed offline data on read failure and supports deliberate local retry", async () => {
  const row = product("CONSERVÉ HORS CONNEXION");
  const read = vi
    .spyOn(ProductMasterRepository.prototype, "listProducts")
    .mockResolvedValueOnce([row])
    .mockRejectedValueOnce(Error("database is locked"))
    .mockResolvedValue([row]);
  await render();
  state.failedCount = 1;
  await render();
  expect(value.products[0]?.record).toBe(row);
  expect(value.error).toContain("Les données déjà affichées sont conservées");
  expect(value.loading).toBe(false);
  await act(async () => value.refresh());
  expect(value.error).toBeUndefined();
  expect(value.products[0]?.record).toBe(row);
  expect(read).toHaveBeenCalledTimes(3);
});

it("does not reload the offline catalogue for 300 local-job counter changes, but still invalidates an actual pending command", async () => {
  const read = vi
    .spyOn(ProductMasterRepository.prototype, "listProducts")
    .mockResolvedValue([product("LOCAL")]);
  state.pendingCommandCount = 1;
  state.pendingCount = 301;
  await render();
  for (let jobs = 299; jobs >= 0; jobs--) {
    state.pendingCount = jobs + 1;
    await render();
  }
  expect(read).toHaveBeenCalledTimes(1);
  state.pendingCommandCount = 2;
  state.pendingCount = 2;
  await render();
  expect(read).toHaveBeenCalledTimes(2);
  expect(value.products[0]?.record.entity.label).toBe("LOCAL");
});
