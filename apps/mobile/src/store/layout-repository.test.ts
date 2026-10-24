import { receiptReviewDigest } from "../../../../scripts/test-receipt-publication-sqlite";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, expect } from "vitest";
import {
  addStoreLayoutMobile,
  placeStoreLayoutObject,
  removeStoreLayoutMobile,
  duplicateStoreLayoutInventory,
  removeStoreLayoutInventory,
} from "@fl-copilot/commercial-core";
import {
  layoutFixture,
  nextLayout,
  completeLayoutGeometry,
} from "../../../../scripts/test-store-layout-fixtures";
import {
  StoreLayoutRepository,
  applyStoreLayout,
  applyStoreLayoutRevision,
} from "./layout-repository";
import { runLocalMigrations, localMigrations } from "../db/migrations";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { MobileSyncService } from "../sync/sync-service";
import { applyPullPage } from "../sync/apply-pull-page";
import { applyBootstrap } from "../sync/apply-bootstrap";
import type {
  BootstrapResponse,
  SyncPullResponse,
} from "@fl-copilot/sync-contracts";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("COMMIT_FAILED");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

const dirs: string[] = [],
  dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const d of dbs.splice(0))
    try {
      d.close();
    } catch {
      /* already closed for restart */
    }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "fl-layout-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  const p = layoutFixture(),
    ctx = {
      commandId: randomUUID(),
      deviceId: randomUUID(),
      actorId: p.updatedBy,
      canWrite: true as const,
    },
    repo = new StoreLayoutRepository(
      tx,
      randomUUID,
      () => p.updatedAt,
      receiptReviewDigest,
    );
  return { path, db, tx, p, ctx, repo };
}
const input = (x: Awaited<ReturnType<typeof setup>>) => ({
  storeId: x.p.storeId,
  expectedRevisionId: null,
  action: "SAVE_DRAFT" as const,
  content: x.p.content,
});
it("upgrades v48 without seeding a store and retains pending work", async () => {
  const x = await setup();
  expect(await x.repo.get(x.p.storeId)).toBeNull();
  const old = new DatabaseSync(":memory:"),
    tx = new Adapter(old);
  try {
    await runLocalMigrations(tx, localMigrations.slice(0, 48));
    await new OutboxRepository(tx).enqueue({
      commandId: x.ctx.commandId,
      deviceId: x.ctx.deviceId,
      storeId: x.p.storeId,
      commandType: "TEST",
      entityType: "sync_test_entity",
      entityId: randomUUID(),
      payload: {},
      createdAt: x.p.updatedAt,
    });
    await runLocalMigrations(tx);
    expect(
      await new OutboxRepository(tx).listPending(x.p.storeId),
    ).toHaveLength(1);
    expect(
      await new StoreLayoutRepository(tx, randomUUID).get(x.p.storeId),
    ).toBeNull();
  } finally {
    old.close();
  }
});
it("commits history/head/Outbox together, replays the exact command after restart and never overwrites a newer draft", async () => {
  const x = await setup(),
    v = input(x),
    first = await x.repo.save(v, x.ctx);
  const second = await x.repo.save(
    {
      ...v,
      expectedRevisionId: first.revisionId,
      content: {
        ...v.content,
        room: { ...v.content.room, depth: { mm: 9000, quality: "MEASURED" } },
      },
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  x.db.close();
  const db = new DatabaseSync(x.path);
  dbs.push(db);
  const repo = new StoreLayoutRepository(new Adapter(db), randomUUID);
  expect(await repo.save(v, x.ctx)).toEqual(first);
  expect((await repo.get(x.p.storeId))?.entity).toEqual(second);
  expect(await repo.history(x.p.storeId)).toHaveLength(2);
  await expect(
    repo.save(
      {
        ...v,
        content: {
          ...v.content,
          provenance: { kind: "USER", reference: null },
        },
      },
      x.ctx,
    ),
  ).rejects.toThrow("COMMAND_REUSED");
  expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()?.n).toBe(2);
  for (const t of ["products", "sales_observations", "commercial_week_plans"])
    expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()?.n).toBe(0);
});
it("rolls back all records when the local transaction cannot commit", async () => {
  const x = await setup();
  x.tx.fail = true;
  await expect(x.repo.save(input(x), x.ctx)).rejects.toThrow("COMMIT_FAILED");
  expect(await x.repo.get(x.p.storeId)).toBeNull();
  expect(await x.repo.history(x.p.storeId)).toEqual([]);
  expect(
    (await new OutboxRepository(x.tx).countActive(x.p.storeId)).pending_count,
  ).toBe(0);
});
it("saves incomplete measurements, adopts only the current draft, discards without deleting its content and restores an immutable version", async () => {
  const x = await setup(),
    p = await x.repo.save(input(x), x.ctx),
    save = (v: Parameters<StoreLayoutRepository["save"]>[0]) =>
      x.repo.save(v, { ...x.ctx, commandId: randomUUID() });
  const ref = await save({
    storeId: p.storeId,
    expectedRevisionId: p.revisionId,
    action: "ADOPT_REFERENCE",
  });
  expect(await x.repo.reference(p.storeId)).toEqual(ref);
  const draft = await save({
    storeId: p.storeId,
    expectedRevisionId: ref.revisionId,
    action: "SAVE_DRAFT",
    content: { ...p.content, provenance: { kind: "USER", reference: null } },
  });
  const discarded = await save({
    storeId: p.storeId,
    expectedRevisionId: draft.revisionId,
    action: "DISCARD_DRAFT",
  });
  expect(discarded.content).toEqual(draft.content);
  expect(await x.repo.reference(p.storeId)).toEqual(ref);
  const restored = await save({
    storeId: p.storeId,
    expectedRevisionId: discarded.revisionId,
    action: "RESTORE_AS_DRAFT",
    restoredFromRevisionId: p.revisionId,
  });
  expect(restored.content).toEqual(p.content);
  expect(restored.revisionId).not.toBe(p.revisionId);
  expect(await x.repo.history(p.storeId)).toHaveLength(5);
  await expect(
    save({
      storeId: p.storeId,
      expectedRevisionId: ref.revisionId,
      action: "ADOPT_REFERENCE",
    }),
  ).rejects.toThrow("SOURCE_CHANGED");
  await expect(
    x.repo.save(input(x), {
      ...x.ctx,
      commandId: randomUUID(),
      canWrite: false as true,
    }),
  ).rejects.toThrow();
});
it("protects newer dirty drafts against old acknowledgements and pull, checks immutable history and tenant scope", async () => {
  const x = await setup(),
    p = await x.repo.save(input(x), x.ctx),
    second = await x.repo.save(
      { ...input(x), expectedRevisionId: p.revisionId },
      { ...x.ctx, commandId: randomUUID() },
    );
  await applyStoreLayout(x.tx, p.storeId, p, 1);
  await applyStoreLayout(x.tx, p.storeId, p);
  expect((await x.repo.get(p.storeId))?.entity).toEqual(second);
  await expect(applyStoreLayout(x.tx, randomUUID(), p)).rejects.toThrow(
    "SCOPE_INVALID",
  );
  await expect(
    applyStoreLayoutRevision(x.tx, p.storeId, {
      id: p.revisionId,
      storeId: p.storeId,
      plan: { ...p, action: "DISCARD_DRAFT" },
      version: 1,
    }),
  ).rejects.toThrow("HISTORY_CHANGED");
  await applyStoreLayout(x.tx, p.storeId, second, 2);
  expect((await x.repo.get(p.storeId))?.syncState).toBe("SYNCED");
  expect(await x.repo.get(randomUUID())).toBeNull();
});
it.each([false, true])(
  "compares device conflicts explicitly, preserving both intentions; keep local=%s",
  async (useLocal) => {
    const x = await setup(),
      p = await x.repo.save(input(x), x.ctx),
      remote = {
        ...p,
        revisionId: randomUUID(),
        content: {
          ...p.content,
          provenance: { kind: "USER" as const, reference: null },
        },
      };
    const outbox = new OutboxRepository(x.tx),
      command = (await outbox.listPending(p.storeId))[0]!;
    const conflict = await new ConflictRepository(x.tx).recordPushConflict(
      command,
      {
        commandId: command.commandId,
        entityId: p.id,
        entityType: "store_layout",
        status: "CONFLICT",
        remoteVersion: 1,
        remoteEntity: remote,
      },
    );
    await x.tx.runAsync("UPDATE store_layouts SET sync_state='CONFLICT'");
    const choice = {
      storeId: p.storeId,
      useLocal,
      localRevisionId: p.revisionId,
      remoteRevisionId: remote.revisionId,
    };
    const reviewed = await x.repo.review(p.storeId, conflict.id, x.ctx.actorId);
    await expect(
      x.repo.resolve(
        conflict.id,
        { ...choice, remoteRevisionId: randomUUID() },
        {
          ...x.ctx,
          commandId: randomUUID(),
          reviewHash: reviewed.hash,
          canResolve: () => true,
        },
      ),
    ).rejects.toThrow("SOURCE_CHANGED");
    await x.repo.resolve(conflict.id, choice, {
      ...x.ctx,
      reviewHash: reviewed.hash,
      canResolve: () => true,
      commandId: randomUUID(),
    });
    const head = (await x.repo.get(p.storeId))!;
    expect(head.entity.content).toEqual(useLocal ? p.content : remote.content);
    expect(head.entity.version).toBe(useLocal ? 2 : 1);
    expect(await x.repo.history(p.storeId)).toHaveLength(useLocal ? 3 : 2);
    expect((await outbox.countActive(p.storeId)).failed_count).toBe(0);
    expect(await outbox.listPending(p.storeId)).toHaveLength(useLocal ? 1 : 0);
    const page = await x.repo.history(p.storeId, 1);
    const end = page[0]!.revision;
    const next = await x.repo.history(p.storeId, 1, {
      version: end.plan.version,
      id: end.id,
    });
    expect(next[0]?.revision.id).not.toBe(end.id);
  },
);
function boot(p: ReturnType<typeof layoutFixture>): BootstrapResponse {
  return {
    protocolVersion: 1,
    store: { id: p.storeId },
    snapshotRevision: "layout",
    cursor: "layout-0",
    historyPolicy: { rawObservationDays: 90 },
    serverTime: p.updatedAt,
    entities: {
      syncTestEntities: [],
      products: [],
      productIdentifiers: [],
      productAliases: [],
      needUnits: [],
      needMemberships: [],
      productSubstitutions: [],
      salesObservations: [],
      wasteObservations: [],
      commercialOperations: [],
      offers: [],
      marketSignals: [],
      executionInstructions: [],
      storeEvents: [],
      productDailyPerformance: [],
      departmentDailyPerformance: [],
      recommendations: [],
      decisions: [],
      actionExecutions: [],
      storeLayouts: [p],
      storeLayoutRevisions: [
        { id: p.revisionId, storeId: p.storeId, plan: p, version: 1 },
      ],
    },
  };
}
it("restores another device through capable bootstrap and applies checked pull envelopes atomically", async () => {
  const x = await setup(),
    snapshot = boot(x.p);
  await applyBootstrap(x.tx, x.p.storeId, snapshot);
  expect((await x.repo.get(x.p.storeId))?.entity).toEqual(x.p);
  expect(
    await x.tx.getFirstAsync(
      "SELECT value FROM app_metadata WHERE key=?",
      `store-layouts:${x.p.storeId}`,
    ),
  ).toEqual({ value: "1" });
  const n = nextLayout(x.p),
    page: SyncPullResponse = {
      nextCursor: "layout-2",
      hasMore: false,
      serverTime: n.updatedAt,
      changes: [
        {
          sequence: "2",
          entityType: "store_layout",
          entityId: n.id,
          entityVersion: n.version,
          operation: "UPSERT",
          changedAt: n.updatedAt,
          entity: n,
        },
      ],
    };
  await applyPullPage(x.tx, n.storeId, page);
  expect((await x.repo.get(n.storeId))?.entity).toEqual(n);
  await expect(
    applyPullPage(x.tx, n.storeId, {
      ...page,
      nextCursor: "bad",
      changes: [{ ...page.changes[0]!, entityId: randomUUID() }],
    }),
  ).rejects.toThrow("ENVELOPE_INVALID");
  expect((await x.repo.get(n.storeId))?.entity).toEqual(n);
});
it("drains sequential offline revisions through the real sync service and marks head/history synced", async () => {
  const x = await setup(),
    p = await x.repo.save(input(x), x.ctx),
    n = await x.repo.save(
      { ...input(x), expectedRevisionId: p.revisionId },
      { ...x.ctx, commandId: randomUUID() },
    );
  const versions: number[] = [];
  const service = new MobileSyncService(
    x.tx,
    {
      bootstrap: async () => boot(n),
      pull: async () => ({
        protocolVersion: 1,
        nextCursor: "layout-3",
        hasMore: false,
        changes: [],
        serverTime: n.updatedAt,
      }),
      push: async (r) => ({
        protocolVersion: 1,
        serverTime: n.updatedAt,
        results: r.commands.map((c) => {
          versions.push((c.payload as { version: number }).version);
          return {
            commandId: c.commandId,
            entityType: c.entityType,
            entityId: c.entityId,
            status: "APPLIED",
            remoteVersion: (c.payload as { version: number }).version,
            remoteEntity: c.payload,
          };
        }),
      }),
    },
    { appVersion: "test", deviceId: x.ctx.deviceId, storeLayouts: true },
  );
  expect((await service.sync(p.storeId)).pushed).toBe(2);
  expect(versions).toEqual([1, 2]);
  expect((await x.repo.get(p.storeId))?.syncState).toBe("SYNCED");
  expect((await x.repo.history(p.storeId)).every((r) => r.synced)).toBe(true);
});

it("keeps the pending command when a successful-looking response acknowledges a different layout revision", async () => {
  const x = await setup(),
    p = await x.repo.save(input(x), x.ctx);
  const service = new MobileSyncService(
    x.tx,
    {
      bootstrap: async () => boot(p),
      pull: async () => ({
        nextCursor: "unused",
        hasMore: false,
        serverTime: p.updatedAt,
        changes: [],
      }),
      push: async (r) => ({
        serverTime: p.updatedAt,
        results: r.commands.map((c) => ({
          commandId: c.commandId,
          entityType: c.entityType,
          entityId: c.entityId,
          status: "APPLIED",
          remoteVersion: 1,
          remoteEntity: { ...p, revisionId: randomUUID() },
        })),
      }),
    },
    { appVersion: "test", deviceId: x.ctx.deviceId },
  );
  await expect(service.push(p.storeId)).rejects.toThrow("ACK_INVALID");
  expect((await x.repo.get(p.storeId))?.entity).toEqual(p);
  expect(
    (await new OutboxRepository(x.tx).countActive(p.storeId)).pending_count,
  ).toBe(1);
  expect((await x.repo.history(p.storeId))[0]?.synced).toBe(false);
});

it("loads an exact historical snapshot only in its original store", async () => {
  const x = await setup(),
    p = await x.repo.save(input(x), x.ctx);
  expect(await x.repo.getRevision(p.storeId, p.revisionId)).toEqual(p);
  expect(await x.repo.getRevision(randomUUID(), p.revisionId)).toBeNull();
});

it("resumes an abandoned first draft through immutable history with the same furniture and surface IDs", async () => {
  const x = await setup(),
    first = await x.repo.save(input(x), x.ctx);
  const discarded = await x.repo.save(
    {
      storeId: first.storeId,
      expectedRevisionId: first.revisionId,
      action: "DISCARD_DRAFT",
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  expect(await x.repo.reference(first.storeId)).toBeNull();
  const source = await x.repo.getRevision(first.storeId, first.revisionId);
  expect(source).toEqual(first);
  const restored = await x.repo.save(
    {
      storeId: first.storeId,
      expectedRevisionId: discarded.revisionId,
      action: "RESTORE_AS_DRAFT",
      restoredFromRevisionId: source!.revisionId,
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  expect(restored.content).toEqual(first.content);
  expect(restored.revisionId).not.toBe(first.revisionId);
  expect(await x.repo.history(first.storeId)).toHaveLength(3);
});

it("persists physical edits and optional mobiles offline, then restores their exact identities after removal and restart", async () => {
  const x = await setup(),
    first = await x.repo.save(input(x), x.ctx);
  let content = addStoreLayoutMobile(
    first.content,
    randomUUID,
    "Mobile A1",
    first.content.furniture[0]!.id,
  );
  const mobile = content.furniture.at(-1)!,
    surface = content.surfaces.at(-1)!;
  content = placeStoreLayoutObject(
    content,
    "ASSEMBLY",
    content.assemblies[0]!.id,
    {
      x: { mm: 2500, quality: "DECLARED" },
      y: content.assemblies[0]!.y,
      rotation: 90,
    },
  );
  const edited = await x.repo.save(
    {
      storeId: first.storeId,
      expectedRevisionId: first.revisionId,
      action: "SAVE_DRAFT",
      content,
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  const adopted = await x.repo.save(
    {
      storeId: first.storeId,
      expectedRevisionId: edited.revisionId,
      action: "ADOPT_REFERENCE",
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  const removed = await x.repo.save(
    {
      storeId: first.storeId,
      expectedRevisionId: adopted.revisionId,
      action: "SAVE_DRAFT",
      content: removeStoreLayoutMobile(adopted.content, mobile.id),
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  x.db.close();
  const reopened = new DatabaseSync(x.path);
  dbs.push(reopened);
  const tx = new Adapter(reopened),
    repo = new StoreLayoutRepository(tx, randomUUID, () => first.updatedAt);
  expect((await repo.get(first.storeId))?.entity).toEqual(removed);
  expect(
    (await repo.reference(first.storeId))?.content.surfaces,
  ).toContainEqual(surface);
  expect(
    (await repo.getRevision(first.storeId, edited.revisionId))?.content
      .furniture,
  ).toContainEqual(mobile);
  const restored = await repo.save(
    {
      storeId: first.storeId,
      expectedRevisionId: removed.revisionId,
      action: "RESTORE_AS_DRAFT",
      restoredFromRevisionId: adopted.revisionId,
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  expect(restored.content).toEqual(adopted.content);
  expect(restored.content.surfaces.at(-1)?.id).toBe(surface.id);
  expect(
    (await new OutboxRepository(tx).countActive(first.storeId)).pending_count,
  ).toBe(5);
  expect(await repo.history(first.storeId)).toHaveLength(5);
});

it("retains fixed inventory copies, detached mobiles and original surface identities through offline restart and historical restore", async () => {
  const x = await setup();
  const originalContent = addStoreLayoutMobile(
    x.p.content,
    randomUUID,
    "Mobile conservé",
    x.p.content.furniture[0]!.id,
  );
  const original = await x.repo.save(
    { ...input(x), content: originalContent },
    x.ctx,
  );
  const island = original.content.assemblies[0]!;
  const copied = duplicateStoreLayoutInventory(
    original.content,
    { kind: "ASSEMBLY", id: island.id },
    { label: "Îlot copié", copyDimensions: false },
    randomUUID,
  );
  const copyRevision = await x.repo.save(
    {
      storeId: original.storeId,
      expectedRevisionId: original.revisionId,
      action: "SAVE_DRAFT",
      content: copied.content,
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  const removed = await x.repo.save(
    {
      storeId: original.storeId,
      expectedRevisionId: copyRevision.revisionId,
      action: "SAVE_DRAFT",
      content: removeStoreLayoutInventory(copyRevision.content, {
        kind: "ASSEMBLY",
        id: island.id,
      }),
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  const mobile = original.content.furniture.find((f) => f.kind === "MOBILE")!;
  expect(
    removed.content.furniture.find((f) => f.id === mobile.id)?.hostId,
  ).toBeNull();
  const copiedMembers = copyRevision.content.furniture
    .filter((f) => f.assemblyId === copied.id)
    .map((f) => f.id);
  const copiedSurfaces = copyRevision.content.surfaces.filter((s) =>
    copiedMembers.includes(s.furnitureId),
  );
  expect(copiedSurfaces).toHaveLength(16);
  x.db.close();
  const db = new DatabaseSync(x.path);
  dbs.push(db);
  const tx = new Adapter(db),
    repo = new StoreLayoutRepository(tx, randomUUID, () => original.updatedAt);
  expect((await repo.get(original.storeId))?.entity).toEqual(removed);
  expect(
    (await repo.get(original.storeId))?.entity.content.surfaces.filter((s) =>
      copiedMembers.includes(s.furnitureId),
    ),
  ).toEqual(copiedSurfaces);
  expect(
    (await repo.getRevision(original.storeId, original.revisionId))?.content,
  ).toEqual(original.content);
  const restored = await repo.save(
    {
      storeId: original.storeId,
      expectedRevisionId: removed.revisionId,
      action: "RESTORE_AS_DRAFT",
      restoredFromRevisionId: original.revisionId,
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  expect(restored.content).toEqual(original.content);
  expect(restored.revisionId).not.toBe(original.revisionId);
  expect(
    (await new OutboxRepository(tx).countActive(original.storeId))
      .pending_count,
  ).toBe(4);
  expect(await repo.history(original.storeId)).toHaveLength(4);
});

it("saves an impossible draft but refuses reference adoption atomically before history or Outbox changes", async () => {
  const x = await setup(),
    content = completeLayoutGeometry(),
    tgs = content.furniture.filter((f) => f.kind === "TG");
  tgs[1]!.x = tgs[0]!.x;
  tgs[1]!.y = tgs[0]!.y;
  const draft = await x.repo.save({ ...input(x), content }, x.ctx);
  await expect(
    x.repo.save(
      {
        storeId: draft.storeId,
        expectedRevisionId: draft.revisionId,
        action: "ADOPT_REFERENCE",
      },
      { ...x.ctx, commandId: randomUUID() },
    ),
  ).rejects.toThrow("STORE_LAYOUT_GEOMETRY_BLOCKED");
  expect((await x.repo.get(draft.storeId))?.entity).toEqual(draft);
  expect(await x.repo.reference(draft.storeId)).toBeNull();
  expect(await x.repo.history(draft.storeId)).toHaveLength(1);
  expect(
    (await new OutboxRepository(x.tx).countActive(draft.storeId)).pending_count,
  ).toBe(1);
});

it("keeps drag previews ephemeral and saves one reviewed movement with its reference and stable IDs across offline restart", async () => {
  const { dragStoreLayoutObject } = await import("./layout-drag");
  const x = await setup(),
    first = await x.repo.save(
      { ...input(x), content: completeLayoutGeometry() },
      x.ctx,
    );
  const reference = await x.repo.save(
    {
      storeId: first.storeId,
      expectedRevisionId: first.revisionId,
      action: "ADOPT_REFERENCE",
    },
    { ...x.ctx, commandId: randomUUID() },
  );
  const a = reference.content.assemblies[0]!,
    frame = { width: 390, height: 350, factor: 0.02, ox: 10, oy: 20 },
    viewport = { scale: 2, x: 0, y: 0 };
  dragStoreLayoutObject(reference.content, a.id, 10, 10, frame, viewport);
  const moved = dragStoreLayoutObject(
    reference.content,
    a.id,
    20,
    20,
    frame,
    viewport,
  );
  expect(
    (await new OutboxRepository(x.tx).countActive(first.storeId)).pending_count,
  ).toBe(2);
  expect((await x.repo.get(first.storeId))!.entity).toEqual(reference);
  const request = {
      storeId: first.storeId,
      expectedRevisionId: reference.revisionId,
      action: "SAVE_DRAFT" as const,
      content: moved,
    },
    ctx = { ...x.ctx, commandId: randomUUID() };
  const saved = await x.repo.save(request, ctx);
  expect(saved.referenceRevisionId).toBe(reference.revisionId);
  await expect(
    x.repo.save(request, { ...ctx, commandId: randomUUID() }),
  ).rejects.toThrow();
  expect(
    (await new OutboxRepository(x.tx).countActive(first.storeId)).pending_count,
  ).toBe(3);
  x.db.close();
  const db = new DatabaseSync(x.path);
  dbs.push(db);
  const tx = new Adapter(db),
    repo = new StoreLayoutRepository(tx, randomUUID, () => saved.updatedAt);
  expect((await repo.get(first.storeId))!.entity).toEqual(saved);
  expect((await repo.reference(first.storeId))!.content).toEqual(
    reference.content,
  );
  expect((await repo.get(first.storeId))!.entity.content.surfaces).toEqual(
    reference.content.surfaces,
  );
  expect(await repo.save(request, ctx)).toEqual(saved);
  expect(
    (await new OutboxRepository(tx).countActive(first.storeId)).pending_count,
  ).toBe(3);
  expect(await repo.history(first.storeId)).toHaveLength(3);
});
