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
import { commercialWeekPreparationId } from "@fl-copilot/commercial-core";
import type { CommercialWeekPreparation } from "@fl-copilot/sync-contracts";
import {
  CommercialPreparationRepository,
  applyCommercialPreparation,
} from "./week-preparation-repository";
import { applyCommercialChoice } from "./offer-choice-repository";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { OutboxRepository } from "../sync/outbox-repository";
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
  const f = await commercialChoiceFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-prep-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  await applyCommercialChoice(tx, f.storeId, f.choice);
  const plan: CommercialWeekPreparation = {
    id: await commercialWeekPreparationId(
      f.storeId,
      "2026-10-05",
      testChoiceDigest,
    ),
    storeId: f.storeId,
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    status: "DRAFT",
    tgCapacity: 1,
    offerRefs: [{ choiceId: f.choice.id, choiceVersion: 1 }],
    placements: [
      {
        id: randomUUID(),
        label: "TG entrée",
        theme: "Raisin",
        offerIds: [f.choice.id],
        sourceIdea: null,
      },
    ],
    note: "",
    version: 1,
    createdAt: f.choice.createdAt,
    updatedAt: f.choice.updatedAt,
  };
  return {
    f,
    plan,
    path,
    db,
    tx,
    repo: new CommercialPreparationRepository(tx, testChoiceDigest),
    deviceId: randomUUID(),
  };
}
describe("offline weekly preparation", () => {
  it("saves placements, audit and outbox atomically and restores them after restart", async () => {
    const x = await setup();
    await x.repo.save(x.plan, {
      commandId: randomUUID(),
      deviceId: x.deviceId,
    });
    expect(
      await new OutboxRepository(x.tx).listPending(x.f.storeId),
    ).toHaveLength(1);
    x.db.close();
    const db = new DatabaseSync(x.path);
    dbs.push(db);
    expect(
      (
        await new CommercialPreparationRepository(
          new Adapter(db),
          testChoiceDigest,
        ).get(x.f.storeId, x.plan.weekStart)
      )?.entity,
    ).toEqual(x.plan);
  });
  it("rolls back the draft when command persistence fails", async () => {
    const x = await setup();
    x.tx.fail = true;
    await expect(
      x.repo.save(x.plan, { commandId: randomUUID(), deviceId: x.deviceId }),
    ).rejects.toThrow("COMMIT_FAILED");
    expect(await x.repo.get(x.f.storeId, x.plan.weekStart)).toBeNull();
    expect(await new OutboxRepository(x.tx).listPending(x.f.storeId)).toEqual(
      [],
    );
  });
  it("rejects stale references but does not erase an already saved draft after a withdrawal", async () => {
    const x = await setup();
    await x.repo.save(x.plan, {
      commandId: randomUUID(),
      deviceId: x.deviceId,
    });
    await applyCommercialChoice(x.tx, x.f.storeId, {
      ...x.f.choice,
      status: "WITHDRAWN",
      version: 2,
    });
    await expect(
      x.repo.save(
        { ...x.plan, version: 2 },
        { commandId: randomUUID(), deviceId: x.deviceId },
      ),
    ).rejects.toThrow("OFFERS_CHANGED");
    expect((await x.repo.get(x.f.storeId, x.plan.weekStart))?.entity).toEqual(
      x.plan,
    );
  });
  it("preserves newer local edits during old acknowledgement and pull", async () => {
    const x = await setup();
    await x.repo.save(x.plan, {
      commandId: randomUUID(),
      deviceId: x.deviceId,
    });
    const newer = { ...x.plan, note: "Nouvelle préparation", version: 2 };
    await x.repo.save(newer, { commandId: randomUUID(), deviceId: x.deviceId });
    await applyCommercialPreparation(x.tx, x.f.storeId, x.plan, 1);
    expect((await x.repo.get(x.f.storeId, x.plan.weekStart))?.entity).toEqual(
      newer,
    );
    expect(
      await new OutboxRepository(x.tx).listPending(x.f.storeId),
    ).toHaveLength(1);
  });
  it("adopts a remote draft only after explicit conflict resolution and preserves local audit", async () => {
    const x = await setup(),
      commandId = randomUUID();
    await x.repo.save(x.plan, { commandId, deviceId: x.deviceId });
    const command = (
        await new OutboxRepository(x.tx).listPending(x.f.storeId)
      )[0]!,
      remote = {
        ...x.plan,
        note: "Autre appareil",
        createdAt: "2026-10-08T07:00:00.000Z",
      };
    await new ConflictRepository(x.tx).recordPushConflict(command, {
      commandId,
      status: "CONFLICT",
      entityType: command.entityType,
      entityId: command.entityId,
      remoteEntity: remote,
      remoteVersion: 1,
    });
    await x.tx.runAsync(
      "UPDATE commercial_week_preparations SET sync_state='CONFLICT'",
    );
    await x.tx.runAsync(
      "UPDATE commercial_week_preparations SET sync_state='CONFLICT' WHERE store_id=?",
      x.f.storeId,
    );
    const resolutionReview = await x.repo.review(x.f.storeId, commandId);
    await x.repo.resolve(commandId, false, {
      storeId: x.f.storeId,
      reviewHash: resolutionReview.hash,
      remoteHistoryId: randomUUID(),
      canResolve: () => true,
      retainWithdrawn: true,
      commandId: randomUUID(),
      deviceId: x.deviceId,
    });
    expect((await x.repo.get(x.f.storeId, x.plan.weekStart))?.entity).toEqual(
      remote,
    );
    expect(
      x.db
        .prepare("SELECT COUNT(*) AS n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 2 });
  });
});

import { restartCommercialPreparation } from "./restart-preparation";
import { commercialReviewFixture } from "../../../../scripts/test-commercial-processing-fixtures";
it("clears only the confirmed week's draft with prior audit, survives restart, and preserves choices/validated plans", async () => {
  const x = await setup();
  await x.repo.save(x.plan, { commandId: randomUUID(), deviceId: x.deviceId });
  const beforeChoices = x.db
    .prepare("SELECT * FROM commercial_offer_choices")
    .all();
  const context = {
    storeId: x.f.storeId,
    ownerId: randomUUID(),
    deviceId: x.deviceId,
    weekStart: x.plan.weekStart,
    canChange: () => true,
  };
  const cleared = await restartCommercialPreparation(
    x.tx,
    testChoiceDigest,
    randomUUID,
    { context, previous: x.plan, resetDraft: true },
  );
  expect(cleared).toMatchObject({
    version: 2,
    placements: [],
    offerRefs: [],
    tgCapacity: null,
    note: "",
    physicalAllocation: null,
  });
  expect(x.db.prepare("SELECT * FROM commercial_offer_choices").all()).toEqual(
    beforeChoices,
  );
  const baseline = x.db
    .prepare(
      "SELECT payload_json FROM commercial_preparation_history WHERE action='BEFORE_RESET'",
    )
    .get() as { payload_json: string };
  expect(JSON.parse(baseline.payload_json)).toEqual(x.plan);
  x.db.close();
  const reopened = new DatabaseSync(x.path);
  dbs.push(reopened);
  expect(
    (
      await new CommercialPreparationRepository(
        new Adapter(reopened),
        testChoiceDigest,
      ).get(x.f.storeId, x.plan.weekStart)
    )?.entity,
  ).toEqual(cleared);
});
it("rolls back the entire reset when analysis cannot be queued, authority changes, or the reviewed draft is stale", async () => {
  const x = await setup();
  await x.repo.save(x.plan, { commandId: randomUUID(), deviceId: x.deviceId });
  const context = {
    storeId: x.f.storeId,
    ownerId: randomUUID(),
    deviceId: x.deviceId,
    weekStart: x.plan.weekStart,
    canChange: () => true,
  };
  const reviewed = { ...commercialReviewFixture(), canRestart: true };
  const before = () => [
    x.db.prepare("SELECT * FROM commercial_week_preparations").all(),
    x.db.prepare("SELECT * FROM commercial_preparation_history").all(),
    x.db.prepare("SELECT * FROM sync_outbox").all(),
    x.db.prepare("SELECT * FROM local_jobs").all(),
  ];
  const original = before();
  await expect(
    restartCommercialPreparation(x.tx, testChoiceDigest, randomUUID, {
      context,
      previous: x.plan,
      resetDraft: true,
      analysis: reviewed,
    }),
  ).rejects.toThrow();
  expect(before()).toEqual(original);
  await expect(
    restartCommercialPreparation(x.tx, testChoiceDigest, randomUUID, {
      context,
      previous: { ...x.plan, version: 99 },
      resetDraft: true,
    }),
  ).rejects.toThrow("COMMERCIAL_RESTART_CHANGED");
  let checks = 0;
  await expect(
    restartCommercialPreparation(x.tx, testChoiceDigest, randomUUID, {
      context: { ...context, canChange: () => ++checks < 3 },
      previous: x.plan,
      resetDraft: true,
    }),
  ).rejects.toThrow("COMMERCIAL_RESTART_FORBIDDEN");
  expect(before()).toEqual(original);
});

import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { applyCommercialPlan } from "./week-plan-repository";
it("leaves an already validated plan, its revisions and materialized offers unchanged when clearing the working draft", async () => {
  const x = await setup(),
    f = await commercialPlanFixture();
  await applyCommercialChoice(x.tx, f.storeId, f.choice);
  await applyCommercialPreparation(x.tx, f.storeId, f.preparation);
  await applyCommercialPlan(x.tx, f.storeId, f.plan);
  const tables = [
    "commercial_week_plans",
    "commercial_plan_revisions",
    "commercial_offer_choices",
    "commercial_validated_offers",
    "offers",
    "commercial_operations",
    "action_executions",
  ];
  const snapshots = () =>
    tables.map((table) => x.db.prepare(`SELECT * FROM ${table}`).all());
  const before = snapshots();
  await restartCommercialPreparation(x.tx, testChoiceDigest, randomUUID, {
    context: {
      storeId: f.storeId,
      ownerId: randomUUID(),
      deviceId: x.deviceId,
      weekStart: f.preparation.weekStart,
      canChange: () => true,
    },
    previous: f.preparation,
    resetDraft: true,
  });
  expect(snapshots()).toEqual(before);
});
