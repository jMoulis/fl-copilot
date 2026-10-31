import { DatabaseSync } from "node:sqlite";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ActionsViewRepository, initialActionsView } from "./actions-view";
import { CopilotActivityPanel } from "./copilot-activity-panel";
import ActionsScreen from "../app/(tabs)/actions";

const runtime = vi.hoisted(() => ({
  scope: {
    storeId: "11111111-1111-4111-8111-111111111111",
    ownerId: "22222222-2222-4222-8222-222222222222",
  },
  sqlite: {} as OutboxDatabase,
  focused: true,
  sync: {
    status: "synced",
    pendingCount: 0,
    pendingCommandCount: 0,
    conflictCount: 0,
    failedCount: 0,
    lastSyncedAt: "2026-10-23T10:00:00Z",
  },
  readPlan: vi.fn(),
  push: vi.fn(),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
}));
vi.mock("expo-router", () => ({ router: { push: runtime.push } }));
vi.mock("expo-router/react-navigation", () => ({
  useIsFocused: () => runtime.focused,
}));
vi.mock("expo-crypto", () => ({
  digestStringAsync: vi.fn(),
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      stores: [{ storeId: runtime.scope.storeId }],
      user: { id: runtime.scope.ownerId },
    },
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite }),
}));
vi.mock("../sync/sync-provider", () => ({ useSync: () => runtime.sync }));
vi.mock("./week-plan-repository", () => ({
  CommercialPlanRepository: class {
    get = runtime.readPlan;
  },
}));
vi.mock("./execution-view", () => ({
  CommercialExecutionView: "ExecutionView",
}));
vi.mock("../components/date-selector", () => ({
  DateSelector: "DateSelector",
}));
vi.mock("../components/dashboard", () => ({
  DetailsDisclosure: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../components/ui", () => ({
  AppScreen: ({ children }: { children: ReactNode }) => children,
  AppHeader: "Header",
  SecondaryButton: "SecondaryButton",
  InlineAlert: "Alert",
  EmptyState: "EmptyState",
  MenuRow: "MenuRow",
  SectionCard: ({ children }: { children: ReactNode }) => children,
}));

let db: DatabaseSync, rendered: ReactTestRenderer | undefined;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  runtime.scope = {
    storeId: "11111111-1111-4111-8111-111111111111",
    ownerId: "22222222-2222-4222-8222-222222222222",
  };
  runtime.focused = true;
  runtime.sync = {
    status: "synced",
    pendingCount: 0,
    pendingCommandCount: 0,
    conflictCount: 0,
    failedCount: 0,
    lastSyncedAt: "2026-10-23T10:00:00Z",
  };
  db = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, ...p: (string | number | null)[]) =>
      db.prepare(sql).run(...p),
    getFirstAsync: async <T>(sql: string, ...p: (string | number | null)[]) =>
      (db.prepare(sql).get(...p) as T) ?? null,
    getAllAsync: async <T>(sql: string, ...p: (string | number | null)[]) =>
      db.prepare(sql).all(...p) as T[],
  };
  await runLocalMigrations(adapter);
  runtime.sqlite = adapter;
  const fixture = await commercialPlanFixture();
  runtime.readPlan
    .mockReset()
    .mockImplementation(async (_store, weekStart) => ({
      entity: { ...fixture.plan, weekStart },
    }));
  runtime.push.mockReset();
});
afterEach(async () => {
  await act(() => rendered?.unmount());
  rendered = undefined;
  db.close();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    const node = createElement(ActionsScreen);
    if (rendered) rendered.update(node);
    else rendered = create(node);
  });
}
const execution = () => rendered!.root.findByType("ExecutionView" as never);
const date = () => rendered!.root.findByType("DateSelector" as never);
const alerts = () => rendered!.root.findAllByType("Alert" as never);

it("restores the week and filter and preserves that context in both preparation links and a remount", async () => {
  const view = { ...initialActionsView("2025-12-31"), filter: "ALL" as const };
  await new ActionsViewRepository(runtime.sqlite, runtime.scope).save(view);
  await render();
  expect(date().props.value).toBe("2025-12-29");
  expect(execution().props.filter).toBe("ALL");
  for (const title of ["Préparation", "Plan et historique"]) {
    const link = rendered!.root
      .findAllByType("MenuRow" as never)
      .find((n) => n.props.title === title)!;
    await act(() => link.props.onPress());
    expect(runtime.push.mock.lastCall?.[0].params.weekStart).toBe("2025-12-29");
  }
  await act(() => execution().props.onFilter("DONE"));
  await act(() =>
    rendered!.root.findByType(CopilotActivityPanel).props.onFilter("EXECUTION"),
  );
  await act(() => date().props.onConfirm("2026-01-08"));
  await act(() => rendered!.unmount());
  rendered = undefined;
  await render();
  expect(date().props.value).toBe("2026-01-05");
  expect(execution().props.filter).toBe("DONE");
  expect(rendered!.root.findByType(CopilotActivityPanel).props.filter).toBe(
    "EXECUTION",
  );
  expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()?.n).toBe(0);
});

it("reads local actions on an initial syncing visit, coalesces 100 sync counters, refreshes a pull and stops while hidden", async () => {
  runtime.sync.status = "syncing";
  runtime.sync.pendingCount = 100;
  await render();
  expect(runtime.readPlan).toHaveBeenCalledTimes(1);
  expect(execution()).toBeDefined();
  for (let i = 99; i >= 0; i--) {
    runtime.sync = { ...runtime.sync, pendingCount: i };
    await render();
  }
  expect(runtime.readPlan).toHaveBeenCalledTimes(1);
  runtime.sync = { ...runtime.sync, status: "synced" };
  await render();
  expect(runtime.readPlan).toHaveBeenCalledTimes(2);
  runtime.sync = { ...runtime.sync, lastSyncedAt: "2026-10-23T10:05:00Z" };
  await render();
  expect(runtime.readPlan).toHaveBeenCalledTimes(3);
  runtime.focused = false;
  for (let i = 0; i < 10; i++) {
    runtime.sync = { ...runtime.sync, pendingCount: i };
    await render();
  }
  expect(runtime.readPlan).toHaveBeenCalledTimes(3);
  runtime.focused = true;
  await render();
  expect(runtime.readPlan).toHaveBeenCalledTimes(4);
});

it("keeps displayed actions on a failed pull and offers a local retry", async () => {
  await render();
  const previous = execution().props.plan;
  runtime.readPlan.mockRejectedValueOnce(new Error("SQLITE_BUSY"));
  runtime.sync = { ...runtime.sync, lastSyncedAt: "2026-10-23T10:10:00Z" };
  await render();
  expect(execution().props.plan).toBe(previous);
  expect(alerts()[0].props.title).toBe("Lecture interrompue");
  const retry = rendered!.root
    .findAllByType("SecondaryButton" as never)
    .find((n) => n.props.label === "Réessayer la lecture")!;
  await act(() => retry.props.onPress());
  expect(alerts()).toHaveLength(0);
});

it("falls back visibly from corrupt metadata and retains an immediate selection after its cache write fails", async () => {
  await new ActionsViewRepository(runtime.sqlite, runtime.scope).save(
    initialActionsView(),
  );
  db.prepare(
    "UPDATE app_metadata SET value='{}' WHERE key LIKE 'actions-view:%'",
  ).run();
  await render();
  expect(date().props.value).toBe(initialActionsView().weekStart);
  expect(alerts()[0].props.message).toContain("ne peut pas être relue");
  const write = vi
    .spyOn(runtime.sqlite, "runAsync")
    .mockRejectedValueOnce(new Error("DISK_FULL"));
  await act(() => date().props.onConfirm("2025-12-31"));
  expect(date().props.value).toBe("2025-12-29");
  expect(alerts()[0].props.message).toContain("n’a pas pu être mémorisée");
  await act(() => execution().props.onFilter("DONE"));
  expect(alerts()).toHaveLength(0);
  expect(write).toHaveBeenCalledTimes(2);
});

it("isolates owner and store selections and ignores a late local plan from a previous scope", async () => {
  await new ActionsViewRepository(runtime.sqlite, runtime.scope).save({
    ...initialActionsView("2025-12-31"),
    filter: "DONE",
  });
  let resolve!: (record: unknown) => void;
  runtime.readPlan.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  expect(date().props.value).toBe("2025-12-29");
  runtime.scope = { ...runtime.scope, ownerId: runtime.scope.storeId };
  await render();
  expect(date().props.value).toBe(initialActionsView().weekStart);
  expect(execution().props.filter).toBe("TODO");
  const current = execution().props.plan;
  await act(() => resolve({ entity: { ...current, id: "previous-owner" } }));
  expect(execution().props.plan).toBe(current);
  runtime.scope = {
    ...runtime.scope,
    storeId: "33333333-3333-4333-8333-333333333333",
  };
  await render();
  expect(runtime.readPlan.mock.lastCall?.[0]).toBe(runtime.scope.storeId);
  expect(execution().props.filter).toBe("TODO");
});

it("ignores local-calculation counters but rereads the retained week when returning during blocked synchronization", async () => {
  await render();
  for (let i = 200; i > 0; i--) {
    runtime.sync = { ...runtime.sync, pendingCount: i };
    await render();
  }
  expect(runtime.readPlan).toHaveBeenCalledTimes(1);
  runtime.sync = { ...runtime.sync, status: "syncing" };
  await render();
  runtime.focused = false;
  await render();
  runtime.focused = true;
  await render();
  expect(runtime.readPlan).toHaveBeenCalledTimes(2);
});

it("makes preparation visible before activity and selects next ISO week from today, not a retained historical week", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-12-27T18:00:00Z"));
    await new ActionsViewRepository(runtime.sqlite, runtime.scope).save(
      initialActionsView("2025-10-01"),
    );
    await render();
    const nodes = rendered!.root.findAll(
      (n) => n.type === CopilotActivityPanel || n.props.title === "Préparation",
    );
    expect(nodes[0]!.props.title).toBe("Préparation");
    const next = rendered!.root
      .findAllByType("SecondaryButton" as never)
      .find((n) => n.props.label === "Préparer la semaine prochaine")!;
    await act(() => next.props.onPress());
    expect(date().props.value).toBe("2026-12-28");
    expect(runtime.push.mock.lastCall?.[0]).toEqual({
      pathname: "/week-preparation",
      params: { weekStart: "2026-12-28" },
    });
    const preparation = rendered!.root
      .findAllByType("MenuRow" as never)
      .find((n) => n.props.title === "Préparation")!;
    await act(() => preparation.props.onPress());
    expect(runtime.push.mock.lastCall?.[0]).toEqual({
      pathname: "/week-preparation",
      params: { weekStart: "2026-12-28" },
    });
    expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()?.n).toBe(0);
    await act(() => rendered!.unmount());
    rendered = undefined;
    await render();
    expect(date().props.value).toBe("2026-12-28");
    vi.setSystemTime(new Date("2026-12-28T18:00:00Z"));
    await act(() =>
      rendered!.root
        .findAllByType("SecondaryButton" as never)
        .find((n) => n.props.label === "Préparer la semaine prochaine")!
        .props.onPress(),
    );
    expect(date().props.value).toBe("2027-01-04");
  } finally {
    vi.useRealTimers();
  }
});
