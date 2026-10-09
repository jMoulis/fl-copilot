import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, it, expect } from "vitest";
import {
  membershipFixture,
  membershipDigest,
} from "../../../../scripts/test-membership-fixtures";
import {
  NeedMembershipRepository,
  applyNeedMembership,
} from "./membership-repository";
import { applyNeedUnit } from "./repository";
import { runLocalMigrations } from "../db/migrations";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
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
  const f = await membershipFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-memberships_"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  await applyNeedUnit(tx, f.need.storeId, f.need);
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
    repo: new NeedMembershipRepository(tx, membershipDigest),
    ctx: { commandId: randomUUID(), deviceId: randomUUID() },
  };
}
it("stores association/history/Outbox atomically, persists restart and leaves product facts unchanged", async () => {
  const f = await setup();
  await f.repo.save(f.membership, f.ctx);
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const repo = new NeedMembershipRepository(new Adapter(db), membershipDigest);
  expect((await repo.get(f.need.storeId, f.membership.id))?.entity).toEqual(
    f.membership,
  );
  expect(
    db.prepare("SELECT COUNT(*) n FROM need_membership_history").get()?.n,
  ).toBe(1);
  expect(db.prepare("SELECT sales_unit FROM products").get()?.sales_unit).toBe(
    "UNKNOWN",
  );
  expect(db.prepare("SELECT COUNT(*) n FROM sales_observations").get()?.n).toBe(
    0,
  );
});
it("rolls back the entire local batch when a later product is unavailable", async () => {
  const f = await setup(),
    bad = { ...f.membership, id: randomUUID(), productId: randomUUID() };
  f.tx.fail = true;
  await expect(f.repo.save(f.membership, f.ctx)).rejects.toThrow(
    "COMMIT_FAILED",
  );
  expect(await f.repo.list(f.need.storeId)).toEqual([]);
  f.tx.fail = false;
  await expect(
    f.repo.saveBatch([f.membership, bad], {
      deviceId: f.ctx.deviceId,
      commandIds: [randomUUID(), randomUUID()],
    }),
  ).rejects.toThrow();
  expect(await f.repo.list(f.need.storeId)).toEqual([]);
  expect(await new OutboxRepository(f.tx).listPending(f.need.storeId)).toEqual(
    [],
  );
});
it("orders edits, preserves newer pending scores across old ACK/pull and retains rejection history", async () => {
  const f = await setup();
  await f.repo.save(f.membership, f.ctx);
  const next = { ...f.membership, version: 2, strength: 0.4, confidence: 0.9 };
  await f.repo.save(next, { ...f.ctx, commandId: randomUUID() });
  expect(
    await new OutboxRepository(f.tx).listPending(f.need.storeId),
  ).toHaveLength(1);
  await applyNeedMembership(f.tx, f.need.storeId, f.membership, 1);
  await applyNeedMembership(f.tx, f.need.storeId, f.membership);
  expect((await f.repo.get(f.need.storeId, f.membership.id))?.entity).toEqual(
    next,
  );
  await f.repo.save(
    { ...next, version: 3, status: "REJECTED", humanConfirmed: true },
    { ...f.ctx, commandId: randomUUID() },
  );
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM need_membership_history").get()?.n,
  ).toBe(3);
});
it("requires explicit conflict adoption and preserves superseded local actions", async () => {
  const f = await setup();
  await f.repo.save(f.membership, f.ctx);
  const cmd = (
      await new OutboxRepository(f.tx).listPending(f.need.storeId)
    )[0]!,
    remote = { ...f.membership, strength: 0.5 };
  const conflict = await new ConflictRepository(f.tx).recordPushConflict(cmd, {
    commandId: cmd.commandId,
    status: "CONFLICT",
    entityType: cmd.entityType,
    entityId: cmd.entityId,
    remoteVersion: 1,
    remoteEntity: remote,
  });
  await f.repo.resolve(conflict.id, false, {
    ...f.ctx,
    commandId: randomUUID(),
  });
  expect(
    (await f.repo.get(f.need.storeId, f.membership.id))?.entity.strength,
  ).toBe(0.5);
  expect(await new OutboxRepository(f.tx).countActive(f.need.storeId)).toEqual({
    pending_count: 0,
    failed_count: 0,
  });
});
