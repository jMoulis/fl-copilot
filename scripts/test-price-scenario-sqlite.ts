import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  type CopilotMessage,
  readPriceScenarioQuestion,
} from "../packages/domain/src/index";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "../apps/mobile/src/copilot/conversation-repository";
import { CopilotFormRepository } from "../apps/mobile/src/copilot/form-repository";
import { CopilotFormSubmissionService } from "../apps/mobile/src/copilot/form-submission-service";
import type { OutboxDatabase } from "../apps/mobile/src/sync/outbox-repository";
import type { scenarioChatFixture } from "./test-price-scenario-fixtures";
class Adapter implements OutboxDatabase {
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
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
/** Real native form service, used to test the existing wire format rather than a handwritten response. */
export async function submitNativeScenarioAnswer(
  f: ReturnType<typeof scenarioChatFixture>,
  values: string[],
): Promise<CopilotMessage> {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    deviceId = randomUUID();
  try {
    await runLocalMigrations(a);
    const repo = new CopilotConversationRepository(a, f.chat);
    await repo.save(f.chat.conversation, { commandId: randomUUID(), deviceId });
    await repo.append(f.chat.message, { commandId: randomUUID(), deviceId });
    await a.withExclusiveTransactionAsync(async (tx) => {
      await applyCopilotRecord(tx, f.chat, "copilot_message", f.assistant);
      await applyCopilotRecord(tx, f.chat, "copilot_message", f.question);
    });
    const { definition } = readPriceScenarioQuestion(f.question),
      scope = {
        storeId: f.scope.storeId,
        ownerId: f.scope.ownerId,
        conversationId: f.scope.conversationId,
        canReadStore: true,
      };
    const forms = new CopilotFormRepository(a),
      form = await forms.create(definition, scope);
    const answers = Object.fromEntries(
      definition.fields.map((field, i) => [field.key, values[i]!]),
    );
    const saved = await forms.edit(
      {
        id: definition.id,
        expectedVersion: form.version,
        action: "SAVE",
        answers,
      },
      scope,
      definition.basisToken,
    );
    const input = {
      formId: definition.id,
      expectedVersion: saved.form.version,
    };
    const authority = {
      ...scope,
      deviceId,
      canSubmitForm: true,
      confirmedFormId: definition.id,
      confirmedFormVersion: saved.form.version,
      currentBasisToken: definition.basisToken,
    };
    const service = new CopilotFormSubmissionService(
      a,
      randomUUID,
      () => f.answer.createdAt,
      { replyToTool: true, scheduleReply: true },
    );
    const result = await service.submit(input, authority);
    const repeated = await service.submit(input, authority);
    if (repeated.message.id !== result.message.id)
      throw Error("DUPLICATED_RESPONSE");
    const users = db
      .prepare(
        "SELECT COUNT(*) n FROM copilot_messages WHERE json_extract(payload_json,'$.role')='USER'",
      )
      .get() as { n: number };
    if (users.n !== 2) throw Error("DUPLICATED_RESPONSE");
    return result.message;
  } finally {
    db.close();
  }
}
