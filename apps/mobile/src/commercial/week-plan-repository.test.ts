import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, expect } from "vitest";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import { runLocalMigrations } from "../db/migrations";
import { ProductMasterRepository } from "../products/product-master-repository";
import { applyCommercialVisualReading } from "./visual-repository";
import { applyCommercialChoice } from "./offer-choice-repository";
import { applyCommercialPreparation } from "./week-preparation-repository";
import { applyValidatedOffer } from "./validated-offer-repository";
import {
  CommercialPlanRepository,
  applyCommercialPlan,
  applyCommercialPlanRevision,
  readCommercialPlanRevisions,
} from "./week-plan-repository";
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
  const f = await commercialPlanFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-week-plan-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  await new ProductMasterRepository(tx).upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: randomUUID(),
  });
  db.exec("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
  await applyCommercialVisualReading(tx, f.storeId, f.reading);
  await applyCommercialChoice(tx, f.storeId, f.choice);
  await applyCommercialPreparation(tx, f.storeId, f.preparation);
  await applyValidatedOffer(tx, f.storeId, f.validated);
  return {
    ...f,
    db,
    tx,
    path,
    repo: new CommercialPlanRepository(tx, testChoiceDigest),
    ctx: { commandId: randomUUID(), deviceId: randomUUID() },
  };
}
it("commits a validated local plan, canonical projections, audit and Outbox atomically and preserves draft/source/KPIs through restart", async () => {
  const x = await setup(),
    snapshot = () =>
      JSON.stringify(
        [
          "commercial_week_preparations",
          "commercial_offer_choices",
          "commercial_visual_readings",
          "sales_observations",
          "waste_observations",
        ].map((t) => x.db.prepare(`SELECT * FROM ${t}`).all()),
      ),
    before = snapshot();
  await x.repo.save(x.plan, x.ctx);
  expect(snapshot()).toBe(before);
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM commercial_operations").get()?.n,
  ).toBe(1);
  expect(x.db.prepare("SELECT COUNT(*) n FROM offers").get()?.n).toBe(1);
  expect(await new OutboxRepository(x.tx).listPending(x.storeId)).toHaveLength(
    1,
  );
  x.db.close();
  const db = new DatabaseSync(x.path);
  dbs.push(db);
  expect(
    (
      await new CommercialPlanRepository(new Adapter(db), testChoiceDigest).get(
        x.storeId,
        x.plan.weekStart,
      )
    )?.entity,
  ).toEqual(x.plan);
});
it("rolls back canonical projections, plan audit and Outbox on failure or changed source data", async () => {
  const x = await setup();
  x.tx.fail = true;
  await expect(x.repo.save(x.plan, x.ctx)).rejects.toThrow("COMMIT_FAILED");
  for (const t of [
    "commercial_week_plans",
    "commercial_operations",
    "offers",
    "commercial_plan_history",
  ])
    expect(x.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()?.n).toBe(0);
  x.tx.fail = false;
  x.db.prepare("UPDATE products SET version=2 WHERE id=?").run(x.productId);
  await expect(x.repo.save(x.plan, x.ctx)).rejects.toThrow("DATA_CHANGED");
});
it("preserves newer pending plan/child projections after an old ACK and restores immutable confirmed revisions", async () => {
  const x = await setup();
  await x.repo.save(x.plan, x.ctx);
  const prep = { ...x.preparation, note: "later draft", version: 2 };
  await applyCommercialPreparation(x.tx, x.storeId, prep);
  const p = await buildCommercialWeekPlan(
    {
      preparation: prep,
      version: 2,
      createdAt: x.plan.createdAt,
      validatedAt: "2026-10-08T13:00:00.000Z",
    },
    { ...x.context, preparation: prep },
    testChoiceDigest,
  );
  await x.repo.save(p, { ...x.ctx, commandId: randomUUID() });
  await applyCommercialPlan(x.tx, x.storeId, x.plan, 1);
  await applyCommercialPlan(x.tx, x.storeId, x.plan);
  expect((await x.repo.get(x.storeId, x.plan.weekStart))?.entity).toEqual(p);
  expect(
    JSON.parse(
      String(
        x.db.prepare("SELECT payload_json FROM offers").get()?.payload_json,
      ),
    ).version,
  ).toBe(2);
  expect(
    await readCommercialPlanRevisions(x.tx, x.storeId, x.plan.id),
  ).toHaveLength(1);
  await applyCommercialPlanRevision(x.tx, x.storeId, {
    id: p.revisionId,
    storeId: x.storeId,
    plan: p,
    version: 1,
  });
  expect(
    await readCommercialPlanRevisions(x.tx, x.storeId, x.plan.id),
  ).toHaveLength(2);
  await expect(
    applyCommercialPlanRevision(x.tx, x.storeId, {
      id: p.revisionId,
      storeId: x.storeId,
      plan: {
        ...p,
        groupingConfirmed: true,
        productRefs: p.productRefs.map((r) => ({
          ...r,
          label: "Changed label",
        })),
      },
      version: 1,
    }),
  ).rejects.toThrow("IMMUTABLE");
});
it("adopts or explicitly rebases a two-device plan conflict while retaining superseded local actions and canonical relations", async () => {
  const x = await setup();
  await x.repo.save(x.plan, x.ctx);
  const cmd = (await new OutboxRepository(x.tx).listPending(x.storeId))[0]!,
    remote = await buildCommercialWeekPlan(
      {
        preparation: x.preparation,
        version: 1,
        createdAt: x.plan.createdAt,
        validatedAt: "2026-10-08T14:00:00.000Z",
      },
      x.context,
      testChoiceDigest,
    );
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
  expect((await x.repo.get(x.storeId, x.plan.weekStart))?.entity).toEqual(
    remote,
  );
  expect(await new OutboxRepository(x.tx).countActive(x.storeId)).toEqual({
    pending_count: 0,
    failed_count: 0,
  });
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM commercial_plan_history").get()?.n,
  ).toBe(2);
});
it("rejects forged canonical prices and malformed root/revision envelopes without advancing cursor", async () => {
  const x = await setup();
  const fake = {
    ...x.plan,
    offers: x.plan.offers.map((o) => ({
      ...o,
      customerMechanism: {
        type: "FIXED_PRICE" as const,
        currency: "EUR" as const,
        unit: "KG" as const,
        amount: 99,
      },
    })),
  };
  await expect(x.repo.save(fake, x.ctx)).rejects.toThrow("DATA_CHANGED");
  await expect(
    applyPullPage(x.tx, x.storeId, {
      changes: [
        {
          sequence: "1",
          entityType: "commercial_week_plan",
          entityId: randomUUID(),
          entityVersion: 1,
          operation: "UPSERT",
          entity: x.plan,
          changedAt: x.plan.validatedAt,
        },
      ],
      nextCursor: "bad",
      hasMore: false,
      serverTime: x.plan.validatedAt,
    }),
  ).rejects.toThrow("ENVELOPE_INVALID");
  expect(await x.repo.get(x.storeId, x.plan.weekStart)).toBeNull();
});

it("explicit local rebase rechecks dependencies, regenerates revision IDs and unblocks the next plan command", async () => {
  const x = await setup();
  await x.repo.save(x.plan, x.ctx);
  const cmd = (await new OutboxRepository(x.tx).listPending(x.storeId))[0]!,
    remote = await buildCommercialWeekPlan(
      {
        preparation: x.preparation,
        version: 1,
        createdAt: x.plan.createdAt,
        validatedAt: "2026-10-08T14:00:00.000Z",
      },
      x.context,
      testChoiceDigest,
    );
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
  const plan = (await x.repo.get(x.storeId, x.plan.weekStart))!.entity;
  expect(plan.version).toBe(2);
  expect(plan.revisionId).not.toBe(x.plan.revisionId);
  expect(await new OutboxRepository(x.tx).listPending(x.storeId)).toHaveLength(
    1,
  );
  expect(await new OutboxRepository(x.tx).countActive(x.storeId)).toEqual({
    pending_count: 1,
    failed_count: 0,
  });
  expect(
    JSON.parse(
      String(
        x.db.prepare("SELECT payload_json FROM offers").get()?.payload_json,
      ),
    ).version,
  ).toBe(2);
});
