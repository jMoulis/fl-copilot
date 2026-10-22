import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { createElement, createContext, useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
// Exercise the exact pure router shipped by the pinned Expo SDK, not an imitation.
import { StackRouter } from "expo-router/build/react-navigation/routers/StackRouter";
import type { Href } from "expo-router";
import {
  buildProductDailyPerformance,
  buildDepartmentDailyPerformance,
} from "@fl-copilot/analytics-core";
import type { Product } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import { serializeLocalWrites } from "../db/serialized-writes";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { ProductEditorState } from "./product-editor-hooks.types";
import { productSnapshotToDraft } from "./product-editor-service";
import { returnToProduct, returnToProducts } from "./product-navigation";
import { useProductEditor, useProductList } from "./use-product-editor";
import { useVisualLibrary } from "./use-visual-library";
import { ProductPerformance } from "./product-performance";
import type { SQLiteDatabase } from "expo-sqlite";

const runtime = vi.hoisted(() => ({
  database: undefined as unknown,
  session: undefined as unknown,
  listeners: 0,
}));
const Focus = createContext(false);
const Sync = createContext({
  pendingCount: 0,
  conflictCount: 0,
  lastSyncedAt: undefined as string | undefined,
  visuals: undefined,
  syncNow: async () => undefined,
});
vi.mock("expo-router", () => ({
  useIsFocused: () => useContext(Focus),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const focused = useContext(Focus);
    useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
  router: { navigate: vi.fn() },
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("react-native", () => ({ Text: "Text" }));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("../sync/sync-provider", () => ({ useSync: () => useContext(Sync) }));
vi.mock("../components/ui", () => ({
  InlineAlert: () => null,
  SecondaryButton: () => null,
}));
vi.mock("./product-performance-view", () => ({
  ProductPerformanceView: () => null,
}));
vi.mock("./visual-file-storage", () => ({ nativeVisualFileStorage: {} }));
vi.mock("../sync/outbox-repository", async (original) => {
  const actual = await original<typeof import("../sync/outbox-repository")>();
  return {
    ...actual,
    subscribeOutboxChanges: (listener: () => void) => {
      runtime.listeners++;
      const unsubscribe = actual.subscribeOutboxChanges(listener);
      return () => {
        runtime.listeners--;
        unsubscribe();
      };
    },
  };
});

type Value = string | number | null;
type Counters = {
  statements: number;
  rows: number;
  writers: number;
  activeWriters: number;
  tables: Record<string, number>;
};
class MeasuredDatabase {
  constructor(
    readonly raw: DatabaseSync,
    readonly path: string,
    readonly counters: Counters,
  ) {}
  private record(sql: string, rows = 0) {
    this.counters.statements++;
    this.counters.rows += rows;
    const table = /\b(?:FROM|INTO|UPDATE)\s+(\w+)/i.exec(sql)?.[1] ?? "other";
    this.counters.tables[table] = (this.counters.tables[table] ?? 0) + 1;
  }
  async execAsync(sql: string) {
    this.record(sql);
    this.raw.exec(sql);
  }
  async getFirstAsync<T>(sql: string, ...args: Value[]) {
    const row = this.raw.prepare(sql).get(...args) as T | undefined;
    this.record(sql, row ? 1 : 0);
    return row ?? null;
  }
  async getAllAsync<T>(sql: string, ...args: Value[]) {
    const rows = this.raw.prepare(sql).all(...args) as T[];
    this.record(sql, rows.length);
    return rows;
  }
  async runAsync(sql: string, ...args: Value[]) {
    this.record(sql);
    return this.raw.prepare(sql).run(...args);
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    const tx = new DatabaseSync(this.path);
    this.counters.writers++;
    this.counters.activeWriters++;
    try {
      tx.exec("BEGIN IMMEDIATE");
      await task(new MeasuredDatabase(tx, this.path, this.counters));
      tx.exec("COMMIT");
    } catch (error) {
      if (tx.isTransaction) tx.exec("ROLLBACK");
      throw error;
    } finally {
      tx.close();
      this.counters.activeWriters--;
    }
  }
}

const routeOptions = {
  routeNames: ["index", "[id]", "edit/[id]"],
  routeParamList: {},
  routeGetIdList: {},
};
function navigation() {
  const router = StackRouter({ initialRouteName: "index" });
  let state = router.getInitialState(routeOptions);
  const dispatch = (
    type: "PUSH" | "REPLACE" | "NAVIGATE" | "POP_TO",
    name: string,
    id?: string,
  ) => {
    state = router.getStateForAction(
      state,
      { type, payload: { name, params: id ? { id } : undefined } },
      routeOptions,
    ) as typeof state;
    return state;
  };
  const destination = (href: Href) => {
    const path = typeof href === "string" ? href : href.pathname;
    if (path === "/(tabs)/products") return { name: "index" };
    const id =
      typeof href === "string"
        ? path.split("/").at(-1)
        : (href.params as { id: string }).id;
    return { name: "[id]", id };
  };
  const to = (type: "REPLACE" | "NAVIGATE" | "POP_TO", href: Href) => {
    const target = destination(href);
    dispatch(type, target.name, target.id);
  };
  return {
    get state() {
      return state;
    },
    dispatch,
    port: {
      navigate: (href: Href) => to("NAVIGATE", href),
      replace: (href: Href) => to("REPLACE", href),
      dismissTo: (href: Href) => to("POP_TO", href),
    },
  };
}

it("keeps the installed Expo product stack bounded through 500 edits and returns, preserving the original list key", () => {
  const nav = navigation(),
    listKey = nav.state.routes[0]!.key;
  for (let i = 0; i < 500; i++) {
    nav.dispatch("PUSH", "[id]", `p${i}`);
    const detailKey = nav.state.routes.at(-1)!.key;
    nav.dispatch("PUSH", "edit/[id]", `p${i}`);
    returnToProduct(nav.port, `p${i}`);
    expect(nav.state.routes).toHaveLength(2);
    expect(nav.state.routes.at(-1)!.key).toBe(detailKey);
    returnToProducts(nav.port);
    expect(nav.state.routes).toHaveLength(1);
    expect(nav.state.routes[0]!.key).toBe(listKey);
  }
});
it("replaces an isolated deep link when its destination is absent instead of requiring an existing caller", () => {
  const nav = navigation();
  nav.dispatch("PUSH", "edit/[id]", "a");
  returnToProduct(nav.port, "a");
  expect(nav.state.routes.at(-1)).toMatchObject({
    name: "[id]",
    params: { id: "a" },
  });
  returnToProducts(nav.port);
  expect(nav.state.routes).toHaveLength(1);
});

it("pops a root-level product form back to the existing tabs container rather than duplicating it", () => {
  const options = {
    routeNames: ["(tabs)", "store-event", "product-substitution"],
    routeParamList: {},
    routeGetIdList: {},
  };
  const router = StackRouter({ initialRouteName: "(tabs)" });
  let state = router.getInitialState(options);
  const key = state.routes[0]!.key;
  const port = {
    dismissTo: (href: Href) => {
      expect(String(href)).toBe("/(tabs)/products/a");
      state = router.getStateForAction(
        state,
        {
          type: "POP_TO",
          payload: {
            name: "(tabs)",
            params: {
              screen: "products",
              params: { screen: "[id]", params: { id: "a" } },
            },
          },
        },
        options,
      ) as typeof state;
    },
  };
  for (let i = 0; i < 500; i++) {
    state = router.getStateForAction(
      state,
      {
        type: "PUSH",
        payload: { name: i % 2 ? "store-event" : "product-substitution" },
      },
      options,
    ) as typeof state;
    returnToProduct(port, "a");
    expect(state.routes).toHaveLength(1);
    expect(state.routes[0]!.key).toBe(key);
    expect(state.routes[0]!.params).toMatchObject({
      screen: "products",
      params: { screen: "[id]", params: { id: "a" } },
    });
  }
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "fl-navigation-stress-")),
    path = join(directory, "local.db");
  const raw = new DatabaseSync(path),
    storeId = randomUUID(),
    ownerId = randomUUID(),
    deviceId = randomUUID();
  const counters: Counters = {
    statements: 0,
    rows: 0,
    writers: 0,
    activeWriters: 0,
    tables: {},
  };
  const measured = new MeasuredDatabase(raw, path, counters);
  await runLocalMigrations(measured);
  const ids = Array.from({ length: 500 }, () => randomUUID()),
    at = "2026-10-22T12:00:00.000Z";
  const first: Product = {
    id: ids[0]!,
    storeId,
    label: "Produit 0000",
    category: "FRUIT",
    nature: "BULK",
    salesUnit: "KG",
    packaging: null,
    familyId: null,
    subfamilyId: null,
    status: "ACTIVE",
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  const product = raw.prepare(
    "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at,sync_state,remote_version,dirty) VALUES(?,?,?,'FRUIT','BULK','KG','ACTIVE',1,?,?,'SYNCED',1,0)",
  );
  const code = raw.prepare(
    "INSERT INTO product_identifiers(id,store_id,product_id,type,value,source,status,version,created_at,updated_at,sync_state,remote_version,dirty) VALUES(?,?,?,'ITM8',?,'MERCALYS','VALIDATED',1,?,?,'SYNCED',1,0)",
  );
  const alias = raw.prepare(
    "INSERT INTO product_aliases(id,store_id,product_id,alias,normalized_alias,source,status,version,created_at,updated_at,sync_state,remote_version,dirty) VALUES(?,?,?,?,?,'USER','VALIDATED',1,?,?,'SYNCED',1,0)",
  );
  const daily = raw.prepare(
    "INSERT INTO product_daily_performance(id,store_id,product_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES(?,?,?,?,?,'LOCAL','product-daily-v1','stress',?)",
  );
  const department = raw.prepare(
    "INSERT INTO department_daily_performance(id,store_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES(?,?,?,?,'LOCAL','department-daily-v1','stress',?)",
  );
  raw.exec("BEGIN");
  for (const [i, id] of ids.entries()) {
    product.run(id, storeId, `Produit ${String(i).padStart(4, "0")}`, at, at);
    code.run(randomUUID(), storeId, id, String(i).padStart(8, "0"), at, at);
    for (let a = 0; a < 2; a++)
      alias.run(
        randomUUID(),
        storeId,
        id,
        `Alias ${i} ${a}`,
        `ALIAS ${i} ${a}`,
        at,
        at,
      );
    for (let d = 8; d <= 21; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      const value = buildProductDailyPerformance({
        product: { ...first, id },
        businessDate: date,
        salesObservations: [],
        wasteObservations: [],
        computedAt: at,
      });
      daily.run(`${id}:${date}`, storeId, id, date, JSON.stringify(value), at);
    }
  }
  for (let d = 8; d <= 21; d++) {
    const date = `2026-10-${String(d).padStart(2, "0")}`;
    department.run(
      `${storeId}:${date}`,
      storeId,
      date,
      JSON.stringify(
        buildDepartmentDailyPerformance({
          storeId,
          businessDate: date,
          productPerformances: [],
          computedAt: at,
        }),
      ),
      at,
    );
  }
  raw.exec("COMMIT");
  counters.statements = counters.rows = counters.writers = 0;
  counters.tables = {};
  return {
    raw,
    counters,
    ids,
    storeId,
    ownerId,
    deviceId,
    directory,
    db: serializeLocalWrites(measured as unknown as SQLiteDatabase),
  };
}

const probes = new Map<string, ProductEditorState>();
let latestList: ReturnType<typeof useProductList> | undefined;
let latestLibrary: ReturnType<typeof useVisualLibrary> | undefined;
function ListProbe() {
  latestList = useProductList();
  latestLibrary = useVisualLibrary();
  return null;
}
function DetailProbe({ id, routeKey }: { id: string; routeKey: string }) {
  const state = useProductEditor(id);
  useVisualLibrary();
  probes.set(routeKey, state);
  useEffect(
    () => () => {
      probes.delete(routeKey);
    },
    [routeKey],
  );
  const session = runtime.session as {
    stores: { storeId: string }[];
    user: { id: string };
  };
  return createElement(ProductPerformance, {
    productId: id,
    storeId: session.stores[0]!.storeId,
    ownerId: session.user.id,
  });
}
function EditProbe({ id, routeKey }: { id: string; routeKey: string }) {
  probes.set(routeKey, useProductEditor(id));
  useEffect(
    () => () => {
      probes.delete(routeKey);
    },
    [routeKey],
  );
  return null;
}

afterEach(() => {
  vi.useRealTimers();
  probes.clear();
  latestList = undefined;
  latestLibrary = undefined;
});
it("stress-tests real mounted product hooks with 500 offline edits and retained navigation contexts without growing observers or subscriptions", async () => {
  const f = await fixture(),
    nav = navigation(),
    baseline = process.env.FL_PERF_BASELINE === "1";
  const cycles = Math.min(
    500,
    Math.max(1, Number(process.env.FL_PERF_CYCLES ?? 500)),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  runtime.database = { sqlite: f.db, deviceId: f.deviceId };
  runtime.session = {
    user: { id: f.ownerId },
    stores: [{ storeId: f.storeId, role: "MANAGER" }],
  };
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const errors: string[] = [],
    originalError = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    errors.push(String(args[0]));
    originalError(...args);
  });
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  let renderer: ReactTestRenderer | undefined,
    pendingCount = 0;
  const phases: Record<
    string,
    { calls: number; statements: number; rows: number; milliseconds: number[] }
  > = {};
  const samples: {
    cycle: number;
    routes: number;
    observers: number;
    listeners: number;
    statements: number;
    rows: number;
    heapMB: number;
  }[] = [];
  const tree = () =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        Sync.Provider,
        {
          value: {
            pendingCount,
            conflictCount: 0,
            lastSyncedAt: undefined,
            visuals: undefined,
            syncNow: async () => undefined,
          },
        },
        nav.state.routes.map((route, i) =>
          createElement(
            Focus.Provider,
            { key: route.key, value: i === nav.state.index },
            route.name === "index"
              ? createElement(ListProbe)
              : createElement(route.name === "[id]" ? DetailProbe : EditProbe, {
                  id: (route.params as { id: string }).id,
                  routeKey: route.key,
                }),
          ),
        ),
      ),
    );
  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    for (let attempt = 0; client.isFetching() && attempt < 10; attempt++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    expect(client.isFetching()).toBe(0);
  };
  const phase = async (name: string, work: () => void | Promise<void>) => {
    const before = { statements: f.counters.statements, rows: f.counters.rows },
      start = performance.now();
    await act(async () => {
      await work();
      if (renderer) renderer.update(tree());
    });
    await settle();
    const p = (phases[name] ??= {
      calls: 0,
      statements: 0,
      rows: 0,
      milliseconds: [],
    });
    p.calls++;
    p.statements += f.counters.statements - before.statements;
    p.rows += f.counters.rows - before.rows;
    p.milliseconds.push(performance.now() - start);
  };
  try {
    await act(async () => {
      renderer = create(tree());
    });
    await settle();
    for (let i = 0; i < cycles; i++) {
      const id = f.ids[i % f.ids.length]!;
      await phase("open_detail", () => {
        nav.dispatch("PUSH", "[id]", id);
      });
      const detailKey = nav.state.routes.at(-1)!.key;
      await phase("open_editor", () => {
        nav.dispatch("PUSH", "edit/[id]", id);
      });
      const visualReadsBeforeSave = f.counters.tables.visual_assets ?? 0;
      if (!baseline) expect(runtime.listeners).toBe(0);
      await phase("save", async () => {
        const editor = probes.get(nav.state.routes.at(-1)!.key)!;
        expect(editor.snapshot).toBeTruthy();
        await editor.save(
          {
            ...productSnapshotToDraft(editor.snapshot!),
            label: `Produit modifié ${i}`,
          },
          editor.snapshot,
        );
        pendingCount++;
      });
      if (!baseline)
        expect(f.counters.tables.visual_assets ?? 0).toBe(
          visualReadsBeforeSave,
        );
      await phase("return_detail", () => {
        returnToProduct(nav.port, id);
      });
      if (!baseline)
        expect(probes.get(detailKey)?.snapshot?.product.entity.label).toBe(
          `Produit modifié ${i}`,
        );
      await phase("return_list", () => {
        returnToProducts(nav.port);
      });
      if (!baseline) {
        expect(nav.state.routes).toHaveLength(1);
        expect(runtime.listeners).toBe(1);
        expect(
          client
            .getQueryCache()
            .getAll()
            .reduce((n, q) => n + q.getObserversCount(), 0),
        ).toBe(1);
        expect(probes.size).toBe(0);
        expect(
          latestList?.products.find((p) => p.record.entity.id === id)?.record
            .entity.label,
        ).toBe(`Produit modifié ${i}`);
        expect(latestLibrary?.state?.products.get(id)?.entity.label).toBe(
          `Produit modifié ${i}`,
        );
      }
      if ((i + 1) % 25 === 0 || i === cycles - 1)
        samples.push({
          cycle: i + 1,
          routes: nav.state.routes.length,
          listeners: runtime.listeners,
          observers: client
            .getQueryCache()
            .getAll()
            .reduce((n, q) => n + q.getObserversCount(), 0),
          statements: f.counters.statements,
          rows: f.counters.rows,
          heapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        });
    }
    expect(
      f.raw
        .prepare("SELECT COUNT(*) n FROM sync_outbox WHERE status='PENDING'")
        .get(),
    ).toEqual({ n: cycles });
    expect(f.raw.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({
      n: 500,
    });
    expect(
      f.raw
        .prepare("SELECT COUNT(*) n FROM product_identifiers WHERE version=1")
        .get(),
    ).toEqual({ n: 500 });
    expect(
      f.raw
        .prepare("SELECT COUNT(*) n FROM product_aliases WHERE version=1")
        .get(),
    ).toEqual({ n: 1000 });
    expect(
      f.raw.prepare("SELECT COUNT(*) n FROM product_daily_performance").get(),
    ).toEqual({ n: 7000 });
    expect(f.counters.activeWriters).toBe(0);
    expect(errors).toEqual([]);
    const report = {
      mode: baseline ? "before-navigation-fix" : "corrected",
      cycles,
      fixture: {
        products: 500,
        identifiers: 500,
        aliases: 1000,
        productDays: 7000,
      },
      phases,
      samples,
      totals: f.counters,
      measurement:
        "Node SQLite + React mounted production hooks + installed Expo StackRouter; no native animations/bridge/FPS measured",
    };
    if (process.env.FL_PERF_REPORT_PATH)
      writeFileSync(
        process.env.FL_PERF_REPORT_PATH,
        JSON.stringify(report, null, 2),
      );
    console.log(
      "product-navigation-stress",
      JSON.stringify({
        cycles,
        routes: nav.state.routes.length,
        listeners: runtime.listeners,
        statements: f.counters.statements,
      }),
    );
  } finally {
    if (renderer)
      await act(async () => {
        renderer!.unmount();
      });
    await act(async () => {
      client.clear();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(runtime.listeners).toBe(0);
    expect(f.counters.activeWriters).toBe(0);
    vi.useRealTimers();
    f.raw.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
}, 120_000);
