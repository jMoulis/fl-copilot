import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { OutboxDatabase } from "../apps/mobile/src/sync/outbox-repository";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import { physicalAllocationFixture } from "./test-physical-allocation-fixtures";
import { chatFixture } from "./test-chat-fixtures";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { applyStoreLayout } from "../apps/mobile/src/store/layout-repository";
import { applyProductMasterSnapshot } from "../apps/mobile/src/products/apply-product-master";
import { applyCommercialChoice } from "../apps/mobile/src/commercial/offer-choice-repository";
import { applyCommercialVisualReading } from "../apps/mobile/src/commercial/visual-repository";
import { applyValidatedOffer } from "../apps/mobile/src/commercial/validated-offer-repository";
import {
  CommercialPreparationRepository,
  applyCommercialPreparation,
} from "../apps/mobile/src/commercial/week-preparation-repository";
import { LayoutPreparationController } from "../apps/mobile/src/copilot/layout-preparation-controller";
import { presentStoreLayoutScenario } from "../apps/api/src/copilot/store-layout-scenario-tool";
import { buildStoreLayoutScenarioMessages } from "../apps/api/src/copilot/store-layout-scenario-messages";
import { copilotMessageSchema } from "../packages/domain/src/index";
import { testChoiceDigest } from "./test-commercial-choice-fixtures";
export class AllocationSqliteAdapter implements OutboxDatabase {
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
    work: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await work(this);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
export async function allocationSqliteFixture(
  path = ":memory:",
  existing = false,
) {
  const f = await physicalAllocationFixture(),
    db = new DatabaseSync(path),
    a = new AllocationSqliteAdapter(db),
    chat = chatFixture(randomUUID);
  chat.storeId = f.storeId;
  chat.conversation.storeId = f.storeId;
  chat.message.storeId = f.storeId;
  chat.message.attachments = [];
  await runLocalMigrations(a);
  const assistant = copilotMessageSchema.parse({
    ...chat.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: chat.message.id,
    text: "Voici la proposition d’implantation.",
  });
  const preview = presentStoreLayoutScenario(
      f.storeId,
      f.layout.input,
      f.layout.sources,
    ),
    message = buildStoreLayoutScenarioMessages(assistant, [preview])[0]!;
  await a.withExclusiveTransactionAsync(async (tx) => {
    await applyStoreLayout(tx, f.storeId, f.layout.first);
    await applyStoreLayout(tx, f.storeId, f.layout.reference);
    await applyProductMasterSnapshot(tx, f.storeId, {
      products: f.layout.sources.products,
      productIdentifiers: [],
      productAliases: [],
    });
    await applyCommercialChoice(tx, f.storeId, f.choice);
    await applyCommercialVisualReading(tx, f.storeId, f.reading);
    await applyValidatedOffer(tx, f.storeId, f.validated);
    await applyCopilotRecord(
      tx,
      chat,
      "copilot_conversation",
      chat.conversation,
    );
    await applyCopilotRecord(tx, chat, "copilot_message", chat.message);
    await applyCopilotRecord(tx, chat, "copilot_message", assistant);
    await applyCopilotRecord(tx, chat, "copilot_message", message);
    if (existing)
      await applyCommercialPreparation(tx, f.storeId, {
        ...f.preparation,
        note: "Consigne du responsable à préserver",
      });
  });
  const scope = {
      storeId: f.storeId,
      ownerId: chat.ownerId,
      deviceId: chat.deviceId,
      canPrepareCommercialWeek: true,
    },
    now = () => "2026-10-19T15:00:00.000Z",
    controller = new LayoutPreparationController(
      a,
      scope,
      testChoiceDigest,
      randomUUID,
      now,
    ),
    repo = new CommercialPreparationRepository(a, testChoiceDigest);
  const counts = () =>
    Object.fromEntries(
      [
        "sync_outbox",
        "commercial_preparation_history",
        "copilot_tool_results",
        "commercial_week_plans",
      ].map((table) => [
        table,
        db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,
      ]),
    );
  return { f, db, a, chat, message, scope, controller, repo, now, counts };
}
