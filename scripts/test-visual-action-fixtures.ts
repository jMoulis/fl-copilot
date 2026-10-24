import { serializeLocalWrites } from "../apps/mobile/src/db/serialized-writes";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import {
  visualLibraryFixture,
  testVisualId,
} from "./test-visual-library-fixtures";
import { VisualTestDatabase } from "./test-visual-sqlite";
import { chatFixture } from "./test-chat-fixtures";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import { ProductMasterRepository } from "../apps/mobile/src/products/product-master-repository";
import { loadProductEditorSnapshot } from "../apps/mobile/src/products/product-editor-service";
import {
  applyVisualEntity,
  VisualLibraryRepository,
} from "../apps/mobile/src/products/visual-library-repository";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "../apps/mobile/src/copilot/conversation-repository";
import { CopilotVisualActionController } from "../apps/mobile/src/copilot/visual-action-controller";
import { buildVisualActionMessages } from "../apps/api/src/copilot/visual-action-messages";
import {
  prepareVisualActionBasis,
  visualActionPreviewSchema,
  copilotMessageSchema,
  visualActionStatus,
} from "../packages/domain/src/index";
// Expo gives the exclusive callback an unwrapped transaction connection. Keep
// that boundary while exercising the actual app writer queue with node:sqlite.
class VisualActionTestDatabase extends VisualTestDatabase {
  readonly transaction = new VisualTestDatabase(this.raw);
  override async withExclusiveTransactionAsync(
    task: (tx: VisualTestDatabase) => Promise<void>,
  ) {
    await this.transaction.withExclusiveTransactionAsync(task);
  }
}
function serializedDatabase(raw: DatabaseSync) {
  const db = new VisualActionTestDatabase(raw);
  serializeLocalWrites(db);
  return db;
}

export const visualActionDigest = async (v: string) =>
  createHash("sha256").update(v).digest("hex");
export async function visualActionFixture(
  action:
    "ASSIGN_LIBRARY" | "REMOVE_PRODUCT" | "REVOKE_CURRENT" = "ASSIGN_LIBRARY",
  path = ":memory:",
  options: { retiredAssociation?: boolean } = {},
) {
  const f = visualLibraryFixture(),
    db = serializedDatabase(new DatabaseSync(path));
  await runLocalMigrations(db);
  const products = new ProductMasterRepository(db),
    library = new VisualLibraryRepository(db);
  await products.upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  const hash = `sha256:${"b".repeat(64)}`,
    asset = {
      ...f.asset,
      id: testVisualId("visual_asset", f.storeId, hash),
      contentHash: hash,
    },
    identity = {
      ...f.identity,
      id: randomUUID(),
      primaryAssetId: asset.id,
      canonicalName: "Autre tomate ronde",
    };
  for (const a of [f.asset, asset])
    await applyVisualEntity(db, f.storeId, "visual_asset", a, a.version);
  for (const i of [f.identity, identity])
    await applyVisualEntity(db, f.storeId, "visual_identity", i, i.version);
  if (options.retiredAssociation) f.link = { ...f.link, deletedAt: f.at };
  await applyVisualEntity(
    db,
    f.storeId,
    "product_visual_link",
    f.link,
    f.link.version,
  );
  const chat = chatFixture(randomUUID);
  Object.assign(chat, {
    storeId: f.storeId,
    ownerId: f.actorId,
    deviceId: f.deviceId,
  });
  Object.assign(chat.conversation, { storeId: f.storeId, ownerId: f.actorId });
  Object.assign(chat.message, {
    storeId: f.storeId,
    ownerId: f.actorId,
    text: "Change l’image de ce produit après ma confirmation.",
    attachments: [],
  });
  const conversations = new CopilotConversationRepository(db, chat);
  await conversations.save(chat.conversation, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  await conversations.append(chat.message, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  const input = {
    action,
    productId: f.product.id,
    visualIdentityId: action === "ASSIGN_LIBRARY" ? identity.id : null,
  };
  const basis = await prepareVisualActionBasis(
    f.storeId,
    input,
    {
      product: (await loadProductEditorSnapshot(products, f.product.id))!,
      currentLink: f.link,
      currentIdentity: f.identity,
      currentAsset: f.asset,
      selectedIdentity: action === "ASSIGN_LIBRARY" ? identity : null,
      selectedAsset: action === "ASSIGN_LIBRARY" ? asset : null,
    },
    visualActionDigest,
  );
  const preview = visualActionPreviewSchema.parse({
    input,
    basis,
    status: visualActionStatus(input, basis),
    evidence: [
      {
        id: randomUUID(),
        sourceType: "DATA_QUALITY",
        sourceId: f.product.id,
        sourceVersion: 1,
        label: f.product.label,
        factKind: "QUALITY",
        value: "Proposition à confirmer",
      },
    ],
  });
  const assistant = copilotMessageSchema.parse({
      ...chat.message,
      id: randomUUID(),
      role: "ASSISTANT",
      replyToMessageId: chat.message.id,
      text: "Voici l’image à examiner.",
    }),
    message = buildVisualActionMessages(assistant, [preview])[0]!;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, chat, "copilot_message", assistant);
    await applyCopilotRecord(tx, chat, "copilot_message", message);
  });
  const scope = {
      storeId: f.storeId,
      ownerId: f.actorId,
      deviceId: f.deviceId,
      canManageVisualLibrary: true,
    },
    controller = new CopilotVisualActionController(
      db,
      scope,
      visualActionDigest,
      randomUUID,
    ),
    state = await controller.open(message);
  return {
    f,
    db,
    transaction: db.transaction,
    products,
    library,
    asset,
    identity,
    chat,
    input,
    preview,
    assistant,
    message,
    scope,
    controller,
    state,
    consent: {
      photoReviewed: action === "ASSIGN_LIBRARY",
      confirmGlobalRevoke: action === "REVOKE_CURRENT",
      restoreAssociation: false,
    },
  };
}
