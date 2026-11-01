import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, expect } from "vitest";
import { receiptReviewDigest } from "../../../../scripts/test-receipt-publication-sqlite";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { storeContextSettingsSchema } from "@fl-copilot/sync-contracts";
import {
  StoreContextRepository,
  applyStoreContext,
} from "./context-repository";
import { runLocalMigrations } from "../db/migrations";
import { ConflictRepository } from "../sync/conflict-repository";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
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
  const settings = storeContextFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-store-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  return {
    settings,
    db,
    tx,
    path,
    repo: new StoreContextRepository(tx, receiptReviewDigest),
    ctx: { commandId: randomUUID(), deviceId: randomUUID() },
  };
}
it("persists settings, audit and Outbox atomically and restores them offline without changing business data", async () => {
  const x = await setup();
  await x.repo.save(x.settings, x.ctx);
  expect(
    await new OutboxRepository(x.tx).listPending(x.settings.storeId),
  ).toHaveLength(1);
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM store_context_history").get()?.n,
  ).toBe(1);
  for (const t of ["commercial_week_plans", "products", "sales_observations"])
    expect(x.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()?.n).toBe(0);
  x.db.close();
  const db = new DatabaseSync(x.path);
  dbs.push(db);
  expect(
    (await new StoreContextRepository(new Adapter(db)).get(x.settings.storeId))
      ?.entity,
  ).toEqual(x.settings);
});
it("rejects incomplete coordinate mode or foreign identity and rolls back failure", async () => {
  const x = await setup();
  expect(
    storeContextSettingsSchema.safeParse({
      ...x.settings,
      locationMode: "POINT",
    }).success,
  ).toBe(false);
  expect(
    storeContextSettingsSchema.safeParse({ ...x.settings, id: randomUUID() })
      .success,
  ).toBe(false);
  x.tx.fail = true;
  await expect(x.repo.save(x.settings, x.ctx)).rejects.toThrow("COMMIT_FAILED");
  expect(await x.repo.get(x.settings.storeId)).toBeNull();
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM store_context_history").get()?.n,
  ).toBe(0);
});
it("orders revisions and prevents an old acknowledgement/pull from overwriting a newer local point setting", async () => {
  const x = await setup();
  await x.repo.save(x.settings, x.ctx);
  const next = {
    ...x.settings,
    version: 2,
    locationMode: "POINT" as const,
    position: {
      latitude: 48.91,
      longitude: 2.29,
      capturedAt: x.settings.createdAt,
      source: "DEVICE" as const,
    },
  };
  await x.repo.save(next, { ...x.ctx, commandId: randomUUID() });
  expect(
    await new OutboxRepository(x.tx).listPending(x.settings.storeId),
  ).toHaveLength(1);
  await applyStoreContext(x.tx, x.settings.storeId, x.settings, 1);
  await applyStoreContext(x.tx, x.settings.storeId, x.settings);
  expect((await x.repo.get(x.settings.storeId))?.entity).toEqual(next);
  expect(await x.repo.get(randomUUID())).toBeNull();
});
it("resolves different-device configurations explicitly and preserves superseded actions", async () => {
  const x = await setup();
  await x.repo.save(x.settings, x.ctx);
  const cmd = (
      await new OutboxRepository(x.tx).listPending(x.settings.storeId)
    )[0]!,
    remote = { ...x.settings, schoolZone: "B" as const };
  const conflict = await new ConflictRepository(x.tx).recordPushConflict(cmd, {
    commandId: cmd.commandId,
    status: "CONFLICT",
    entityType: cmd.entityType,
    entityId: cmd.entityId,
    remoteVersion: 1,
    remoteEntity: remote,
  });
  await x.tx.runAsync(
    "UPDATE store_context_settings SET sync_state='CONFLICT' WHERE id=?",
    x.settings.id,
  );
  const review = await x.repo.review(x.settings.storeId, conflict.id);
  await x.repo.resolve(conflict.id, false, {
    ...x.ctx,
    storeId: x.settings.storeId,
    reviewHash: review.hash,
    remoteHistoryId: randomUUID(),
    canResolve: () => true,
    commandId: randomUUID(),
  });
  expect((await x.repo.get(x.settings.storeId))?.entity.schoolZone).toBe("B");
  expect(
    await new OutboxRepository(x.tx).countActive(x.settings.storeId),
  ).toEqual({ pending_count: 0, failed_count: 0 });
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM store_context_history").get()?.n,
  ).toBe(2);
});

it("refuses an editor's stale baseline atomically, retaining the current settings and its Outbox", async () => {
  const x = await setup();
  await x.repo.save(x.settings, x.ctx, null);
  const base = (await x.repo.get(x.settings.storeId))!.entity;
  const first = { ...base, city: "Paris", postalCode: "75001", version: 2 };
  await x.repo.save(first, { ...x.ctx, commandId: randomUUID() }, base);
  const count = await x.tx.getFirstAsync<{ n: number }>(
    "SELECT count(*) AS n FROM sync_outbox",
  );
  await expect(
    x.repo.save(
      { ...first, city: "Lyon", postalCode: "69001", version: 3 },
      { ...x.ctx, commandId: randomUUID() },
      base,
    ),
  ).rejects.toThrow("STORE_CONTEXT_CHANGED");
  expect((await x.repo.get(x.settings.storeId))!.entity).toEqual(first);
  expect(
    await x.tx.getFirstAsync("SELECT count(*) AS n FROM sync_outbox"),
  ).toEqual(count);
  // The user may explicitly reload the current baseline, then save exactly one revision.
  const corrected = { ...first, city: "Lyon", postalCode: "69001", version: 3 };
  await x.repo.save(corrected, { ...x.ctx, commandId: randomUUID() }, first);
  expect((await x.repo.get(x.settings.storeId))!.entity).toEqual(corrected);
});

it("retains merchandising through an unrelated local edit, legacy acknowledgement and restart; explicit clearing remains deliberate", async () => {
  const x = await setup();
  const merchandising = {
    activeTgCount: 2,
    implantation: "Deux îlots",
    circulation: "Allée centrale, TG1 en premier",
    zones: [
      {
        id: randomUUID(),
        label: "TG1",
        kind: "TG" as const,
        active: true,
        position: "Première du parcours",
        heat: "COLD" as const,
        note: "Observation déclarée",
      },
    ],
  };
  await x.repo.save({ ...x.settings, merchandising }, x.ctx);
  await applyStoreContext(
    x.tx,
    x.settings.storeId,
    { ...x.settings, merchandising },
    1,
  );
  await x.repo.save(
    { ...x.settings, city: "Paris", version: 2 },
    { ...x.ctx, commandId: randomUUID() },
  );
  expect((await x.repo.get(x.settings.storeId))!.entity.merchandising).toEqual(
    merchandising,
  );
  const pending = await new OutboxRepository(x.tx).listPending(
    x.settings.storeId,
  );
  expect(pending.at(-1)!.payload).toMatchObject({ merchandising });
  await applyStoreContext(
    x.tx,
    x.settings.storeId,
    { ...x.settings, city: "Paris", version: 2 },
    2,
  );
  expect((await x.repo.get(x.settings.storeId))!.entity.merchandising).toEqual(
    merchandising,
  );
  x.db.close();
  const db = new DatabaseSync(x.path);
  dbs.push(db);
  const repo = new StoreContextRepository(new Adapter(db));
  expect((await repo.get(x.settings.storeId))!.entity.merchandising).toEqual(
    merchandising,
  );
  await repo.save(
    { ...x.settings, merchandising: null, version: 3 },
    { ...x.ctx, commandId: randomUUID() },
  );
  expect((await repo.get(x.settings.storeId))!.entity.merchandising).toBeNull();
});

it("does not invent remote merchandising when a legacy snapshot arrives while a local edit is unsynchronized", async () => {
  const x = await setup();
  const merchandising = {
    activeTgCount: 2,
    implantation: null,
    circulation: "Allée centrale",
    zones: [],
  };
  await x.repo.save({ ...x.settings, merchandising }, x.ctx);
  await applyStoreContext(x.tx, x.settings.storeId, x.settings);
  const current = await x.repo.get(x.settings.storeId);
  expect(current?.entity.merchandising).toEqual(merchandising);
  expect(current?.remote).not.toHaveProperty("merchandising");
  expect(current?.syncState).toBe("PENDING");
});
