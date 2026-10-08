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
    await x.repo.resolve(commandId, false, {
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
