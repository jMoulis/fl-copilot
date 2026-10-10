import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect, afterEach } from "vitest";
import { evidenceFixture } from "../../../../scripts/test-evidence-fixtures";
import { buildDailySubstitutionEvidence } from "@fl-copilot/substitution-core";
import { runLocalMigrations } from "../db/migrations";
import { type OutboxDatabase } from "../sync/outbox-repository";
import {
  applySubstitutionEvidence,
  applySubstitutionEvidenceState,
  SubstitutionEvidenceRepository,
} from "./evidence-repository";
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

it("stores a read-only comparison across restart, skips older revisions and isolates store/identity without Outbox mutations", async () => {
  const f = await evidenceFixture(),
    e = await buildDailySubstitutionEvidence(f.input),
    dir = mkdtempSync(join(tmpdir(), "fl-evidence_"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  await applySubstitutionEvidence(tx, e.storeId, e);
  await applySubstitutionEvidenceState(tx, e.storeId, {
    id: e.eventId,
    eventId: e.eventId,
    storeId: e.storeId,
    status: "READY",
    reasons: [],
    evidenceIds: [e.id],
    version: 1,
    updatedAt: e.updatedAt,
  });
  db.close();
  const reopened = new DatabaseSync(path);
  dbs.push(reopened);
  const store = new Adapter(reopened),
    repo = new SubstitutionEvidenceRepository(store);
  expect(await repo.get(e.storeId, e.id)).toEqual(e);
  expect(await repo.get(randomUUID(), e.id)).toBeNull();
  await applySubstitutionEvidence(store, e.storeId, {
    ...e,
    version: 2,
    actualSalesValue: "120.00",
  });
  await applySubstitutionEvidence(store, e.storeId, e);
  expect((await repo.get(e.storeId, e.id))?.actualSalesValue).toBe("120.00");
  await expect(
    applySubstitutionEvidence(store, randomUUID(), e),
  ).rejects.toThrow("STORE_INVALID");
  await expect(
    applySubstitutionEvidence(store, e.storeId, {
      ...e,
      version: 3,
      eventId: randomUUID(),
    }),
  ).rejects.toThrow("IDENTITY_CHANGED");
  expect((await repo.states(e.storeId))[0]?.status).toBe("READY");
  expect(reopened.prepare("SELECT COUNT(*) n FROM sync_outbox").get()?.n).toBe(
    0,
  );
});
