import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, expect } from "vitest";
import { commercialExecutionFixture } from "../../../../scripts/test-commercial-execution-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import { runLocalMigrations } from "../db/migrations";
import { applyCommercialPlan } from "./week-plan-repository";
import {
  CommercialExecutionRepository,
  applyCommercialExecution,
} from "./execution-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { applyPullPage } from "../sync/apply-pull-page";
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
  const f = await commercialExecutionFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-execution-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  await applyCommercialPlan(tx, f.storeId, f.plan);
  return {
    ...f,
    db,
    tx,
    path,
    repo: new CommercialExecutionRepository(tx, testChoiceDigest),
    ctx: { commandId: randomUUID(), deviceId: randomUUID() },
  };
}
it("commits a field declaration and its audit/outbox atomically, survives restart and leaves plan/offer/KPI projections unchanged", async () => {
  const x = await setup(),
    snapshot = () =>
      JSON.stringify(
        [
          "commercial_week_plans",
          "commercial_operations",
          "offers",
          "sales_observations",
          "waste_observations",
        ].map((t) => x.db.prepare(`SELECT * FROM ${t}`).all()),
      ),
    before = snapshot();
  await x.repo.save(x.task, x.ctx);
  expect(snapshot()).toBe(before);
  expect(await new OutboxRepository(x.tx).listPending(x.storeId)).toHaveLength(
    1,
  );
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM commercial_execution_history").get()
      ?.n,
  ).toBe(1);
  x.db.close();
  const db = new DatabaseSync(x.path);
  dbs.push(db);
  expect(
    (
      await new CommercialExecutionRepository(
        new Adapter(db),
        testChoiceDigest,
      ).get(x.storeId, x.task.id)
    )?.entity,
  ).toEqual(x.task);
});
it("rolls back on failure, rejects forged targets/stale revision and protects tenant boundaries", async () => {
  const x = await setup();
  x.tx.fail = true;
  await expect(x.repo.save(x.task, x.ctx)).rejects.toThrow("COMMIT_FAILED");
  expect(await x.repo.list(x.storeId, x.plan.revisionId)).toEqual([]);
  x.tx.fail = false;
  await expect(
    x.repo.save({ ...x.task, label: "different target" }, x.ctx),
  ).rejects.toThrow("PLAN_CHANGED");
  await x.repo.save(x.task, x.ctx);
  await expect(
    x.repo.save(x.task, { ...x.ctx, commandId: randomUUID() }),
  ).rejects.toThrow("REVISION_INVALID");
  expect(await x.repo.get(randomUUID(), x.task.id)).toBeNull();
});
it("serializes task corrections and preserves newer local notes/status after old acknowledgement and pull", async () => {
  const x = await setup();
  await x.repo.save(x.task, x.ctx);
  const next = {
    ...x.task,
    status: "TODO" as const,
    completedAt: null,
    note: "Correction : reste à imprimer",
    version: 2,
  };
  await x.repo.save(next, { ...x.ctx, commandId: randomUUID() });
  expect(await new OutboxRepository(x.tx).listPending(x.storeId)).toHaveLength(
    1,
  );
  await applyCommercialExecution(x.tx, x.storeId, x.task, 1);
  await applyCommercialExecution(x.tx, x.storeId, x.task);
  expect((await x.repo.get(x.storeId, x.task.id))?.entity).toEqual(next);
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM commercial_execution_history").get()
      ?.n,
  ).toBe(2);
});
it("keeps actual declarations against older confirmed revisions after the plan changes without resetting/carrying Done", async () => {
  const x = await setup();
  await x.repo.save(x.task, x.ctx);
  const p = await buildCommercialWeekPlan(
    {
      preparation: x.preparation,
      version: 2,
      createdAt: x.plan.createdAt,
      validatedAt: "2026-10-09T12:00:00.000Z",
    },
    x.context,
    testChoiceDigest,
  );
  await applyCommercialPlan(x.tx, x.storeId, p);
  await x.repo.save(
    { ...x.task, note: "Fait sur l’ancienne version", version: 2 },
    { ...x.ctx, commandId: randomUUID() },
  );
  expect((await x.repo.get(x.storeId, x.task.id))?.entity.status).toBe("DONE");
  expect(await x.repo.list(x.storeId, p.revisionId)).toEqual([]);
});
it("preserves field capture for a known local plan copy even if a different copy becomes confirmed", async () => {
  const x = await setup();
  const own = await buildCommercialWeekPlan(
    {
      preparation: x.preparation,
      version: 1,
      createdAt: x.plan.createdAt,
      validatedAt: "2026-10-09T12:00:00.000Z",
    },
    x.context,
    testChoiceDigest,
  );
  x.db
    .prepare(
      "INSERT INTO commercial_plan_history(action_id,plan_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      randomUUID(),
      own.id,
      x.storeId,
      JSON.stringify(own),
      "VALIDATE_PLAN",
      own.validatedAt,
    );
  const p = await import("@fl-copilot/commercial-core").then((m) =>
    m.commercialExecutionChecklist(own, testChoiceDigest),
  );
  const t = { ...x.task, ...p[0]!, note: "Déclaration d’un travail réel" };
  await x.repo.save(t, x.ctx);
  expect((await x.repo.get(x.storeId, t.id))?.entity.note).toBe(t.note);
});
it("explicitly adopts/rebases a two-device task conflict with no last-write-wins and retains superseded action history", async () => {
  const x = await setup();
  await x.repo.save(x.task, x.ctx);
  const cmd = (await new OutboxRepository(x.tx).listPending(x.storeId))[0]!,
    remote = {
      ...x.task,
      status: "SKIPPED" as const,
      completedAt: null,
      note: "Autre choix sur second appareil",
    };
  const conflict = await new ConflictRepository(x.tx).recordPushConflict(cmd, {
    commandId: cmd.commandId,
    status: "CONFLICT",
    entityType: cmd.entityType,
    entityId: cmd.entityId,
    remoteVersion: 1,
    remoteEntity: remote,
  });
  await x.repo.resolve(conflict.id, true, {
    ...x.ctx,
    commandId: randomUUID(),
  });
  const current = (await x.repo.get(x.storeId, x.task.id))!;
  expect(current.entity.status).toBe("DONE");
  expect(current.entity.version).toBe(2);
  expect(await new OutboxRepository(x.tx).listPending(x.storeId)).toHaveLength(
    1,
  );
  expect(await new OutboxRepository(x.tx).countActive(x.storeId)).toEqual({
    pending_count: 1,
    failed_count: 0,
  });
});
it("rejects malformed task envelopes atomically", async () => {
  const x = await setup();
  await expect(
    applyPullPage(x.tx, x.storeId, {
      changes: [
        {
          sequence: "1",
          entityType: "commercial_execution_task",
          entityId: randomUUID(),
          entityVersion: 1,
          operation: "UPSERT",
          entity: x.task,
          changedAt: x.task.updatedAt,
        },
      ],
      nextCursor: "bad",
      hasMore: false,
      serverTime: x.task.updatedAt,
    }),
  ).rejects.toThrow("ENVELOPE_INVALID");
  expect(await x.repo.list(x.storeId, x.plan.revisionId)).toEqual([]);
});
