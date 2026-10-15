import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MercalysTestDatabase } from "../../../../scripts/test-mercalys-sync-fixtures";
import { runLocalMigrations } from "../db/migrations";
import {
  CopilotKnowledgeRepository,
  applyKnowledgeRecord,
} from "./knowledge-repository";
import {
  copilotKnowledgeSchema,
  type CopilotKnowledge,
} from "@fl-copilot/domain";
const scope = () => ({ storeId: randomUUID(), ownerId: randomUUID() });
const record = (s: ReturnType<typeof scope>): CopilotKnowledge => ({
  id: randomUUID(),
  ...s,
  scope: "USER_STORE",
  kind: "OPERATING_PRACTICE",
  statement: "La casse est enregistrée à la date de saisie.",
  status: "ACTIVE",
  sourceMessageId: null,
  confirmedBy: s.ownerId,
  version: 1,
  createdAt: "2026-10-15T12:00:00Z",
  updatedAt: "2026-10-15T12:00:00Z",
});
const command = () => ({ commandId: randomUUID(), deviceId: randomUUID() });
it("saves knowledge and its Outbox atomically, reopens it offline, rejects stale/foreign edits and forgets explicitly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-memory-")),
    path = join(dir, "device.db"),
    s = scope(),
    e = record(s);
  let db = new MercalysTestDatabase(new DatabaseSync(path));
  try {
    await runLocalMigrations(db);
    let repo = new CopilotKnowledgeRepository(db, s);
    await repo.save(e, command());
    expect((await repo.list())[0]?.entity).toEqual(e);
    expect(
      await db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='copilot_knowledge'",
      ),
    ).toEqual({ n: 1 });
    db.db.close();
    db = new MercalysTestDatabase(new DatabaseSync(path));
    repo = new CopilotKnowledgeRepository(db, s);
    expect((await repo.list())[0]?.syncState).toBe("PENDING");
    await expect(
      repo.save({ ...e, statement: "Stale" }, command()),
    ).rejects.toThrow("REVISION");
    await expect(
      new CopilotKnowledgeRepository(db, scope()).save(e, command()),
    ).rejects.toThrow("SCOPE");
    await repo.save(
      { ...e, version: 2, statement: "Oublié", status: "FORGOTTEN" },
      command(),
    );
    expect((await repo.list())[0]?.entity.status).toBe("FORGOTTEN");
    expect(() =>
      copilotKnowledgeSchema.parse({ ...e, status: "FORGOTTEN" }),
    ).toThrow();
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("preserves newer local changes on pull and acknowledges only the corresponding revision", async () => {
  const db = new MercalysTestDatabase(),
    s = scope(),
    e = record(s);
  try {
    await runLocalMigrations(db);
    const repo = new CopilotKnowledgeRepository(db, s);
    await repo.save(e, command());
    const second = { ...e, version: 2, statement: "Saisie différée confirmée" };
    await repo.save(second, command());
    await applyKnowledgeRecord(db, s, e, 1);
    expect((await repo.list())[0]).toMatchObject({
      entity: second,
      syncState: "PENDING",
      remote: e,
    });
    await applyKnowledgeRecord(db, s, second, 2);
    expect((await repo.list())[0]).toMatchObject({
      entity: second,
      syncState: "SYNCED",
    });
    await expect(applyKnowledgeRecord(db, scope(), e)).rejects.toThrow("SCOPE");
  } finally {
    db.db.close();
  }
});
it("rolls back a failed Outbox enqueue without leaving an unqueued practice", async () => {
  const db = new MercalysTestDatabase(),
    s = scope(),
    e = record(s);
  try {
    await runLocalMigrations(db);
    await db.execAsync(
      "CREATE TRIGGER fail_memory_command BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'FAIL'); END",
    );
    await expect(
      new CopilotKnowledgeRepository(db, s).save(e, command()),
    ).rejects.toThrow();
    expect(await new CopilotKnowledgeRepository(db, s).list()).toEqual([]);
  } finally {
    db.db.close();
  }
});
it("keeps conflicting versions for human choice and can adopt the synchronized version", async () => {
  const db = new MercalysTestDatabase(),
    s = scope(),
    e = record(s);
  try {
    await runLocalMigrations(db);
    const repo = new CopilotKnowledgeRepository(db, s);
    await repo.save(e, command());
    const remote = {
      ...e,
      version: 2,
      statement: "Version d’un autre appareil",
    };
    await applyKnowledgeRecord(db, s, remote);
    await db.runAsync(
      "UPDATE copilot_knowledge SET sync_state='CONFLICT' WHERE id=?",
      e.id,
    );
    await expect(repo.save({ ...e, version: 2 }, command())).rejects.toThrow(
      "REVIEW",
    );
    await repo.resolve(e.id, false, command());
    expect((await repo.list())[0]).toMatchObject({
      entity: remote,
      syncState: "SYNCED",
    });
  } finally {
    db.db.close();
  }
});
it("requires an owned user message as provenance only at creation, while restored practices remain editable", async () => {
  const db = new MercalysTestDatabase(),
    s = scope(),
    e = record(s);
  try {
    await runLocalMigrations(db);
    const repo = new CopilotKnowledgeRepository(db, s);
    await expect(
      repo.save({ ...e, sourceMessageId: randomUUID() }, command()),
    ).rejects.toThrow("SOURCE");
    const restored = { ...e, sourceMessageId: randomUUID() };
    await applyKnowledgeRecord(db, s, restored);
    await repo.save(
      { ...restored, version: 2, statement: "Pratique corrigée explicitement" },
      command(),
    );
    expect((await repo.list())[0]?.entity.statement).toContain("corrigée");
  } finally {
    db.db.close();
  }
});
