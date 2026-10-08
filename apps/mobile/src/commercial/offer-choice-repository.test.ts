import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../../scripts/test-commercial-choice-fixtures";
import {
  CommercialChoiceRepository,
  applyCommercialChoice,
} from "./offer-choice-repository";
import { applyCommercialVisualReading } from "./visual-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { runLocalMigrations } from "../db/migrations";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { MobileSyncService } from "../sync/sync-service";
import { applyPullPage } from "../sync/apply-pull-page";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(sql: string) {
    this.db.exec(sql);
  }
  async runAsync(sql: string, ...params: Array<string | number | null>) {
    return this.db.prepare(sql).run(...params);
  }
  async getFirstAsync<T>(
    sql: string,
    ...params: Array<string | number | null>
  ) {
    return (this.db.prepare(sql).get(...params) as T) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: Array<string | number | null>) {
    return this.db.prepare(sql).all(...params) as T[];
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
  connections: DatabaseSync[] = [];
afterEach(() => {
  for (const c of connections.splice(0))
    try {
      c.close();
    } catch {
      /* already closed for restart test */
    }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function setup() {
  const f = await commercialChoiceFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-choice-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  connections.push(db);
  const adapter = new Adapter(db);
  await runLocalMigrations(adapter);
  await applyCommercialVisualReading(adapter, f.storeId, f.reading);
  await new ProductMasterRepository(adapter).upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: randomUUID(),
  });
  db.exec("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
  await adapter.runAsync(
    "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES(?, 'before',1)",
    f.storeId,
  );
  return {
    ...f,
    db,
    adapter,
    path,
    repo: new CommercialChoiceRepository(adapter, testChoiceDigest),
    deviceId: randomUUID(),
  };
}
describe("offline retained commercial offers", () => {
  it("commits the retained offer and Outbox together, survives restart and leaves source/profile/KPI data untouched", async () => {
    const f = await setup(),
      before = JSON.stringify(
        f.db.prepare("SELECT * FROM commercial_visual_readings").get(),
      );
    await f.repo.save(f.choice, {
      commandId: randomUUID(),
      deviceId: f.deviceId,
    });
    expect((await f.repo.get(f.storeId, f.choice.id))?.syncState).toBe(
      "PENDING",
    );
    expect(
      await new OutboxRepository(f.adapter).listPending(f.storeId),
    ).toHaveLength(1);
    expect(
      f.db.prepare("SELECT COUNT(*) AS n FROM commercial_choice_history").get(),
    ).toEqual({ n: 1 });
    expect(
      JSON.stringify(
        f.db.prepare("SELECT * FROM commercial_visual_readings").get(),
      ),
    ).toBe(before);
    expect(
      (await new ProductMasterRepository(f.adapter).getProduct(f.productId))
        ?.entity.nature,
    ).toBe("UNKNOWN");
    f.db.close();
    const reopened = new DatabaseSync(f.path);
    connections.push(reopened);
    const repo = new CommercialChoiceRepository(
      new Adapter(reopened),
      testChoiceDigest,
    );
    expect((await repo.get(f.storeId, f.choice.id))?.entity).toEqual(f.choice);
  });
  it("rolls back all local writes when the Outbox transaction fails", async () => {
    const f = await setup();
    f.adapter.fail = true;
    await expect(
      f.repo.save(f.choice, { commandId: randomUUID(), deviceId: f.deviceId }),
    ).rejects.toThrow("COMMIT_FAILED");
    expect(await f.repo.list(f.storeId)).toEqual([]);
    expect(
      await new OutboxRepository(f.adapter).listPending(f.storeId),
    ).toEqual([]);
    expect(
      f.db.prepare("SELECT COUNT(*) AS n FROM commercial_choice_history").get(),
    ).toEqual({ n: 0 });
  });
  it("serializes offline retain/withdraw commands and an old acknowledgement never erases the latest local choice", async () => {
    const f = await setup();
    await f.repo.save(f.choice, {
      commandId: randomUUID(),
      deviceId: f.deviceId,
    });
    const withdrawn = {
      ...f.choice,
      status: "WITHDRAWN" as const,
      version: 2,
      updatedAt: "2026-10-08T08:02:00.000Z",
    };
    await f.repo.save(withdrawn, {
      commandId: randomUUID(),
      deviceId: f.deviceId,
    });
    expect(
      await new OutboxRepository(f.adapter).listPending(f.storeId),
    ).toHaveLength(1);
    await applyCommercialChoice(f.adapter, f.storeId, f.choice, 1);
    expect((await f.repo.get(f.storeId, f.choice.id))?.entity).toEqual(
      withdrawn,
    );
    const versions: Array<number | null | undefined> = [];
    const service = new MobileSyncService(
      f.adapter,
      {
        bootstrap: async () => {
          throw Error("NO_BOOTSTRAP");
        },
        push: async (request) => ({
          serverTime: new Date().toISOString(),
          results: request.commands.map((c) => {
            versions.push(c.expectedRemoteVersion);
            const e = c.payload as { version: number };
            return {
              commandId: c.commandId,
              entityType: c.entityType,
              entityId: c.entityId,
              status: "APPLIED" as const,
              remoteVersion: e.version,
              remoteEntity: c.payload,
            };
          }),
        }),
        pull: async () => ({
          changes: [],
          nextCursor: "after",
          hasMore: false,
          serverTime: new Date().toISOString(),
        }),
      },
      { appVersion: "test", deviceId: f.deviceId, maxRetries: 0 },
    );
    await service.sync(f.storeId);
    expect(versions).toEqual([null, 1]);
    expect(await f.repo.get(f.storeId, f.choice.id)).toMatchObject({
      syncState: "SYNCED",
      entity: { status: "WITHDRAWN", version: 2 },
    });
  });
  it("preserves a pending local choice during pull and requires explicit conflict adoption with audit history", async () => {
    const f = await setup(),
      cmdId = randomUUID();
    await f.repo.save(f.choice, { commandId: cmdId, deviceId: f.deviceId });
    const remote = {
      ...f.choice,
      status: "WITHDRAWN" as const,
      createdAt: "2026-10-08T07:00:00.000Z",
    };
    await applyCommercialChoice(f.adapter, f.storeId, remote);
    expect((await f.repo.get(f.storeId, f.choice.id))?.entity.status).toBe(
      "RETAINED",
    );
    const command = (
      await new OutboxRepository(f.adapter).listPending(f.storeId)
    )[0]!;
    await new ConflictRepository(f.adapter).recordPushConflict(command, {
      commandId: cmdId,
      status: "CONFLICT",
      entityType: command.entityType,
      entityId: command.entityId,
      remoteVersion: 1,
      remoteEntity: remote,
    });
    await f.adapter.runAsync(
      "UPDATE commercial_offer_choices SET sync_state='CONFLICT'",
    );
    await expect(
      f.repo.save(
        { ...f.choice, version: 2 },
        { commandId: randomUUID(), deviceId: f.deviceId },
      ),
    ).rejects.toThrow("RESOLVE_REQUIRED");
    await f.repo.resolve(cmdId, false, {
      commandId: randomUUID(),
      deviceId: f.deviceId,
    });
    expect((await f.repo.get(f.storeId, f.choice.id))?.entity).toEqual(remote);
    expect(
      f.db.prepare("SELECT COUNT(*) AS n FROM commercial_choice_history").get(),
    ).toEqual({ n: 2 });
  });
  it("rejects wrong source/store references and malformed pull envelopes without advancing the cursor", async () => {
    const f = await setup();
    await expect(
      f.repo.save(
        { ...f.choice, rawProductLabel: "Invented product" },
        { commandId: randomUUID(), deviceId: f.deviceId },
      ),
    ).rejects.toThrow("SOURCE_INVALID");
    await expect(
      applyPullPage(f.adapter, f.storeId, {
        changes: [
          {
            sequence: "1",
            entityType: "commercial_offer_choice",
            entityId: f.choice.id,
            entityVersion: 2,
            operation: "UPSERT",
            entity: f.choice,
            changedAt: new Date().toISOString(),
          },
        ],
        nextCursor: "bad",
        hasMore: false,
        serverTime: new Date().toISOString(),
      }),
    ).rejects.toThrow("ENVELOPE_INVALID");
    expect(f.db.prepare("SELECT cursor FROM sync_inbox_state").get()).toEqual({
      cursor: "before",
    });
    await expect(
      applyCommercialChoice(f.adapter, randomUUID(), f.choice),
    ).rejects.toThrow("STORE_INVALID");
  });
  it("rebases an explicit local conflict resolution and retires dependent queued edits without deleting their history", async () => {
    const f = await setup(),
      cmdId = randomUUID();
    await f.repo.save(f.choice, { commandId: cmdId, deviceId: f.deviceId });
    const latest = {
      ...f.choice,
      note: "Mon choix corrigé",
      version: 2,
      updatedAt: "2026-10-08T08:05:00.000Z",
    };
    await f.repo.save(latest, {
      commandId: randomUUID(),
      deviceId: f.deviceId,
    });
    const remote = {
      ...f.choice,
      status: "WITHDRAWN" as const,
      createdAt: "2026-10-08T07:00:00.000Z",
    };
    const outbox = new OutboxRepository(f.adapter),
      command = (await outbox.listPending(f.storeId))[0]!;
    await new ConflictRepository(f.adapter).recordPushConflict(command, {
      commandId: cmdId,
      status: "CONFLICT",
      entityType: command.entityType,
      entityId: command.entityId,
      remoteVersion: 1,
      remoteEntity: remote,
    });
    await f.adapter.runAsync(
      "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
      cmdId,
    );
    await f.adapter.runAsync(
      "UPDATE commercial_offer_choices SET sync_state='CONFLICT'",
    );
    expect(await outbox.listPending(f.storeId)).toEqual([]);
    await f.repo.resolve(cmdId, true, {
      commandId: randomUUID(),
      deviceId: f.deviceId,
    });
    const pending = await outbox.listPending(f.storeId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.expectedRemoteVersion).toBe(1);
    expect(pending[0]?.payload).toMatchObject({
      id: f.choice.id,
      note: "Mon choix corrigé",
      version: 2,
      createdAt: remote.createdAt,
    });
    expect(
      f.db.prepare("SELECT COUNT(*) AS n FROM commercial_choice_history").get(),
    ).toEqual({ n: 3 });
  });
});
