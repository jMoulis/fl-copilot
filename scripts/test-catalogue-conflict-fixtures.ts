import { randomUUID } from "node:crypto";
import {
  productSchema,
  productAliasSchema,
  productIdentifierSchema,
  normalizeProductLabel,
  catalogueConflictTypes,
  catalogueConflictTables,
  type CatalogueConflictKind,
} from "../packages/domain/src/index";
import {
  nativeReceiptPublicationFixture,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import { ProductMasterRepository } from "../apps/mobile/src/products/product-master-repository";
import { applyProductMasterChange } from "../apps/mobile/src/products/apply-product-master";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { storeConflictPreview } from "./test-store-conflict-fixtures";
import { buildStoreConflictMessages } from "../apps/api/src/copilot/store-conflict-messages";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { CopilotStoreConflictController } from "../apps/mobile/src/copilot/store-conflict-controller";
export async function nativeCatalogueConflictFixture(
  kind: CatalogueConflictKind,
  path = ":memory:",
  reversal?: "LOCAL" | "REMOTE",
  remoteDeleted = false,
) {
  const s = await nativeReceiptPublicationFixture(path),
    { storeId, ownerId, deviceId } = s.scope,
    repo = new ProductMasterRepository(s.a),
    ctx = () => ({ commandId: randomUUID(), deviceId }),
    product = productSchema.parse({
      ...s.product,
      status: "ACTIVE",
      category: "FRUIT",
      nature: "BULK",
      salesUnit: "KG",
    });
  await repo.upsertProduct(product, ctx());
  const alias = productAliasSchema.parse({
      id: randomUUID(),
      storeId,
      productId: product.id,
      alias: "Figues jaunes",
      normalizedAlias: normalizeProductLabel("Figues jaunes"),
      source: "USER",
      status: "TO_REVIEW",
      confidence: 0.4,
      version: 1,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      deletedAt: null,
    }),
    identifier = productIdentifierSchema.parse({
      id: randomUUID(),
      storeId,
      productId: product.id,
      type: "PLU",
      value: "00042",
      source: "USER",
      status: "TO_REVIEW",
      version: 1,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      deletedAt: null,
    });
  await repo.upsertIdentifier(identifier, ctx());
  await repo.upsertAlias(alias, ctx());
  for (const [entityType, entity] of [
    ["product", product],
    ["product_identifier", identifier],
    ["product_alias", alias],
  ] as const)
    await applyProductMasterChange(
      s.a,
      storeId,
      {
        entityType,
        entityId: entity.id,
        entityVersion: 1,
        operation: "UPSERT",
        entity,
      },
      1,
    );
  await s.a.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
  const local =
      kind === "PRODUCT"
        ? productSchema.parse({
            ...product,
            label: "FIGUE LOCALE VRAC",
            version: 2,
            status: reversal === "LOCAL" ? "INACTIVE" : "ACTIVE",
          })
        : kind === "IDENTIFIER"
          ? productIdentifierSchema.parse({
              ...identifier,
              status: "VALIDATED",
              version: 2,
            })
          : productAliasSchema.parse({
              ...alias,
              status: reversal === "LOCAL" ? "REJECTED" : "VALIDATED",
              version: 2,
            }),
    remote =
      kind === "PRODUCT"
        ? productSchema.parse({
            ...product,
            label: "FIGUE SYNCHRONISÉE VRAC",
            version: 2,
            deletedAt: remoteDeleted ? "2026-10-20T18:00:00.000Z" : null,
            status: reversal === "REMOTE" ? "INACTIVE" : "ACTIVE",
          })
        : kind === "IDENTIFIER"
          ? productIdentifierSchema.parse({
              ...identifier,
              status: "TO_REVIEW",
              version: 2,
              deletedAt: remoteDeleted ? "2026-10-20T18:00:00.000Z" : null,
            })
          : productAliasSchema.parse({
              ...alias,
              status:
                reversal === "REMOTE"
                  ? "REJECTED"
                  : reversal === "LOCAL"
                    ? "VALIDATED"
                    : "TO_REVIEW",
              confidence: 0.8,
              version: 2,
              deletedAt: remoteDeleted ? "2026-10-20T18:00:00.000Z" : null,
            });
  if (kind === "PRODUCT")
    await repo.upsertProduct(productSchema.parse(local), {
      ...ctx(),
      expectedRemoteVersion: 1,
    });
  else if (kind === "IDENTIFIER")
    await repo.upsertIdentifier(productIdentifierSchema.parse(local), {
      ...ctx(),
      expectedRemoteVersion: 1,
    });
  else
    await repo.upsertAlias(productAliasSchema.parse(local), {
      ...ctx(),
      expectedRemoteVersion: 1,
    });
  const entityType = catalogueConflictTypes[kind],
    table = catalogueConflictTables[kind],
    command = (await new OutboxRepository(s.a).listPending(storeId)).find(
      (c) => c.entityType === entityType,
    )!;
  const conflict = await new ConflictRepository(s.a).recordPushConflict(
    command,
    {
      commandId: command.commandId,
      status: "CONFLICT",
      entityType,
      entityId: remote.id,
      remoteVersion: remote.version,
      remoteEntity: remote,
    },
  );
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  await s.a.runAsync(
    `UPDATE ${table} SET sync_state='CONFLICT' WHERE id=?`,
    remote.id,
  );
  const preview = storeConflictPreview(kind, remote),
    message = buildStoreConflictMessages(s.f.assistant, [preview])[0]!;
  await s.a.withExclusiveTransactionAsync((tx) =>
    applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
  );
  const scope = {
      storeId,
      ownerId,
      deviceId,
      canManageProducts: true,
      canCaptureStoreEvents: false,
      canManageStoreSettings: false,
    },
    controller = new CopilotStoreConflictController(
      s.a,
      scope,
      receiptReviewDigest,
      randomUUID,
    );
  return {
    ...s,
    review: {
      kind,
      local,
      remote,
      product,
      identifier,
      alias,
      preview,
      message,
      scope,
      controller,
      conflict,
      entityType,
      table,
      command,
      state: await controller.open(message),
    },
  };
}
