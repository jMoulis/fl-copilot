import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import type { VisualEntityType } from "../packages/domain/src/index";
import {
  prepareVisualActionBasis,
  visualActionStatus,
  copilotMessageSchema,
} from "../packages/domain/src/index";
import { visualLibraryFixture } from "./test-visual-library-fixtures";
import { chatFixture } from "./test-chat-fixtures";
import { serializedTestDatabase } from "./test-serialized-sqlite";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import { ProductMasterRepository } from "../apps/mobile/src/products/product-master-repository";
import { loadProductEditorSnapshot } from "../apps/mobile/src/products/product-editor-service";
import {
  VisualLibraryRepository,
  applyVisualEntity,
  visualTables,
} from "../apps/mobile/src/products/visual-library-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { CopilotVisualActionController } from "../apps/mobile/src/copilot/visual-action-controller";
import { buildVisualActionMessages } from "../apps/api/src/copilot/visual-action-messages";
export const recoveryActionDigest = async (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function visualRecoveryActionFixture(
  kind: VisualEntityType = "visual_asset",
  known = false,
  path = ":memory:",
  synchronizedProduct = true,
) {
  const f = visualLibraryFixture(),
    db = serializedTestDatabase(new DatabaseSync(path));
  await runLocalMigrations(db);
  const products = new ProductMasterRepository(db),
    library = new VisualLibraryRepository(db),
    outbox = new OutboxRepository(db);
  await products.upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  await db.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
  let failedCommand = "",
    targetId = "";
  for (const [k, e] of [
    ["visual_asset", f.asset],
    ["visual_identity", f.identity],
    ["product_visual_link", f.link],
  ] as const) {
    if (known) await applyVisualEntity(db, f.storeId, k, e, e.version);
    if (!known || k === kind) {
      const commandId = randomUUID();
      await library.save(
        k,
        { ...e, version: known ? 2 : 1 },
        {
          storeId: f.storeId,
          actorId: f.actorId,
          deviceId: f.deviceId,
          commandId,
          canWrite: true,
          expectedLocalVersion: known ? 1 : null,
        },
      );
      if (k === kind) {
        failedCommand = commandId;
        targetId = e.id;
      }
    }
  }
  await outbox.markSyncing(failedCommand);
  await outbox.markFailed(failedCommand, "VISUAL_ACCESS_INVALID");
  await db.runAsync(
    `UPDATE ${visualTables[kind]} SET sync_state='ERROR' WHERE id=? AND store_id=?`,
    targetId,
    f.storeId,
  );
  const originalChat = chatFixture(randomUUID),
    chat = { ...originalChat, storeId: f.storeId, ownerId: f.actorId };
  chat.conversation = {
    ...chat.conversation,
    storeId: f.storeId,
    ownerId: f.actorId,
  };
  chat.message = copilotMessageSchema.parse({
    ...chat.message,
    storeId: f.storeId,
    ownerId: f.actorId,
    attachments: [],
    text: "Examine les choix refusés de cette image, je confirmerai la reprise.",
  });
  const assistant = copilotMessageSchema.parse({
    ...chat.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: chat.message.id,
    text: "Examinons le choix conservé sur cet appareil.",
  });
  const input = {
    action: "REVIEW_RECOVERY" as const,
    productId: f.product.id,
    visualIdentityId: null,
  };
  const basis = await prepareVisualActionBasis(
    f.storeId,
    input,
    {
      product: synchronizedProduct
        ? await loadProductEditorSnapshot(products, f.product.id)
        : null,
      currentLink: null,
      currentIdentity: null,
      currentAsset: null,
      selectedIdentity: null,
      selectedAsset: null,
    },
    recoveryActionDigest,
  );
  const preview = {
    input,
    basis,
    status: visualActionStatus(input, basis),
    evidence: [
      {
        id: randomUUID(),
        sourceType: "DATA_QUALITY",
        sourceId: f.product.id,
        sourceVersion: null,
        label: "Demande de revue locale",
        value: "L’appareil vérifiera l’état local.",
        factKind: "QUALITY",
      },
    ],
  };
  const message = buildVisualActionMessages(assistant, [preview])[0]!;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(
      tx,
      chat,
      "copilot_conversation",
      chat.conversation,
    );
    for (const m of [chat.message, assistant, message])
      await applyCopilotRecord(tx, chat, "copilot_message", m);
  });
  const scope = {
    storeId: f.storeId,
    ownerId: f.actorId,
    deviceId: f.deviceId,
    canManageVisualLibrary: true,
  };
  const controller = new CopilotVisualActionController(
    db,
    scope,
    recoveryActionDigest,
    randomUUID,
    () => f.at,
  );
  const state = await controller.openRecovery(message);
  const selected = state.review!.targets.find(
    (t) => t.kind === kind && t.id === targetId,
  )!;
  const request = {
    basisHash: state.review!.basisHash,
    kind,
    entityId: targetId,
    recoveryAction: "RETRY_LOCAL" as const,
    comparisonReviewed: true as const,
    reactivate: false,
    rightsConfirmed: true,
  };
  return {
    f,
    db,
    products,
    library,
    outbox,
    kind,
    known,
    targetId,
    failedCommand,
    chat,
    assistant,
    input,
    preview,
    message,
    scope,
    controller,
    state,
    selected,
    request,
  };
}
