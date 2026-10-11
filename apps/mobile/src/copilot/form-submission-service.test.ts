import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { type CopilotFormDefinition } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotFormRepository } from "./form-repository";
import { CopilotFormSubmissionService } from "./form-submission-service";
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
    { ...f.message, text: "Examine cette offre.", attachments: [] },
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
      basisToken: "offer-v3",
      title: "Préciser l’offre",
      reason: "Le coût et la date manquent.",
      fields: [
        {
          key: "cost",
          label: "Coût d’achat",
          type: "NUMBER",
          unit: "EUR",
          required: true,
        },
        { key: "date", label: "Début", type: "DATE", required: true },
      ],
      prefill: {},
    };
  const repo = new CopilotFormRepository(a, () => "2026-10-11T12:01:00Z");
  await repo.create(definition, scope);
  const input = { formId: definition.id, expectedVersion: 2 },
    authority = {
      ...scope,
      deviceId,
      canSubmitForm: true,
      confirmedFormId: definition.id,
      confirmedFormVersion: 2,
      currentBasisToken: definition.basisToken,
    },
    service = new CopilotFormSubmissionService(
      a,
      randomUUID,
      () => "2026-10-11T12:02:00Z",
    );
  const complete = () =>
    repo.edit(
      {
        id: definition.id,
        expectedVersion: 1,
        action: "SAVE",
        answers: { cost: "0002,500000", date: "2026-10-12" },
      },
      scope,
      definition.basisToken,
    );
  return {
    db,
    a,
    f,
    scope,
    definition,
    repo,
    input,
    authority,
    service,
    complete,
    c,
  };
}
it("submits one canonical USER message, retains exact structured values and unrelated composer draft across restart/retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-answer-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    await s.complete();
    const draft = {
      text: "Autre question en cours",
      attachments: [],
      updatedAt: "2026-10-11T12:01:00.000Z",
    };
    await s.c.saveDraft(s.f.conversation.id, draft);
    const saved = await s.service.submit(s.input, s.authority);
    expect(saved.form.status).toBe("ANSWERED");
    expect(saved.form.submission?.normalized).toEqual({
      cost: "0002.500000",
      date: "2026-10-12",
    });
    expect(saved.message.text).toContain("12/10/2026");
    expect(saved.message.text).toContain("0002,500000 EUR");
    expect(saved.message.replyToMessageId).toBe(s.f.message.id);
    expect(await s.c.draft(s.f.conversation.id)).toEqual(draft);
    s.db.close();
    reopened = new DatabaseSync(path);
    const a = new Adapter(reopened),
      service = new CopilotFormSubmissionService(a, randomUUID);
    expect(await service.submit(s.input, s.authority)).toEqual(saved);
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM copilot_messages").get(),
    ).toEqual({ n: 2 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COPILOT_MESSAGE_APPEND'",
        )
        .get(),
    ).toEqual({ n: 2 });
    expect(reopened.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({
      n: 0,
    });
    await expect(
      new CopilotFormRepository(a).edit(
        {
          id: s.definition.id,
          expectedVersion: 3,
          action: "SAVE",
          answers: { cost: "3" },
        },
        s.scope,
        s.definition.basisToken,
      ),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(
      service.submit(s.input, { ...s.authority, canSubmitForm: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects incomplete/obsolete responses, changed versions and foreign confirmation without sending a message", async () => {
  const s = await setup();
  try {
    await expect(
      s.service.submit(
        { formId: s.definition.id, expectedVersion: 1 },
        { ...s.authority, confirmedFormVersion: 1 },
      ),
    ).rejects.toMatchObject({
      code: "NOT_READY",
      issues: [{ key: "cost" }, { key: "date" }],
    });
    await s.complete();
    await expect(
      s.service.submit(s.input, {
        ...s.authority,
        currentBasisToken: "offer-v4",
      }),
    ).rejects.toMatchObject({ code: "STALE" });
    await expect(
      s.service.submit(s.input, { ...s.authority, ownerId: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      s.service.submit(s.input, {
        ...s.authority,
        confirmedFormId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await s.repo.edit(
      {
        id: s.definition.id,
        expectedVersion: 2,
        action: "SAVE",
        answers: { cost: "3" },
      },
      s.scope,
      s.definition.basisToken,
    );
    await expect(s.service.submit(s.input, s.authority)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_messages").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});
it("rechecks attachment ownership/existence and deduplicates repeated references when sending", async () => {
  const s = await setup();
  try {
    const definition = {
      ...s.definition,
      id: randomUUID(),
      fields: [
        {
          key: "file",
          label: "Fichier",
          type: "FILE" as const,
          required: true,
        },
        {
          key: "same_file",
          label: "Même source",
          type: "FILE" as const,
          required: false,
        },
      ],
      prefill: {},
    };
    const file = {
      sourceDocumentId: randomUUID(),
      filename: "ventes.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    await s.a.runAsync(
      "INSERT INTO source_documents(id,store_id,source_type,original_filename,local_processing_status,remote_upload_status,version,created_at,updated_at) VALUES(?,?,'MERCALYS_SALES',?,'IMPORTED','PENDING',1,?,?)",
      file.sourceDocumentId,
      s.f.storeId,
      file.filename,
      "2026-10-11T12:00:00Z",
      "2026-10-11T12:00:00Z",
    );
    await s.repo.create(definition, s.scope);
    await s.repo.edit(
      {
        id: definition.id,
        expectedVersion: 1,
        action: "SAVE",
        answers: { file, same_file: file },
      },
      s.scope,
      definition.basisToken,
    );
    const input = { formId: definition.id, expectedVersion: 2 },
      authority = { ...s.authority, confirmedFormId: definition.id };
    s.db
      .prepare("UPDATE source_documents SET deleted_at=?")
      .run("2026-10-11T12:01:00Z");
    await expect(s.service.submit(input, authority)).rejects.toMatchObject({
      code: "NOT_READY",
      issues: [{ code: "SOURCE_UNAVAILABLE" }, { code: "SOURCE_UNAVAILABLE" }],
    });
    s.db.exec("UPDATE source_documents SET deleted_at=NULL");
    const saved = await s.service.submit(input, authority);
    expect(saved.message.attachments).toEqual([file]);
    expect(saved.form.submission?.normalized.file).toEqual(file);
  } finally {
    s.db.close();
  }
});
it("rolls back message/outbox/receipt together and reads pre-submission form payloads compatibly", async () => {
  const s = await setup();
  try {
    const completed = await s.complete(),
      { submission: _submission, ...legacy } = completed.form;
    void _submission;
    s.db
      .prepare("UPDATE copilot_forms SET payload_json=?")
      .run(JSON.stringify(legacy));
    s.a.fail = true;
    await expect(s.service.submit(s.input, s.authority)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    s.a.fail = false;
    expect((await s.repo.get(s.definition.id, s.scope))?.status).toBe("READY");
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_messages").get(),
    ).toEqual({ n: 1 });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COPILOT_MESSAGE_APPEND'",
        )
        .get(),
    ).toEqual({ n: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      s.service.submit(s.input, s.authority, controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect((await s.service.submit(s.input, s.authority)).form.status).toBe(
      "ANSWERED",
    );
  } finally {
    s.db.close();
  }
});
