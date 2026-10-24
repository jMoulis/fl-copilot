import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import StoreLayoutScreen from "../app/store-layout";
import { nativeLayoutConflictFixture } from "../../../../scripts/test-layout-conflict-fixtures";
import { nextLayout } from "../../../../scripts/test-store-layout-fixtures";
import { applyStoreLayout } from "./layout-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  focused: true,
  sync: vi.fn(),
  back: vi.fn(),
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({
    syncNow: runtime.sync,
    status: "IDLE",
    lastSyncedAt: null,
  }),
}));
vi.mock("../components/ui", () => ({
  AppScreen: "Screen",
  InlineAlert: "Alert",
}));
// Geometry, map and forms have their own tests; this suite mounts the real
// screen owner and exercises its repository, refresh and native lifetime ports.
vi.mock("./layout-panel", () => ({ StoreLayoutPanel: "PlanPanel" }));
vi.mock("expo-router", () => ({
  router: { back: runtime.back },
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focus = runtime.focused;
    useEffect(() => (focus ? cb() : undefined), [cb, focus]);
  },
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
let tree: ReactTestRenderer | undefined;
const fixtures: Array<Awaited<ReturnType<typeof nativeLayoutConflictFixture>>> =
  [];
const panel = () =>
  tree!.root.find(
    (n) => typeof n.type === "string" && String(n.type) === "PlanPanel",
  );
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(normal = false) {
  const s = await nativeLayoutConflictFixture();
  fixtures.push(s);
  if (normal) {
    const r = await s.repository.review(
      s.scope.storeId,
      s.review.conflict.id,
      s.scope.ownerId,
    );
    await s.repository.resolve(
      s.review.conflict.id,
      {
        storeId: s.scope.storeId,
        useLocal: false,
        localRevisionId: r.local.revisionId,
        remoteRevisionId: r.remote!.revisionId,
      },
      {
        ...s.context,
        commandId: crypto.randomUUID(),
        reviewHash: r.hash,
        canResolve: () => true,
      },
    );
    s.review.local = s.review.remote;
  }
  runtime.session = {
    user: { id: s.scope.ownerId },
    stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
  };
  runtime.database = { sqlite: s.a, deviceId: s.scope.deviceId };
  await act(async () => {
    tree = create(createElement(StoreLayoutScreen));
  });
  return s;
}
async function commitChoice(s: Awaited<ReturnType<typeof setup>>) {
  const r = await s.repository.review(
    s.scope.storeId,
    s.review.conflict.id,
    s.scope.ownerId,
  );
  await s.repository.resolve(
    s.review.conflict.id,
    {
      storeId: s.scope.storeId,
      useLocal: true,
      localRevisionId: r.local.revisionId,
      remoteRevisionId: r.remote!.revisionId,
    },
    {
      ...s.context,
      commandId: crypto.randomUUID(),
      reviewHash: r.hash,
      canResolve: () => true,
    },
  );
  await act(async () => panel().props.onConflictResolved());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.sync.mockReset().mockResolvedValue(undefined);
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  for (const s of fixtures.splice(0)) s.db.close();
});
it("retains immediate normal draft changes when network synchronization fails", async () => {
  const s = await setup(true);
  runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
  await act(async () =>
    panel().props.onAction({
      action: "SAVE_DRAFT",
      expectedRevisionId: s.review.local.revisionId,
      content: s.review.local.content,
    }),
  );
  expect(panel().props.snapshot.head.entity.version).toBe(3);
  expect(panel().props.snapshot.head.syncState).toBe("PENDING");
  expect(panel().props.notice).toContain("Brouillon enregistré");
  expect(panel().props.error).toBeUndefined();
});
it("refreshes after the comparison sheet closes and again after its synchronization", async () => {
  const s = await setup(),
    gate = deferred();
  runtime.sync.mockReturnValueOnce(gate.promise);
  await commitChoice(s);
  expect(panel().props.snapshot.head.entity.version).toBe(3);
  expect(panel().props.snapshot.conflicts).toHaveLength(0);
  const command = (
      await new OutboxRepository(s.a).listPending(s.scope.storeId)
    ).find((c) => c.entityType === "store_layout")!,
    remote = nextLayout(s.review.remote);
  await applyStoreLayout(s.a, s.scope.storeId, remote);
  await new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    entityType: command.entityType,
    entityId: command.entityId,
    status: "CONFLICT",
    remoteEntity: remote,
    remoteVersion: 3,
  });
  await s.a.runAsync("UPDATE store_layouts SET sync_state='CONFLICT'");
  await act(async () => {
    gate.resolve();
    await gate.promise;
  });
  expect(panel().props.snapshot.conflicts).toHaveLength(1);
  expect(panel().props.snapshot.head.entity.version).toBe(3);
});
it("keeps a committed choice successful when its subsequent parent read fails", async () => {
  const s = await setup();
  runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
  const original = s.a.getFirstAsync.bind(s.a);
  vi.spyOn(s.a, "getFirstAsync").mockImplementation(async (sql, ...p) => {
    if (
      sql.includes("FROM store_layouts") &&
      s.db
        .prepare("SELECT COUNT(*) n FROM sync_conflicts WHERE status='OPEN'")
        .get()!.n === 0
    )
      throw Error("READ_FAILED");
    return original(sql, ...p);
  });
  await commitChoice(s);
  expect(panel().props.notice).toContain("Choix enregistré");
  expect(panel().props.error).toContain("Le choix est enregistré");
  expect(
    s.db.prepare("SELECT sync_state FROM store_layouts").get()!.sync_state,
  ).toBe("PENDING");
});
it.each(["ROLE", "BLUR"] as const)(
  "cancels normal draft writes delayed across a native %s change",
  async (mode) => {
    const s = await setup(true),
      gate = deferred(),
      entered = deferred(),
      original = s.a.getFirstAsync.bind(s.a),
      before = s.db.prepare("SELECT * FROM store_layouts").all();
    vi.spyOn(s.a, "getFirstAsync").mockImplementationOnce(async (sql, ...p) => {
      const value = await original(sql, ...p);
      entered.resolve();
      await gate.promise;
      return value;
    });
    let writing!: Promise<void>;
    await act(async () => {
      writing = panel().props.onAction({
        action: "SAVE_DRAFT",
        expectedRevisionId: s.review.local.revisionId,
        content: s.review.local.content,
      });
      writing.catch(() => undefined);
      await entered.promise;
    });
    await act(async () => {
      if (mode === "ROLE")
        runtime.session = {
          user: { id: s.scope.ownerId },
          stores: [{ storeId: s.scope.storeId, role: "VIEWER" }],
        };
      else runtime.focused = false;
      tree!.update(createElement(StoreLayoutScreen));
    });
    await act(async () => {
      gate.resolve();
      await expect(writing).rejects.toThrow("AUTHORITY_CHANGED");
    });
    expect(s.db.prepare("SELECT * FROM store_layouts").all()).toEqual(before);
    expect(
      (await new OutboxRepository(s.a).listPending(s.scope.storeId)).filter(
        (c) => c.entityType === "store_layout",
      ),
    ).toEqual([]);
    expect(runtime.sync).not.toHaveBeenCalled();
  },
);
it("discards a delayed parent refresh after changing the operational database", async () => {
  const s = await setup(),
    gate = deferred(),
    entered = deferred(),
    original = s.a.getFirstAsync.bind(s.a);
  runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
  vi.spyOn(s.a, "getFirstAsync").mockImplementationOnce(async (sql, ...p) => {
    const value = await original(sql, ...p);
    entered.resolve();
    await gate.promise;
    return value;
  });
  await act(async () => {
    panel().props.onConflictResolved();
    await entered.promise;
  });
  const other = await nativeLayoutConflictFixture();
  fixtures.push(other);
  runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
  await act(async () => tree!.update(createElement(StoreLayoutScreen)));
  expect(panel().props.snapshot.head).toBeNull();
  await act(async () => {
    gate.resolve();
    await gate.promise;
  });
  expect(panel().props.snapshot.head).toBeNull();
  expect(panel().props.error).toBeUndefined();
});
