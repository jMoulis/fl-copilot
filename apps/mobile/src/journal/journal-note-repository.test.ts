import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, it, expect } from "vitest";
import { prepareJournalNote, withdrawJournalNote } from "@fl-copilot/domain";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations, localMigrations } from "../db/migrations";
import { OutboxRepository } from "../sync/outbox-repository";
import {
  JournalNoteRepository,
  applyJournalNote,
} from "./journal-note-repository";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directories: string[] = [],
  dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const d of dbs.splice(0))
    try {
      d.close();
    } catch {
      /* database may already be closed for the restart proof */
    }
  for (const d of directories.splice(0))
    rmSync(d, { recursive: true, force: true });
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "journal-note-"));
  directories.push(dir);
  const path = join(dir, "notes.sqlite"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const adapter = new VisualTestDatabase(db);
  await runLocalMigrations(adapter);
  return {
    path,
    db,
    adapter,
    repo: new JournalNoteRepository(adapter),
    storeId: randomUUID(),
    capture: {
      id: randomUUID(),
      text: "Travaux devant l’entrée",
      startDate: "2026-11-12",
      endDate: "2026-11-15",
      capturedAt: "2026-11-13T08:00:00Z",
    },
    ctx: { commandId: randomUUID(), deviceId: randomUUID() },
  };
}
it("retains offline notes and one Outbox command across replay/reopen, with inclusive periods and store isolation", async () => {
  const f = await setup();
  await f.repo.create(f.storeId, f.capture, f.ctx);
  await f.repo.create(f.storeId, f.capture, {
    ...f.ctx,
    commandId: randomUUID(),
  });
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const adapter = new VisualTestDatabase(db),
    repo = new JournalNoteRepository(adapter);
  expect(
    (await repo.list(f.storeId, "2026-11-15")).rows[0]!.entity,
  ).toMatchObject({
    text: f.capture.text,
    capturedAt: "2026-11-13T08:00:00.000Z",
    startDate: "2026-11-12",
  });
  expect((await repo.list(f.storeId, "2026-11-16")).rows).toEqual([]);
  expect((await repo.list(randomUUID(), "2026-11-13")).rows).toEqual([]);
  expect(
    await new OutboxRepository(adapter).listPending(f.storeId),
  ).toHaveLength(1);
  expect(
    db.prepare("SELECT COUNT(*) n FROM store_journal_note_history").get()!.n,
  ).toBe(1);
});
it("keeps explicit withdrawals monotone through delayed acknowledgements and concurrent withdrawal times", async () => {
  const f = await setup(),
    note = await f.repo.create(f.storeId, f.capture, f.ctx);
  await f.repo.withdraw(f.storeId, note.id, {
    ...f.ctx,
    commandId: randomUUID(),
    capturedAt: "2026-11-13T09:00:00Z",
  });
  await applyJournalNote(f.adapter, f.storeId, note);
  expect((await f.repo.list(f.storeId, "2026-11-13")).rows).toEqual([]);
  expect(
    (await f.repo.list(f.storeId, "2026-11-13", null, true)).rows[0]!.syncState,
  ).toBe("PENDING");
  const remote = withdrawJournalNote(note, "2026-11-13T08:30:00Z");
  await applyJournalNote(f.adapter, f.storeId, remote);
  await applyJournalNote(f.adapter, f.storeId, note);
  const row = (await f.repo.list(f.storeId, "2026-11-13", null, true)).rows[0]!;
  expect(row.entity).toEqual(remote);
  expect(row.syncState).toBe("SYNCED");
  expect(
    f.db.prepare("SELECT remote_version FROM store_journal_notes").get()!
      .remote_version,
  ).toBe(2);
  expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(2);
  expect(
    await new OutboxRepository(f.adapter).listPending(f.storeId),
  ).toHaveLength(1);
});
it("rolls back original/history/Outbox on a changed scope and rejects rewritten/foreign captures", async () => {
  const f = await setup();
  let calls = 0;
  await expect(
    f.repo.create(f.storeId, f.capture, {
      ...f.ctx,
      assertCurrentScope: () => {
        if (++calls > 1) throw Error("SCOPE");
      },
    }),
  ).rejects.toThrow("SCOPE");
  expect((await f.repo.list(f.storeId, "2026-11-13")).rows).toEqual([]);
  expect(await new OutboxRepository(f.adapter).listPending(f.storeId)).toEqual(
    [],
  );
  const note = await f.repo.create(f.storeId, f.capture, f.ctx);
  await expect(
    f.repo.create(
      f.storeId,
      { ...f.capture, text: "Autre" },
      { ...f.ctx, commandId: randomUUID() },
    ),
  ).rejects.toThrow("IDENTITY");
  await expect(applyJournalNote(f.adapter, randomUUID(), note)).rejects.toThrow(
    "SCOPE",
  );
  await expect(
    f.repo.withdraw(randomUUID(), note.id, {
      ...f.ctx,
      capturedAt: "2026-11-13T10:00:00Z",
    }),
  ).rejects.toThrow("MISSING");
});
it("migrates an existing database without changing pending product work", async () => {
  const db = new DatabaseSync(":memory:");
  dbs.push(db);
  const adapter = new VisualTestDatabase(db);
  await runLocalMigrations(adapter, localMigrations.slice(0, 63));
  db.exec(
    "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at,sync_state,dirty,is_petit_prix) VALUES('p','s','Banane','FRUIT','BULK','KG','ACTIVE',1,'2026-11-13','2026-11-13','PENDING',1,1)",
  );
  const before = db.prepare("SELECT * FROM products").all();
  await runLocalMigrations(adapter);
  expect(db.prepare("SELECT * FROM products").all()).toEqual(before);
});
it("paginates date notes without losing rows and validates period/text before any write", async () => {
  const f = await setup();
  for (let i = 0; i < 29; i++)
    await f.repo.create(
      f.storeId,
      { ...f.capture, id: randomUUID() },
      { ...f.ctx, commandId: randomUUID() },
    );
  const one = await f.repo.list(f.storeId, "2026-11-13"),
    two = await f.repo.list(f.storeId, "2026-11-13", one.nextAfterId);
  expect(one.hasMore).toBe(true);
  expect(new Set([...one.rows, ...two.rows].map((r) => r.entity.id)).size).toBe(
    29,
  );
  expect(two.hasMore).toBe(false);
  expect(() =>
    prepareJournalNote(f.storeId, { ...f.capture, endDate: "2026-11-11" }),
  ).toThrow();
  expect(() =>
    prepareJournalNote(f.storeId, {
      ...f.capture,
      text: " ",
      startDate: "2026-02-30",
    }),
  ).toThrow();
});
