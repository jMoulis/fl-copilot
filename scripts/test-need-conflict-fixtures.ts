import { randomUUID } from "node:crypto";
import {
  needUnitSchema,
  needMembershipSchema,
  productSubstitutionSchema,
  needMembershipId,
  productSubstitutionId,
} from "../packages/domain/src/index";
import {
  nativeReceiptPublicationFixture,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import { needUnitFixture } from "./test-need-unit-fixtures";
import { storeConflictPreview } from "./test-store-conflict-fixtures";
import {
  NeedUnitRepository,
  applyNeedUnit,
} from "../apps/mobile/src/needs/repository";
import {
  NeedMembershipRepository,
  applyNeedMembership,
} from "../apps/mobile/src/needs/membership-repository";
import {
  ProductSubstitutionRepository,
  applyProductSubstitution,
} from "../apps/mobile/src/needs/substitution-repository";
import { ProductMasterRepository } from "../apps/mobile/src/products/product-master-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { buildStoreConflictMessages } from "../apps/api/src/copilot/store-conflict-messages";
import { CopilotStoreConflictController } from "../apps/mobile/src/copilot/store-conflict-controller";
export const needConflictTables = {
  NEED: "need_units",
  MEMBERSHIP: "need_memberships",
  SUBSTITUTION: "product_substitutions",
} as const;
export const needConflictEntities = {
  NEED: "need_unit",
  MEMBERSHIP: "need_membership",
  SUBSTITUTION: "product_substitution",
} as const;
export async function nativeNeedConflictFixture(
  kind: keyof typeof needConflictTables = "NEED",
  path = ":memory:",
  refusal?: "LOCAL" | "REMOTE",
) {
  const s = await nativeReceiptPublicationFixture(path),
    { storeId, ownerId, deviceId } = s.scope,
    product = { ...s.product, status: "ACTIVE" as const },
    substitute = { ...product, id: randomUUID(), label: "Autre produit" },
    need = { ...needUnitFixture(), storeId },
    ctx = { deviceId, commandId: randomUUID() };
  await s.a.runAsync(
    "UPDATE products SET status='ACTIVE',sync_state='SYNCED',dirty=0,remote_version=1 WHERE id=?",
    product.id,
  );
  await new ProductMasterRepository(s.a).upsertProduct(substitute, {
    ...ctx,
    commandId: randomUUID(),
  });
  await s.a.runAsync(
    "UPDATE products SET sync_state='SYNCED',dirty=0,remote_version=1 WHERE id=?",
    substitute.id,
  );
  const needs = new NeedUnitRepository(s.a);
  await needs.save(need, ctx);
  await applyNeedUnit(s.a, storeId, need, 1);
  let remote;
  const acknowledge = async () =>
    s.a.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
  if (kind === "NEED") {
    await acknowledge();
    await needs.save(
      { ...need, name: "Besoin local", version: 2 },
      { ...ctx, commandId: randomUUID() },
    );
    remote = needUnitSchema.parse({
      ...need,
      name: "Besoin synchronisé",
      version: 2,
    });
  } else if (kind === "MEMBERSHIP") {
    const repo = new NeedMembershipRepository(s.a, receiptReviewDigest),
      initial = needMembershipSchema.parse({
        id: await needMembershipId(
          storeId,
          product.id,
          need.id,
          receiptReviewDigest,
        ),
        storeId,
        productId: product.id,
        needUnitId: need.id,
        strength: 0.8,
        confidence: 0.6,
        primary: false,
        source: "MANUAL",
        status: "VALIDATED",
        humanConfirmed: true,
        version: 1,
        createdAt: need.createdAt,
        updatedAt: need.updatedAt,
      });
    await repo.save(initial, { ...ctx, commandId: randomUUID() });
    await applyNeedMembership(s.a, storeId, initial, 1);
    await acknowledge();
    await repo.save(
      { ...initial, strength: 0.4, version: 2 },
      { ...ctx, commandId: randomUUID() },
    );
    remote = needMembershipSchema.parse({
      ...initial,
      strength: 0.9,
      version: 2,
    });
  } else {
    const repo = new ProductSubstitutionRepository(s.a, receiptReviewDigest),
      initial = productSubstitutionSchema.parse({
        id: await productSubstitutionId(
          storeId,
          product.id,
          substitute.id,
          need.id,
          receiptReviewDigest,
        ),
        storeId,
        sourceProductId: product.id,
        substituteProductId: substitute.id,
        needUnitId: need.id,
        needCompatibility: 0.8,
        usageCompatibility: 0.7,
        priceCompatibility: null,
        packagingCompatibility: null,
        observedSubstitution: null,
        relationshipScore: null,
        confidence: null,
        evidenceCount: 0,
        lastEvidenceAt: null,
        status: "VALIDATED",
        source: "MANUAL",
        humanConfirmed: true,
        version: 1,
        createdAt: need.createdAt,
        updatedAt: need.updatedAt,
      });
    await repo.save(initial, { ...ctx, commandId: randomUUID() });
    await applyProductSubstitution(s.a, storeId, initial, 1);
    await acknowledge();
    await repo.save(
      { ...initial, needCompatibility: 0.4, version: 2 },
      { ...ctx, commandId: randomUUID() },
    );
    remote = productSubstitutionSchema.parse({
      ...initial,
      needCompatibility: 0.9,
      version: 2,
      observedSubstitution: 0.6,
      relationshipScore: 0.7,
      confidence: 0.8,
      evidenceCount: 4,
      lastEvidenceAt: need.updatedAt,
    });
  }
  if (refusal === "REMOTE" && kind !== "NEED")
    remote = { ...remote, status: "REJECTED" };
  const entityType = needConflictEntities[kind],
    table = needConflictTables[kind],
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
  if (refusal === "LOCAL" && kind !== "NEED")
    await s.a.runAsync(
      `UPDATE ${table} SET payload_json=json_set(payload_json,'$.status','REJECTED') WHERE id=?`,
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
      canCaptureStoreEvents: false,
      canManageStoreSettings: false,
      canManageProducts: true,
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
      remote,
      preview,
      message,
      scope,
      controller,
      conflict,
      entityType,
      table,
      command,
      product,
      substitute,
      need,
      state: await controller.open(message),
    },
  };
}
