import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { runLocalMigrations, localMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CopilotPriorityRepository } from "./priority-repository";
import {
  priorityFixture,
  priorityStoreId as storeId,
  priorityEvaluatedAt as evaluatedAt,
} from "../../../../scripts/test-copilot-priority-fixtures";
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

const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
it("upgrades schema 32, persists every score component across offline restart, isolates stores and deduplicates replay without Outbox", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-priority_")),
    path = join(dir, "test.db");
  let db = new DatabaseSync(path);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("NETWORK_DISABLED");
  };
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter, localMigrations.slice(0, 32));
    await runLocalMigrations(adapter);
    const input = {
      storeId,
      evaluatedAt,
      candidates: [priorityFixture("offline")],
    };
    const repo = new CopilotPriorityRepository(adapter, digest),
      saved = await repo.evaluate(input);
    expect(await repo.evaluate(input)).toEqual(saved);
    expect(
      db.prepare("SELECT count(*) AS n FROM copilot_priority_snapshots").get(),
    ).toMatchObject({ n: 1 });
    expect(
      db.prepare("SELECT count(*) AS n FROM sync_outbox").get(),
    ).toMatchObject({ n: 0 });
    db.close();
    db = new DatabaseSync(path);
    const restored = new CopilotPriorityRepository(new Adapter(db), digest);
    expect(await restored.read(storeId, saved.id)).toEqual(saved.batch);
    expect(
      await restored.read("00000000-0000-4000-8000-000000000002", saved.id),
    ).toBeNull();
    const updated = await restored.evaluate({
      ...input,
      candidates: [{ ...input.candidates[0]!, economicImpactScore: 0.9 }],
    });
    expect(updated.id).not.toBe(saved.id);
    expect(await restored.read(storeId, saved.id)).toEqual(saved.batch);
  } finally {
    globalThis.fetch = oldFetch;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rolls back failed audit writes and refuses hash collision/divergent immutable payloads", async () => {
  const db = new DatabaseSync(":memory:"),
    adapter = new Adapter(db);
  try {
    await runLocalMigrations(adapter);
    const input = {
      storeId,
      evaluatedAt,
      candidates: [priorityFixture("rollback")],
    };
    adapter.fail = true;
    await expect(
      new CopilotPriorityRepository(adapter, digest).evaluate(input),
    ).rejects.toThrow("COMMIT_FAILED");
    expect(
      db.prepare("SELECT count(*) AS n FROM copilot_priority_snapshots").get(),
    ).toMatchObject({ n: 0 });
    adapter.fail = false;
    const collision = new CopilotPriorityRepository(adapter, async () =>
      "a".repeat(64),
    );
    await collision.evaluate(input);
    await expect(
      collision.evaluate({
        ...input,
        candidates: [{ ...input.candidates[0]!, economicImpactScore: 0.9 }],
      }),
    ).rejects.toThrow("IMMUTABLE");
    expect(
      db.prepare("SELECT count(*) AS n FROM copilot_priority_snapshots").get(),
    ).toMatchObject({ n: 1 });
  } finally {
    db.close();
  }
});
