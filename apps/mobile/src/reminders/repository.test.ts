import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { reminderFixture } from "../../../../scripts/test-reminder-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { runLocalMigrations } from "../db/migrations";
import { ReminderRepository } from "./repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
class Adapter {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: (string | number | null)[]) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: (string | number | null)[]) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: (string | number | null)[]) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    fn: (t: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await fn(this);
      if (this.fail) throw Error("COMMIT_FAILED");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
it("persists device intent and audit before OS writes, rolls back failed capture and never creates a business Outbox command", async () => {
  const f = await reminderFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-reminder_")),
    file = join(dir, "local.db");
  let db = new DatabaseSync(file);
  try {
    let a = new Adapter(db);
    await runLocalMigrations(a);
    db.prepare(
      "INSERT INTO commercial_week_plans(id,store_id,week_start,payload_json,sync_state,dirty) VALUES(?,?,?,?,'SYNCED',0)",
    ).run(f.plan.id, f.plan.storeId, f.plan.weekStart, JSON.stringify(f.plan));
    let repo = new ReminderRepository(a, testChoiceDigest);
    expect(await repo.preferences(f.plan.storeId)).toBe(false);
    await repo.setEnabled(
      f.plan.storeId,
      true,
      randomUUID(),
      f.plan.validatedAt,
    );
    a.fail = true;
    await expect(repo.save(f.reminder, randomUUID())).rejects.toThrow(
      "COMMIT_FAILED",
    );
    expect(await repo.list(f.plan.storeId)).toEqual([]);
    a.fail = false;
    await repo.save(f.reminder, randomUUID());
    db.close();
    db = new DatabaseSync(file);
    a = new Adapter(db);
    repo = new ReminderRepository(a, testChoiceDigest);
    expect(await repo.preferences(f.plan.storeId)).toBe(true);
    expect((await repo.list(f.plan.storeId))[0]?.reminder).toEqual(f.reminder);
    await expect(
      repo.save(
        { ...f.reminder, version: 2, planChecksum: "a".repeat(64) },
        randomUUID(),
      ),
    ).rejects.toThrow("Le plan a changé");
    await repo.save(
      { ...f.reminder, enabled: false, version: 2 },
      randomUUID(),
    );
    await repo.setStatus(f.reminder, "SCHEDULED", "obsolete-os-id");
    expect((await repo.list(f.plan.storeId))[0]?.status).toBe("PENDING");
    expect((await repo.list(f.plan.storeId))[0]?.reminder.enabled).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual({
      n: 0,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM device_reminder_history").get(),
    ).toEqual({ n: 3 });
    expect(
      db.prepare("SELECT payload_json FROM commercial_week_plans").get(),
    ).toEqual({ payload_json: JSON.stringify(f.plan) });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
