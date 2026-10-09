import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, it, expect } from "vitest";
import {
  substitutionFixture,
  substitutionDigest,
} from "../../../../scripts/test-substitution-fixtures";
import {
  ProductSubstitutionRepository,
  applyProductSubstitution,
} from "./substitution-repository";
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
  const f = await substitutionFixture(),
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
  await tx.runAsync(
    "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at) VALUES(?,?,?,'UNKNOWN','UNKNOWN','UNKNOWN','ACTIVE',1,?,?)",
    f.substitute.id,
    f.need.storeId,
    f.substitute.label,
    f.substitute.createdAt,
    f.substitute.updatedAt,
  );
  return {
    ...f,
    db,
    tx,
    path,
    repo: new ProductSubstitutionRepository(tx, substitutionDigest),
    ctx: { commandId: randomUUID(), deviceId: randomUUID() },
  };
}
it("stores association/history/Outbox atomically, persists restart and leaves product facts unchanged", async () => {
  const f = await setup();
  await f.repo.save(f.substitution, f.ctx);
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const repo = new ProductSubstitutionRepository(
    new Adapter(db),
    substitutionDigest,
  );
  expect((await repo.get(f.need.storeId, f.substitution.id))?.entity).toEqual(
    f.substitution,
  );
  expect(
    db.prepare("SELECT COUNT(*) n FROM product_substitution_history").get()?.n,
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
    bad = {
      ...f.substitution,
      id: randomUUID(),
      sourceProductId: randomUUID(),
    };
  f.tx.fail = true;
  await expect(f.repo.save(f.substitution, f.ctx)).rejects.toThrow(
    "COMMIT_FAILED",
  );
  expect(await f.repo.list(f.need.storeId)).toEqual([]);
  f.tx.fail = false;
  await expect(
    f.repo.saveBatch([f.substitution, bad], {
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
  await f.repo.save(f.substitution, f.ctx);
  const next = {
    ...f.substitution,
    version: 2,
    needCompatibility: 0.4,
    usageCompatibility: 0.9,
  };
  await f.repo.save(next, { ...f.ctx, commandId: randomUUID() });
  expect(
    await new OutboxRepository(f.tx).listPending(f.need.storeId),
  ).toHaveLength(1);
  await applyProductSubstitution(f.tx, f.need.storeId, f.substitution, 1);
  await applyProductSubstitution(f.tx, f.need.storeId, f.substitution);
  expect((await f.repo.get(f.need.storeId, f.substitution.id))?.entity).toEqual(
    next,
  );
  await f.repo.save(
    { ...next, version: 3, status: "REJECTED", humanConfirmed: true },
    { ...f.ctx, commandId: randomUUID() },
  );
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM product_substitution_history").get()
      ?.n,
  ).toBe(3);
});
it("requires explicit conflict adoption and preserves superseded local actions", async () => {
  const f = await setup();
  await f.repo.save(f.substitution, f.ctx);
  const cmd = (
      await new OutboxRepository(f.tx).listPending(f.need.storeId)
    )[0]!,
    remote = { ...f.substitution, needCompatibility: 0.5 };
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
    (await f.repo.get(f.need.storeId, f.substitution.id))?.entity
      .needCompatibility,
  ).toBe(0.5);
  expect(await new OutboxRepository(f.tx).countActive(f.need.storeId)).toEqual({
    pending_count: 0,
    failed_count: 0,
  });
});
it("stores both directions independently and rejects duplicate logical edges and user-authored evidence", async () => {
  const f = await setup();
  await f.repo.save(f.substitution, f.ctx);
  const { productSubstitutionId } = await import("@fl-copilot/domain");
  const reverse = {
    ...f.substitution,
    id: await productSubstitutionId(
      f.need.storeId,
      f.substitute.id,
      f.product.id,
      f.need.id,
      substitutionDigest,
    ),
    sourceProductId: f.substitute.id,
    substituteProductId: f.product.id,
    needCompatibility: 0.3,
  };
  await f.repo.save(reverse, { ...f.ctx, commandId: randomUUID() });
  expect(await f.repo.list(f.need.storeId)).toHaveLength(2);
  expect(
    (await f.repo.get(f.need.storeId, f.substitution.id))?.entity
      .needCompatibility,
  ).toBe(0.8);
  expect(() =>
    f.db
      .prepare(
        "INSERT INTO product_substitutions SELECT ?,store_id,source_product_id,substitute_product_id,need_unit_id,payload_json,remote_payload_json,remote_version,sync_state,dirty FROM product_substitutions WHERE id=?",
      )
      .run(randomUUID(), f.substitution.id),
  ).toThrow();
  await expect(
    f.repo.save(
      {
        ...f.substitution,
        version: 2,
        relationshipScore: 0.9,
        confidence: 0.9,
        observedSubstitution: 0.9,
        evidenceCount: 1,
        lastEvidenceAt: f.substitution.updatedAt,
      },
      { ...f.ctx, commandId: randomUUID() },
    ),
  ).rejects.toThrow("LEARNING_READ_ONLY");
  expect(
    (await f.repo.get(f.need.storeId, f.substitution.id))?.entity.evidenceCount,
  ).toBe(0);
});
