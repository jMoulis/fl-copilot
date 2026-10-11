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
