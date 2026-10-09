import { needUnitSchema } from "@fl-copilot/sync-contracts";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, expect } from "vitest";
import { needUnitFixture } from "../../../../scripts/test-need-unit-fixtures";

import { NeedUnitRepository, applyNeedUnit } from "./repository";
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
  const settings = needUnitFixture(),
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
    repo: new NeedUnitRepository(tx),
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
    x.db.prepare("SELECT COUNT(*) n FROM need_unit_history").get()?.n,
  ).toBe(1);
  for (const t of ["commercial_week_plans", "products", "sales_observations"])
    expect(x.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()?.n).toBe(0);
  x.db.close();
  const db = new DatabaseSync(x.path);
  dbs.push(db);
  expect(
    (
      await new NeedUnitRepository(new Adapter(db)).get(
        x.settings.storeId,
        x.settings.id,
      )
    )?.entity,
  ).toEqual(x.settings);
});
it("rejects invalid codes and rolls back failure", async () => {
  const x = await setup();
  expect(
    needUnitSchema.safeParse({
      ...x.settings,
      code: "invalid code",
    }).success,
  ).toBe(false);
  expect(needUnitSchema.safeParse({ ...x.settings, name: "" }).success).toBe(
    false,
  );
  x.tx.fail = true;
  await expect(x.repo.save(x.settings, x.ctx)).rejects.toThrow("COMMIT_FAILED");
  expect(await x.repo.get(x.settings.storeId, x.settings.id)).toBeNull();
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM need_unit_history").get()?.n,
  ).toBe(0);
});
it("orders revisions and prevents an old acknowledgement/pull from overwriting a newer local description", async () => {
  const x = await setup();
  await x.repo.save(x.settings, x.ctx);
  const next = { ...x.settings, version: 2, name: "Apéritif à partager" };
  await x.repo.save(next, { ...x.ctx, commandId: randomUUID() });
  expect(
    await new OutboxRepository(x.tx).listPending(x.settings.storeId),
  ).toHaveLength(1);
  await applyNeedUnit(x.tx, x.settings.storeId, x.settings, 1);
  await applyNeedUnit(x.tx, x.settings.storeId, x.settings);
  expect((await x.repo.get(x.settings.storeId, x.settings.id))?.entity).toEqual(
    next,
  );
  expect(await x.repo.get(randomUUID(), x.settings.id)).toBeNull();
});
it("resolves different-device edits explicitly and preserves superseded actions", async () => {
  const x = await setup();
  await x.repo.save(x.settings, x.ctx);
  const cmd = (
      await new OutboxRepository(x.tx).listPending(x.settings.storeId)
    )[0]!,
    remote = { ...x.settings, name: "Apéritif convivial" };
  const conflict = await new ConflictRepository(x.tx).recordPushConflict(cmd, {
    commandId: cmd.commandId,
    status: "CONFLICT",
    entityType: cmd.entityType,
    entityId: cmd.entityId,
    remoteVersion: 1,
    remoteEntity: remote,
  });
  await x.repo.resolve(conflict.id, false, {
    ...x.ctx,
    commandId: randomUUID(),
  });
  expect(
    (await x.repo.get(x.settings.storeId, x.settings.id))?.entity.name,
  ).toBe("Apéritif convivial");
  expect(
    await new OutboxRepository(x.tx).countActive(x.settings.storeId),
  ).toEqual({ pending_count: 0, failed_count: 0 });
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM need_unit_history").get()?.n,
  ).toBe(2);
});

it("preserves an unconfirmed duplicate draft while restoring the confirmed catalogue, then repairs its code without changing UUID", async () => {
  const x = await setup(),
    remote = { ...x.settings, id: randomUUID(), name: "Besoin déjà confirmé" };
  await x.repo.save(x.settings, x.ctx);
  await x.tx.runAsync(
    "UPDATE need_units SET sync_state='ERROR' WHERE id=?",
    x.settings.id,
  );
  await applyNeedUnit(x.tx, x.settings.storeId, remote);
  expect(await x.repo.list(x.settings.storeId)).toHaveLength(2);
  const repaired = { ...x.settings, code: "APERITIF_PARTAGE", version: 1 };
  await x.repo.save(repaired, { ...x.ctx, commandId: randomUUID() });
  expect((await x.repo.get(repaired.storeId, repaired.id))?.entity.code).toBe(
    "APERITIF_PARTAGE",
  );
  await applyNeedUnit(x.tx, repaired.storeId, repaired, 1);
  await expect(
    x.repo.save(
      { ...repaired, code: "AUTRE", version: 2 },
      { ...x.ctx, commandId: randomUUID() },
    ),
  ).rejects.toThrow("NEED_UNIT_CODE_IMMUTABLE");
  await expect(
    x.repo.save(
      { ...remote, id: randomUUID() },
      { ...x.ctx, commandId: randomUUID() },
    ),
  ).rejects.toThrow("NEED_UNIT_CODE_IN_USE");
  expect((await x.repo.get(remote.storeId, remote.id))?.entity.name).toBe(
    "Besoin déjà confirmé",
  );
});
