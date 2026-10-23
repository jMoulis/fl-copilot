import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import {
  ActionsViewRepository,
  actionsViewSchema,
  initialActionsView,
} from "./actions-view";

const scope = {
  storeId: "11111111-1111-4111-8111-111111111111",
  ownerId: "22222222-2222-4222-8222-222222222222",
};
afterEach(() => vi.useRealTimers());

it("restores a private selection from a migrated on-disk database after restart, without business commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-actions-view-")),
    file = join(dir, "local.db");
  let db = new DatabaseSync(file);
  const adapter = {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, ...p: (string | number | null)[]) =>
      db.prepare(sql).run(...p),
    getFirstAsync: async <T>(sql: string, ...p: (string | number | null)[]) =>
      (db.prepare(sql).get(...p) as T) ?? null,
    getAllAsync: async <T>(sql: string, ...p: (string | number | null)[]) =>
      db.prepare(sql).all(...p) as T[],
  };
  try {
    await runLocalMigrations(adapter);
    const before = db.prepare("SELECT * FROM sync_outbox").all();
    const view = {
      ...initialActionsView("2025-12-31"),
      filter: "DONE" as const,
    };
    await new ActionsViewRepository(adapter, scope).save(view);
    db.close();
    db = new DatabaseSync(file);
    expect(await new ActionsViewRepository(adapter, scope).read()).toEqual(
      view,
    );
    for (const privateScope of [
      { ...scope, ownerId: scope.storeId },
      { ...scope, storeId: scope.ownerId },
    ])
      expect(
        await new ActionsViewRepository(adapter, privateScope).read(),
      ).toBeNull();
    expect(db.prepare("SELECT * FROM sync_outbox").all()).toEqual(before);
    for (const table of [
      "commercial_week_plans",
      "commercial_execution_tasks",
      "sales_observations",
      "waste_observations",
    ])
      expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n).toBe(0);
    db.prepare(
      "UPDATE app_metadata SET value='broken' WHERE key LIKE 'actions-view:%'",
    ).run();
    await expect(
      new ActionsViewRepository(adapter, scope).read(),
    ).rejects.toThrow();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("uses the store date across midnight and ISO years and accepts only real Monday weeks and task states", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T23:30:00Z"));
  expect(initialActionsView().weekStart).toBe("2026-10-26");
  expect(initialActionsView("2025-12-31").weekStart).toBe("2025-12-29");
  for (const filter of ["ALL", "TODO", "DONE", "SKIPPED", "NOT_APPLICABLE"])
    expect(
      actionsViewSchema.parse({ ...initialActionsView(), filter }).filter,
    ).toBe(filter);
  for (const invalid of [
    { weekStart: "2026-10-27" },
    { weekStart: "2026-02-30" },
    { filter: "EXECUTED" },
    { schemaVersion: 2 },
  ])
    expect(() =>
      actionsViewSchema.parse({ ...initialActionsView(), ...invalid }),
    ).toThrow();
});
