import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { illustrationFixture } from "./test-layout-illustration-fixtures";
import { AllocationSqliteAdapter } from "./test-physical-allocation-sqlite";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { applyStoreLayout } from "../apps/mobile/src/store/layout-repository";
import { applyProductMasterSnapshot } from "../apps/mobile/src/products/apply-product-master";
import { applyCommercialChoice } from "../apps/mobile/src/commercial/offer-choice-repository";
import {
  copilotConversationSchema,
  copilotMessageSchema,
} from "../packages/domain/src/index";
import { LayoutIllustrationRepository } from "../apps/mobile/src/copilot/layout-illustration-repository";
export const illustrationDigest = async (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
export async function illustrationPreparationFixture(
  path = ":memory:",
  complete = true,
) {
  const f = await illustrationFixture(complete),
    db = new DatabaseSync(path),
    a = new AllocationSqliteAdapter(db);
  await runLocalMigrations(a);
  const conversation = copilotConversationSchema.parse({
    storeId: f.scope.storeId,
    ownerId: f.scope.ownerId,
    id: f.scope.conversationId,
    title: "Implantation",
    status: "ACTIVE",
    version: 1,
    createdAt: "2026-10-20T15:59:00.000Z",
    updatedAt: "2026-10-20T15:59:00.000Z",
  });
  const assistant = copilotMessageSchema.parse({
    ...f.card,
    id: JSON.parse(f.card.text).assistantMessageId,
    role: "ASSISTANT",
    text: "Proposition du rayon",
    createdAt: "2026-10-20T16:00:00.000Z",
  });
  const user = copilotMessageSchema.parse({
    ...assistant,
    id: f.card.replyToMessageId,
    role: "USER",
    text: "Propose une implantation.",
    replyToMessageId: null,
    createdAt: "2026-10-20T15:59:30.000Z",
  });
  await a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, f.scope, "copilot_conversation", conversation);
    for (const m of [user, assistant, f.card])
      await applyCopilotRecord(tx, f.scope, "copilot_message", m);
    await applyStoreLayout(tx, f.scope.storeId, {
      ...f.first,
      content: structuredClone(f.reference.content),
    });
    await applyStoreLayout(tx, f.scope.storeId, f.reference);
    await applyProductMasterSnapshot(tx, f.scope.storeId, {
      products: f.sources.products,
      productIdentifiers: [],
      productAliases: [],
    });
    await applyCommercialChoice(tx, f.scope.storeId, f.choice.choice);
  });
  const scope = { ...f.scope, canPrepare: true },
    now = () => "2026-10-20T16:10:00.000Z",
    repo = new LayoutIllustrationRepository(a, scope, illustrationDigest, now),
    ids = { id: randomUUID(), deviceId: randomUUID(), commandId: randomUUID() };
  return { ...f, scope, db, a, repo, ids, now, conversation, assistant, user };
}
