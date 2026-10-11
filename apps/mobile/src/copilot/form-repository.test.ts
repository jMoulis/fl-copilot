import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  evaluateCopilotForm,
  type CopilotFormDefinition,
} from "@fl-copilot/domain";
import { runLocalMigrations, localMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotFormRepository } from "./form-repository";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("private database error");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

async function setup(path = ":memory:") {
  const db = new DatabaseSync(path),
    a = new Adapter(db),
    f = chatFixture(randomUUID),
    deviceId = randomUUID();
  await runLocalMigrations(a);
  const c = new CopilotConversationRepository(a, f);
  await c.save(f.conversation, { commandId: randomUUID(), deviceId });
  await c.append(
    { ...f.message, text: "Prépare une offre pour cette TG.", attachments: [] },
    { commandId: randomUUID(), deviceId },
  );
  const scope = {
      storeId: f.storeId,
      ownerId: f.ownerId,
      conversationId: f.conversation.id,
      canReadStore: true,
    },
    definition: CopilotFormDefinition = {
      id: randomUUID(),
      parentUserMessageId: f.message.id,
      operationId: randomUUID(),
      basisToken: "product-v3/week-v2",
      title: "Deux informations pour préparer l’offre",
      reason:
        "Le coût d’achat et la date sont nécessaires pour examiner la marge.",
      fields: [
        {
          key: "cost",
          label: "Coût d’achat",
          type: "NUMBER",
          unit: "EUR",
          required: true,
        },
        { key: "date", label: "Date de début", type: "DATE", required: true },
        {
          key: "choice",
          label: "Emplacement",
          type: "CHOICE",
          required: false,
          options: [{ id: "tg1", label: "TG entrée" }],
        },
        {
          key: "note",
          label: "Note",
          type: "TEXT",
          maxLength: 100,
          required: false,
        },
      ],
      prefill: { choice: "tg1" },
    };
  const repo = new CopilotFormRepository(a, () => "2026-10-11T12:01:00Z");
  return { db, a, f, scope, definition, repo };
}
it("keeps a partial offline answer after restart and validates decimal/date fields without business writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-form-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const count = s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
      form = await s.repo.create(s.definition, s.scope);
    expect(await s.repo.create(s.definition, s.scope)).toEqual(form);
    const partial = await s.repo.edit(
      {
        id: form.definition.id,
        expectedVersion: 1,
        action: "SAVE",
        answers: { cost: "0002,500000", choice: "tg1" },
      },
      s.scope,
      s.definition.basisToken,
    );
    expect(partial.form.status).toBe("OPEN");
    expect(partial.issues).toMatchObject([{ key: "date", code: "REQUIRED" }]);
    s.db.close();
    reopened = new DatabaseSync(path);
    const repo = new CopilotFormRepository(new Adapter(reopened));
    const persisted = await repo.get(form.definition.id, s.scope);
    expect(persisted?.answers.cost).toBe("0002,500000");
    expect(persisted?.version).toBe(2);
    const completed = await repo.edit(
      {
        id: form.definition.id,
        expectedVersion: 2,
        action: "SAVE",
        answers: { date: "2026-10-12" },
      },
      s.scope,
      s.definition.basisToken,
    );
    expect(completed.form.status).toBe("READY");
    expect(
      evaluateCopilotForm(completed.form.definition, completed.form.answers)
        .normalized.cost,
    ).toBe("0002.500000");
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
    ).toEqual(count);
    expect(reopened.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({
      n: 0,
    });
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("returns field errors, preserves raw invalid drafts and supports postponing, resuming and cancelling", async () => {
  const s = await setup();
  try {
    await s.repo.create(s.definition, s.scope);
    await expect(
      s.repo.edit(
        {
          id: s.definition.id,
          expectedVersion: 1,
          action: "SAVE",
          answers: Object.fromEntries(
            Array.from({ length: 8 }, (_, i) => ["unknown_" + i, "value"]),
          ),
        },
        s.scope,
        s.definition.basisToken,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const invalid = await s.repo.edit(
      {
        id: s.definition.id,
        expectedVersion: 1,
        action: "SAVE",
        answers: { cost: "1 000,50", date: "2026-02-30", choice: "other" },
      },
      s.scope,
      s.definition.basisToken,
    );
    expect(invalid.form.status).toBe("OPEN");
    expect(invalid.issues.map((i) => i.key)).toEqual([
      "cost",
      "date",
      "choice",
    ]);
    expect(invalid.form.answers.date).toBe("2026-02-30");
    const deferred = await s.repo.edit(
      {
        id: s.definition.id,
        expectedVersion: 2,
        action: "POSTPONE",
        answers: invalid.form.answers,
      },
      s.scope,
      s.definition.basisToken,
    );
    expect(deferred.form.status).toBe("POSTPONED");
    const ready = await s.repo.edit(
      {
        id: s.definition.id,
        expectedVersion: 3,
        action: "SAVE",
        answers: { cost: "2", date: "2026-10-12", choice: null },
      },
      s.scope,
      s.definition.basisToken,
    );
    expect(ready.form.status).toBe("READY");
    const cancelled = await s.repo.edit(
      {
        id: s.definition.id,
        expectedVersion: 4,
        action: "CANCEL",
        answers: {},
      },
      s.scope,
      s.definition.basisToken,
    );
    expect(cancelled.form.status).toBe("CANCELLED");
    expect(cancelled.form.answers.cost).toBe("2");
    await expect(
      s.repo.edit(
        {
          id: s.definition.id,
          expectedVersion: 5,
          action: "SAVE",
          answers: {},
        },
        s.scope,
        s.definition.basisToken,
      ),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  } finally {
    s.db.close();
  }
});
it("invalidates obsolete follow-ups and rejects stale versions, foreign access and definition changes", async () => {
  const s = await setup();
  try {
    await s.repo.create(s.definition, s.scope);
    await expect(
      s.repo.get(s.definition.id, { ...s.scope, ownerId: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      s.repo.get(s.definition.id, { ...s.scope, canReadStore: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      s.repo.create({ ...s.definition, title: "Autre demande" }, s.scope),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(
      s.repo.edit(
        {
          id: s.definition.id,
          expectedVersion: 2,
          action: "SAVE",
          answers: {},
        },
        s.scope,
        s.definition.basisToken,
      ),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    const stale = await s.repo.edit(
      {
        id: s.definition.id,
        expectedVersion: 1,
        action: "SAVE",
        answers: { cost: "3" },
      },
      s.scope,
      "product-v4/week-v2",
    );
    expect(stale.form.status).toBe("STALE");
    expect(stale.form.answers).toEqual(s.definition.prefill);
    await expect(
      s.repo.edit(
        {
          id: s.definition.id,
          expectedVersion: 2,
          action: "SAVE",
          answers: {},
        },
        s.scope,
        "product-v4/week-v2",
      ),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  } finally {
    s.db.close();
  }
});
it("requires file references to already be saved in this store and never stores a local/signed URL", async () => {
  const s = await setup();
  try {
    const definition = {
      ...s.definition,
      fields: [
        {
          key: "file",
          label: "Export Mercalys",
          type: "FILE" as const,
          required: true,
        },
      ],
      prefill: {},
    };
    await s.repo.create(definition, s.scope);
    const attachment = {
        sourceDocumentId: randomUUID(),
        filename: "ventes.xlsx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      result = await s.repo.edit(
        {
          id: definition.id,
          expectedVersion: 1,
          action: "SAVE",
          answers: { file: attachment },
        },
        s.scope,
        definition.basisToken,
      );
    expect(result.form.status).toBe("OPEN");
    expect(result.issues[0]?.code).toBe("SOURCE_UNAVAILABLE");
    await s.a.runAsync(
      "INSERT INTO source_documents(id,store_id,source_type,original_filename,local_processing_status,remote_upload_status,version,created_at,updated_at) VALUES(?,?,'MERCALYS_SALES',?,'IMPORTED','PENDING',1,?,?)",
      attachment.sourceDocumentId,
      s.f.storeId,
      attachment.filename,
      "2026-10-11T12:00:00Z",
      "2026-10-11T12:00:00Z",
    );
    expect(
      (
        await s.repo.edit(
          {
            id: definition.id,
            expectedVersion: 2,
            action: "SAVE",
            answers: { file: attachment },
          },
          s.scope,
          definition.basisToken,
        )
      ).form.status,
    ).toBe("READY");
    await expect(
      s.repo.edit(
        {
          id: definition.id,
          expectedVersion: 3,
          action: "SAVE",
          answers: { file: { ...attachment, url: "file:///private/source" } },
        },
        s.scope,
        definition.basisToken,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  } finally {
    s.db.close();
  }
});
it("rolls back form creation/edits on failed commit and cancellation", async () => {
  const s = await setup();
  try {
    s.a.fail = true;
    await expect(s.repo.create(s.definition, s.scope)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    s.a.fail = false;
    expect(s.db.prepare("SELECT COUNT(*) n FROM copilot_forms").get()).toEqual({
      n: 0,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      s.repo.create(s.definition, s.scope, controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await s.repo.create(s.definition, s.scope);
    s.a.fail = true;
    await expect(
      s.repo.edit(
        {
          id: s.definition.id,
          expectedVersion: 1,
          action: "SAVE",
          answers: { cost: "2" },
        },
        s.scope,
        s.definition.basisToken,
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    s.a.fail = false;
    expect((await s.repo.get(s.definition.id, s.scope))?.version).toBe(1);
  } finally {
    s.db.close();
  }
});

it("upgrades schema 35 without losing private history or pending sync work", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  try {
    await runLocalMigrations(a, localMigrations.slice(0, 35));
    const c = new CopilotConversationRepository(a, f),
      deviceId = randomUUID();
    await c.save(f.conversation, { commandId: randomUUID(), deviceId });
    await c.append(
      { ...f.message, attachments: [] },
      { commandId: randomUUID(), deviceId },
    );
    const pending = db.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    expect(await runLocalMigrations(a)).toBe(36);
    expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      pending,
    );
    expect(db.prepare("SELECT COUNT(*) n FROM copilot_messages").get()).toEqual(
      { n: 1 },
    );
    expect(db.prepare("SELECT COUNT(*) n FROM copilot_forms").get()).toEqual({
      n: 0,
    });
  } finally {
    db.close();
  }
});
