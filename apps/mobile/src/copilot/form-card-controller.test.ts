import { CopilotInformationFormController } from "./information-form-controller";
import { applyCopilotRecord } from "./conversation-repository";
import { copilotMessageSchema } from "@fl-copilot/domain";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CopilotFormCardController,
  CopilotFormCardActionError,
} from "./form-card-controller";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
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

it("maps submit to validated fields and one private message, while missing fields stay editable", async () => {
  const s = await setup();
  try {
    const controller = new CopilotFormCardController(
        s.repo,
        s.service,
        async () => s.definition.basisToken,
      ),
      form = (await s.repo.get(s.definition.id, s.scope))!;
    const partial = await controller.perform(
      "SUBMIT",
      form,
      { cost: "2,50" },
      s.scope,
      { deviceId: s.authority.deviceId, canSubmitForm: true },
    );
    expect(partial.form.status).toBe("OPEN");
    expect(partial.issues[0]?.key).toBe("date");
    expect(partial.submission).toBeNull();
    const sent = await controller.perform(
      "SUBMIT",
      partial.form,
      { cost: "2,50", date: "2026-10-12" },
      s.scope,
      { deviceId: s.authority.deviceId, canSubmitForm: true },
    );
    expect(sent.form.status).toBe("ANSWERED");
    expect(sent.submission?.message.text).toContain("2,50 EUR");
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_messages").get(),
    ).toEqual({ n: 2 });
  } finally {
    s.db.close();
  }
});
it("keeps postpone/resume drafts and returns the committed version after cancelled submission for safe retry", async () => {
  const s = await setup();
  try {
    const controller = new CopilotFormCardController(
        s.repo,
        s.service,
        async () => s.definition.basisToken,
      ),
      ctx = { deviceId: s.authority.deviceId, canSubmitForm: true },
      form = (await s.repo.get(s.definition.id, s.scope))!;
    const postponed = await controller.perform(
      "POSTPONE",
      form,
      { cost: "2,50" },
      s.scope,
      ctx,
    );
    expect(postponed.form.status).toBe("POSTPONED");
    const resumed = await controller.perform(
      "RESUME",
      postponed.form,
      postponed.form.answers,
      s.scope,
      ctx,
    );
    expect(resumed.form.status).toBe("OPEN");
    expect(resumed.form.answers.cost).toBe("2,50");
    const abort = new AbortController();
    let calls = 0;
    const cancelling = new CopilotFormCardController(
      s.repo,
      s.service,
      async () => {
        if (++calls === 2) abort.abort();
        return s.definition.basisToken;
      },
    );
    let failure: CopilotFormCardActionError | undefined;
    try {
      await cancelling.perform(
        "SUBMIT",
        resumed.form,
        { cost: "2,50", date: "2026-10-12" },
        s.scope,
        ctx,
        abort.signal,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(CopilotFormCardActionError);
      failure = error as CopilotFormCardActionError;
    }
    expect(failure?.form?.status).toBe("READY");
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_messages").get(),
    ).toEqual({ n: 1 });
    const result = await controller.perform(
      "SUBMIT",
      failure!.form!,
      failure!.form!.answers,
      s.scope,
      ctx,
    );
    expect(result.form.status).toBe("ANSWERED");
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_messages").get(),
    ).toEqual({ n: 2 });
  } finally {
    s.db.close();
  }
});
it("refreshes basis before sending and exposes an obsolete question instead of acting", async () => {
  const s = await setup();
  try {
    const form = (await s.repo.get(s.definition.id, s.scope))!;
    let calls = 0;
    const controller = new CopilotFormCardController(
      s.repo,
      s.service,
      async () => (++calls === 1 ? s.definition.basisToken : "offer-v4"),
    );
    await expect(
      controller.perform(
        "SUBMIT",
        form,
        { cost: "2", date: "2026-10-12" },
        s.scope,
        { deviceId: s.authority.deviceId, canSubmitForm: true },
      ),
    ).rejects.toMatchObject({
      original: { code: "STALE" },
      form: { status: "READY" },
    });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_messages").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});

async function informationArtifact(s: Awaited<ReturnType<typeof setup>>) {
  const definition = { ...s.definition, id: randomUUID() };
  definition.operationId = definition.id;
  const assistant = copilotMessageSchema.parse({
    ...s.f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: s.f.message.id,
    attachments: [],
    text: "Précisons cette offre.",
  });
  const source = copilotMessageSchema.parse({
    ...assistant,
    id: definition.id,
    role: "TOOL",
    text: JSON.stringify({
      kind: "MISSING_INFORMATION_REQUEST",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      definition,
    }),
  });
  await s.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, s.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, s.f, "copilot_message", source);
  });
  const actor = {
    storeId: s.f.storeId,
    ownerId: s.f.ownerId,
    deviceId: s.authority.deviceId,
  };
  return {
    source,
    actor,
    controller: new CopilotInformationFormController(s.a, actor, randomUUID),
  };
}
it("persists partial form answers, postpones across unrelated messages and resumes one queued reply after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fl-info-form-")),
    path = join(directory, "db.sqlite"),
    s = await setup(path);
  let db = s.db;
  try {
    const { source, actor, controller } = await informationArtifact(s);
    await s.c.saveDraft(s.f.conversation.id, {
      text: "Mon prochain message",
      attachments: [],
      updatedAt: "2026-10-14T10:00:00Z",
    });
    await controller.open(source);
    await controller.save(source, { cost: "0004,500000" });
    await expect(
      controller.perform(source, "SUBMIT", { cost: "0004,500000" }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ key: "date" })],
    });
    expect(await s.c.pendingTurns(s.f.conversation.id)).toEqual([]);
    expect(
      (await controller.perform(source, "POSTPONE", { cost: "0004,500000" }))
        .form.status,
    ).toBe("POSTPONED");
    await s.a.withExclusiveTransactionAsync((tx) =>
      applyCopilotRecord(tx, s.f, "copilot_message", {
        ...s.f.message,
        id: randomUUID(),
        text: "Une autre question",
        attachments: [],
        createdAt: "2026-10-14T10:01:00Z",
      }),
    );
    expect(
      (await controller.perform(source, "RESUME", { cost: "0004,500000" })).form
        .status,
    ).toBe("OPEN");
    const answered = await controller.perform(source, "SUBMIT", {
      cost: "0004,500000",
      date: "2026-10-14",
    });
    expect(answered.form.status).toBe("ANSWERED");
    expect(answered.form.submission?.normalized.cost).toBe("0004.500000");
    expect(answered.responseMessage?.replyToMessageId).toBe(source.id);
    expect(answered.responseMessage?.text).toContain("14/10/2026");
    const pending = await s.c.pendingTurns(s.f.conversation.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.userMessageId).toBe(answered.responseMessage?.id);
    expect((await s.c.draft(s.f.conversation.id))?.text).toBe(
      "Mon prochain message",
    );
    db.close();
    db = new DatabaseSync(path);
    const restored = new CopilotInformationFormController(
      new Adapter(db),
      actor,
      randomUUID,
    );
    expect((await restored.open(source)).form.status).toBe("ANSWERED");
    await restored.perform(source, "SUBMIT", {
      cost: "999",
      date: "2026-10-15",
    });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM copilot_pending_turns WHERE user_message_id=?",
        )
        .get(answered.responseMessage!.id)!.n,
    ).toBe(1);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_id=?")
        .get(answered.responseMessage!.id)!.n,
    ).toBe(1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
it("refuses altered/private/superseded forms and persists explicit cancellation without a new question", async () => {
  const s = await setup();
  try {
    const { source, controller, actor } = await informationArtifact(s);
    await expect(
      controller.open({ ...source, ownerId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      controller.open({
        ...source,
        text: source.text.replace(
          "Le coût et la date manquent.",
          "Remplacer la demande.",
        ),
      }),
    ).rejects.toThrow();
    expect((await controller.perform(source, "CANCEL", {})).form.status).toBe(
      "CANCELLED",
    );
    expect(await s.c.pendingTurns(s.f.conversation.id)).toEqual([]);
    const second = await informationArtifact(s);
    await second.controller.open(second.source);
    await s.c.append(
      {
        ...s.f.message,
        id: randomUUID(),
        text: "Corrige ma demande",
        attachments: [],
        supersedesMessageId: s.f.message.id,
        createdAt: "2026-10-14T10:01:00Z",
      },
      { commandId: randomUUID(), deviceId: actor.deviceId },
    );
    expect((await second.controller.open(second.source)).form.status).toBe(
      "STALE",
    );
    await expect(
      second.controller.perform(second.source, "SUBMIT", {
        cost: "4",
        date: "2026-10-14",
      }),
    ).rejects.toThrow();
    expect(await s.c.pendingTurns(s.f.conversation.id)).toEqual([]);
  } finally {
    s.db.close();
  }
});
