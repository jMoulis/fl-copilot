import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect, afterEach } from "vitest";
import { storeEventFixture } from "../../../../scripts/test-store-event-fixtures";
import {
  storeEventCapturePayload,
  closeStoreProductEvent,
  prepareStoreProductEvent,
} from "@fl-copilot/domain";
import {
  StoreProductEventRepository,
  applyStoreProductEvent,
} from "./store-event-repository";
import { storeEventSummary } from "./store-event-presentation";
import { runLocalMigrations } from "../db/migrations";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { MobileSyncService } from "../sync/sync-service";
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
      /* restart test already closed this connection */
    }
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});

async function setup() {
  const f = storeEventFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-events_"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  await tx.runAsync(
    "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at) VALUES(?,?,?,'UNKNOWN','UNKNOWN','UNKNOWN','ACTIVE',1,?,?)",
    f.product.id,
    f.product.storeId,
    f.product.label,
    f.product.createdAt,
    f.product.updatedAt,
  );
  return {
    ...f,
    db,
    tx,
    path,
    repo: new StoreProductEventRepository(tx),
    ctx: {
      commandId: randomUUID(),
      deviceId: randomUUID(),
      capturedAt: "2026-10-09T12:00:00Z",
    },
  };
}
it("commits capture/history/Outbox atomically, allows incomplete product metadata and persists restart", async () => {
  const f = await setup();
  f.tx.fail = true;
  await expect(
    f.repo.create(f.event.storeId, storeEventCapturePayload(f.event), f.ctx),
  ).rejects.toThrow("COMMIT_FAILED");
  expect(await f.repo.list(f.event.storeId)).toEqual([]);
  expect(await new OutboxRepository(f.tx).listPending(f.event.storeId)).toEqual(
    [],
  );
  f.tx.fail = false;
  await f.repo.create(
    f.event.storeId,
    storeEventCapturePayload(f.event),
    f.ctx,
  );
  await f.repo.create(f.event.storeId, storeEventCapturePayload(f.event), {
    ...f.ctx,
    commandId: randomUUID(),
  });
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const repo = new StoreProductEventRepository(new Adapter(db));
  expect((await repo.get(f.event.storeId, f.event.id))?.entity).toEqual(
    f.event,
  );
  expect(
    db.prepare("SELECT COUNT(*) n FROM store_product_event_history").get()?.n,
  ).toBe(1);
  expect(db.prepare("SELECT COUNT(*) n FROM sales_observations").get()?.n).toBe(
    0,
  );
  expect(
    db.prepare("SELECT COUNT(*) n FROM product_substitutions").get()?.n,
  ).toBe(0);
  expect(db.prepare("SELECT sales_unit FROM products").get()?.sales_unit).toBe(
    "UNKNOWN",
  );
  expect(storeEventSummary(f.event)).toContain("non précisée");
  expect(storeEventSummary(f.event)).not.toContain("gravité faible");
});
it("keeps distinct incidents and rejects foreign products, reverse intervals and identity changes", async () => {
  const f = await setup();
  await f.repo.create(
    f.event.storeId,
    storeEventCapturePayload(f.event),
    f.ctx,
  );
  const second = { ...f.event, id: randomUUID() };
  await f.repo.create(f.event.storeId, storeEventCapturePayload(second), {
    ...f.ctx,
    commandId: randomUUID(),
  });
  expect(await f.repo.list(f.event.storeId)).toHaveLength(2);
  await expect(
    f.repo.create(
      randomUUID(),
      storeEventCapturePayload({ ...f.event, id: randomUUID() }),
      { ...f.ctx, commandId: randomUUID() },
    ),
  ).rejects.toThrow("PRODUCT_INVALID");
  await expect(
    f.repo.close(f.event.storeId, f.event.id, "2026-10-09T08:00:00Z", f.ctx),
  ).rejects.toThrow();
  expect((await f.repo.get(f.event.storeId, f.event.id))?.entity.status).toBe(
    "ACTIVE",
  );
});
it("closes before first sync, keeps newer closure on creation ACK/pull and ignores equivalent duplicate local closure", async () => {
  const f = await setup();
  await f.repo.create(
    f.event.storeId,
    storeEventCapturePayload(f.event),
    f.ctx,
  );
  const end = "2026-10-09T11:00:00Z";
  const closed = await f.repo.close(f.event.storeId, f.event.id, end, {
    ...f.ctx,
    commandId: randomUUID(),
  });
  await f.repo.close(f.event.storeId, f.event.id, "2026-10-09T13:00:00+02:00", {
    ...f.ctx,
    commandId: randomUUID(),
  });
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM store_product_event_history").get()?.n,
  ).toBe(2);
  expect(
    await new OutboxRepository(f.tx).listPending(f.event.storeId),
  ).toHaveLength(1);
  await applyStoreProductEvent(f.tx, f.event.storeId, f.event, 1);
  await applyStoreProductEvent(f.tx, f.event.storeId, f.event);
  expect((await f.repo.get(f.event.storeId, f.event.id))?.entity).toEqual(
    closed,
  );
});
it("drains nested CREATE then minimal CLOSE and applies ACK versions without leaving the event pending", async () => {
  const f = await setup();
  await f.repo.create(
    f.event.storeId,
    storeEventCapturePayload(f.event),
    f.ctx,
  );
  await f.repo.close(f.event.storeId, f.event.id, "2026-10-09T11:00:00Z", {
    ...f.ctx,
    commandId: randomUUID(),
  });
  let remote = f.event;
  const types: string[] = [];
  const service = new MobileSyncService(
    f.tx,
    {
      bootstrap: async () => {
        throw Error("unused");
      },
      pull: async () => {
        throw Error("unused");
      },
      push: async (request) => ({
        serverTime: f.ctx.capturedAt,
        results: request.commands.map((c) => {
          types.push(c.type);
          if (c.type === "CREATE_STORE_EVENT") {
            expect(c.expectedRemoteVersion).toBeNull();
            remote = prepareStoreProductEvent(f.event.storeId, c.payload);
          } else {
            expect(c.expectedRemoteVersion).toBe(1);
            expect(Object.keys(c.payload as Record<string, unknown>)).toEqual([
              "endedAt",
            ]);
            remote = closeStoreProductEvent(
              remote,
              (c.payload as { endedAt: string }).endedAt,
              c.createdAt,
            );
          }
          return {
            commandId: c.commandId,
            status: "APPLIED" as const,
            entityId: c.entityId,
            entityType: c.entityType,
            remoteVersion: remote.version,
            remoteEntity: remote,
          };
        }),
      }),
    },
    { appVersion: "test", deviceId: f.ctx.deviceId, maxRetries: 0 },
  );
  await service.push(f.event.storeId);
  expect(types).toEqual(["CREATE_STORE_EVENT", "CLOSE_STORE_EVENT"]);
  expect((await f.repo.get(f.event.storeId, f.event.id))?.syncState).toBe(
    "SYNCED",
  );
  expect((await f.repo.get(f.event.storeId, f.event.id))?.entity.status).toBe(
    "CLOSED",
  );
});
it("records a complete conflict snapshot and explicitly rebases only a compatible end time with retained history", async () => {
  const f = await setup();
  await f.repo.create(
    f.event.storeId,
    storeEventCapturePayload(f.event),
    f.ctx,
  );
  const create = (
    await new OutboxRepository(f.tx).listPending(f.event.storeId)
  )[0]!;
  await applyStoreProductEvent(f.tx, f.event.storeId, f.event, 1);
  await new OutboxRepository(f.tx).markSyncing(create.commandId);
  await new OutboxRepository(f.tx).markAcknowledged(create.commandId);
  await f.repo.close(f.event.storeId, f.event.id, "2026-10-09T11:00:00Z", {
    ...f.ctx,
    commandId: randomUUID(),
  });
  const remote = closeStoreProductEvent(
    f.event,
    "2026-10-09T10:30:00Z",
    f.ctx.capturedAt,
  );
  const service = new MobileSyncService(
    f.tx,
    {
      bootstrap: async () => {
        throw Error("unused");
      },
      pull: async () => {
        throw Error("unused");
      },
      push: async (request) => ({
        serverTime: f.ctx.capturedAt,
        results: request.commands.map((c) => ({
          commandId: c.commandId,
          status: "CONFLICT" as const,
          entityId: c.entityId,
          entityType: c.entityType,
          remoteVersion: remote.version,
          remoteEntity: remote,
        })),
      }),
    },
    { appVersion: "test", deviceId: f.ctx.deviceId, maxRetries: 0 },
  );
  await service.push(f.event.storeId);
  const conflicts = await new ConflictRepository(f.tx).listOpen(
    f.event.storeId,
  );
  expect(conflicts[0]?.localPayload).toMatchObject({
    id: f.event.id,
    productId: f.product.id,
    status: "CLOSED",
  });
  await f.repo.resolve(conflicts[0]!.id, true, {
    ...f.ctx,
    commandId: randomUUID(),
  });
  expect((await f.repo.get(f.event.storeId, f.event.id))?.entity).toMatchObject(
    {
      version: 3,
      endedAt: "2026-10-09T11:00:00.000Z",
      startedAt: f.event.startedAt,
    },
  );
  expect(
    (await new OutboxRepository(f.tx).listPending(f.event.storeId))[0]
      ?.expectedRemoteVersion,
  ).toBe(2);
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM store_product_event_history").get()?.n,
  ).toBe(3);
});
it("recovers a failed creation while retaining an offline closure and emits the same birth then closure", async () => {
  const f = await setup();
  await f.repo.create(
    f.event.storeId,
    storeEventCapturePayload(f.event),
    f.ctx,
  );
  await f.repo.close(f.event.storeId, f.event.id, "2026-10-09T11:00:00Z", {
    ...f.ctx,
    commandId: randomUUID(),
  });
  const creation = (
    await new OutboxRepository(f.tx).listPending(f.event.storeId)
  )[0]!;
  await new OutboxRepository(f.tx).markSyncing(creation.commandId);
  await new OutboxRepository(f.tx).markFailed(
    creation.commandId,
    "NETWORK_ERROR",
  );
  await f.tx.runAsync(
    "UPDATE store_product_events SET sync_state='ERROR' WHERE id=?",
    f.event.id,
  );
  await f.repo.retry(f.event.storeId, f.event.id, {
    ...f.ctx,
    commandId: randomUUID(),
    closeCommandId: randomUUID(),
  });
  const first = (
    await new OutboxRepository(f.tx).listPending(f.event.storeId)
  )[0]!;
  expect(first.commandType).toBe("CREATE_STORE_EVENT");
  expect(first.payload).toEqual(storeEventCapturePayload(f.event));
  expect((await f.repo.get(f.event.storeId, f.event.id))?.entity).toMatchObject(
    { status: "CLOSED", version: 2, endedAt: "2026-10-09T11:00:00.000Z" },
  );
  await new OutboxRepository(f.tx).markSyncing(first.commandId);
  await applyStoreProductEvent(f.tx, f.event.storeId, f.event, 1);
  await new OutboxRepository(f.tx).markAcknowledged(first.commandId);
  const second = (
    await new OutboxRepository(f.tx).listPending(f.event.storeId)
  )[0]!;
  expect(second.commandType).toBe("CLOSE_STORE_EVENT");
  expect(second.expectedRemoteVersion).toBe(1);
  expect(second.payload).toEqual({ endedAt: "2026-10-09T11:00:00.000Z" });
  expect(
    (await new OutboxRepository(f.tx).countActive(f.event.storeId))
      .failed_count,
  ).toBe(0);
});
