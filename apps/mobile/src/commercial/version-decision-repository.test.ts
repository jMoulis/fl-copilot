import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, expect } from "vitest";
import { commercialVersionFixture } from "../../../../scripts/test-commercial-version-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import {
  CommercialVersionDecisionRepository,
  applyCommercialVersionDecision,
} from "./version-decision-repository";
import { applyCommercialVisualReading } from "./visual-repository";
import { runLocalMigrations } from "../db/migrations";
import { applyPullPage } from "../sync/apply-pull-page";
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
  const x = await commercialVersionFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-version-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  await applyCommercialVisualReading(tx, x.f.storeId, x.f.reading);
  await applyCommercialVisualReading(tx, x.f.storeId, x.g.reading);
  return {
    ...x,
    db,
    tx,
    path,
    repo: new CommercialVersionDecisionRepository(tx, testChoiceDigest),
    ctx: { commandId: randomUUID(), deviceId: randomUUID() },
  };
}
it("keeps a reference choice through restart with atomic audit/outbox, without altering sources or commercial choices", async () => {
  const x = await setup();
  const source = x.db
    .prepare("SELECT * FROM commercial_visual_readings ORDER BY id")
    .all();
  await x.repo.save(x.decision, x.ctx);
  expect(x.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()?.n).toBe(1);
  expect(
    x.db
      .prepare("SELECT COUNT(*) n FROM commercial_version_decision_history")
      .get()?.n,
  ).toBe(1);
  expect(
    x.db.prepare("SELECT * FROM commercial_visual_readings ORDER BY id").all(),
  ).toEqual(source);
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM commercial_offer_choices").get()?.n,
  ).toBe(0);
  expect(
    x.db.prepare("SELECT COUNT(*) n FROM commercial_week_preparations").get()
      ?.n,
  ).toBe(0);
  x.db.close();
  const reopened = new DatabaseSync(x.path);
  dbs.push(reopened);
  const restored = await new CommercialVersionDecisionRepository(
    new Adapter(reopened),
    testChoiceDigest,
  ).get(x.f.storeId, x.f.sourceDocumentId, x.g.sourceDocumentId);
  expect(restored?.entity).toEqual(x.decision);
  expect(restored?.syncState).toBe("PENDING");
});
it("rolls back decision, audit and Outbox on failure", async () => {
  const x = await setup();
  x.tx.fail = true;
  await expect(x.repo.save(x.decision, x.ctx)).rejects.toThrow("COMMIT_FAILED");
  for (const table of [
    "commercial_version_decisions",
    "commercial_version_decision_history",
    "sync_outbox",
  ])
    expect(x.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n).toBe(0);
});
it("rejects incomplete/forged sources and stale or inverted revisions", async () => {
  const x = await setup();
  await expect(
    x.repo.save(
      { ...x.decision, after: { ...x.decision.after, checksum: "forged" } },
      x.ctx,
    ),
  ).rejects.toThrow("SOURCE_INVALID");
  await x.repo.save(x.decision, x.ctx);
  await expect(
    x.repo.save(x.decision, { ...x.ctx, commandId: randomUUID() }),
  ).rejects.toThrow("REVISION_INVALID");
  expect(
    await x.repo.get(randomUUID(), x.f.sourceDocumentId, x.g.sourceDocumentId),
  ).toBeNull();
  await expect(
    x.repo.save(
      {
        ...x.decision,
        before: x.decision.after,
        after: x.decision.before,
        version: 2,
      },
      { ...x.ctx, commandId: randomUUID() },
    ),
  ).rejects.toThrow("REVISION_INVALID");
});
it("serializes revisions and preserves newer local preference after old ACK and pull", async () => {
  const x = await setup();
  await x.repo.save(x.decision, x.ctx);
  const next = { ...x.decision, version: 2, preference: "PREFER_NEW" as const };
  await x.repo.save(next, { ...x.ctx, commandId: randomUUID() });
  expect(
    await new OutboxRepository(x.tx).listPending(x.f.storeId),
  ).toHaveLength(1);
  await applyCommercialVersionDecision(x.tx, x.f.storeId, x.decision, 1);
  await applyCommercialVersionDecision(x.tx, x.f.storeId, x.decision);
  expect(
    (await x.repo.get(x.f.storeId, x.f.sourceDocumentId, x.g.sourceDocumentId))
      ?.entity,
  ).toEqual(next);
});
it("rejects malformed pull envelope atomically without advancing cursor", async () => {
  const x = await setup();
  await expect(
    applyPullPage(x.tx, x.f.storeId, {
      changes: [
        {
          sequence: "1",
          entityType: "commercial_version_decision",
          entityId: randomUUID(),
          operation: "UPSERT",
          entityVersion: 1,
          entity: x.decision,
          changedAt: x.decision.createdAt,
        },
      ],
      nextCursor: "bad",
      hasMore: false,
      serverTime: x.decision.createdAt,
    }),
  ).rejects.toThrow("ENVELOPE_INVALID");
  expect(
    x.db
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`sync-cursor:${x.f.storeId}`),
  ).toBeUndefined();
});
it("compares and explicitly adopts a different-device choice while preserving the queued decision in audit", async () => {
  const x = await setup();
  await x.repo.save(x.decision, x.ctx);
  const command = (
    await new OutboxRepository(x.tx).listPending(x.f.storeId)
  )[0]!;
  const remote = { ...x.decision, preference: "PREFER_NEW" as const };
  const conflicts = new ConflictRepository(x.tx);
  await conflicts.recordPushConflict(command, {
    commandId: command.commandId,
    status: "CONFLICT",
    entityType: command.entityType,
    entityId: command.entityId,
    remoteVersion: 1,
    remoteEntity: remote,
  });
  const conflict = (await conflicts.listOpen(x.f.storeId))[0]!;
  await x.repo.resolve(conflict.id, false, {
    ...x.ctx,
    commandId: randomUUID(),
  });
  expect(
    (await x.repo.get(x.f.storeId, x.f.sourceDocumentId, x.g.sourceDocumentId))
      ?.entity.preference,
  ).toBe("PREFER_NEW");
  expect(
    x.db
      .prepare("SELECT last_error_code FROM sync_outbox WHERE command_id=?")
      .get(command.commandId)?.last_error_code,
  ).toBe("COMMERCIAL_VERSION_DECISION_SUPERSEDED");
  expect(
    x.db
      .prepare("SELECT COUNT(*) n FROM commercial_version_decision_history")
      .get()?.n,
  ).toBe(2);
});

it("rebases an opposite-orientation device conflict explicitly without changing the preferred original or blocking the next command", async () => {
  const x = await setup();
  await x.repo.save(x.decision, x.ctx);
  const command = (
    await new OutboxRepository(x.tx).listPending(x.f.storeId)
  )[0]!;
  const remote = {
    ...x.decision,
    before: x.decision.after,
    after: x.decision.before,
  };
  await applyCommercialVersionDecision(x.tx, x.f.storeId, remote);
  expect(
    (await x.repo.get(x.f.storeId, x.f.sourceDocumentId, x.g.sourceDocumentId))
      ?.entity.before.documentId,
  ).toBe(x.decision.before.documentId);
  const conflict = await new ConflictRepository(x.tx).recordPushConflict(
    command,
    {
      commandId: command.commandId,
      status: "CONFLICT",
      entityType: command.entityType,
      entityId: command.entityId,
      remoteVersion: 1,
      remoteEntity: remote,
    },
  );
  await x.repo.resolve(conflict.id, true, {
    ...x.ctx,
    commandId: randomUUID(),
  });
  const saved = (await x.repo.get(
    x.f.storeId,
    x.f.sourceDocumentId,
    x.g.sourceDocumentId,
  ))!.entity;
  expect(saved.before).toEqual(remote.before);
  expect(saved.preference).toBe("PREFER_NEW");
  expect(saved.after.documentId).toBe(x.decision.before.documentId);
  expect(saved.version).toBe(2);
  expect(
    await new OutboxRepository(x.tx).listPending(x.f.storeId),
  ).toHaveLength(1);
});
