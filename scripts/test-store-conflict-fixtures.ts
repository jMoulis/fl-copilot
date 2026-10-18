import { randomUUID, createHash } from "node:crypto";
import {
  storeContextSettingsSchema,
  storeConflictPreviewSchema,
  copilotVisibleStoreSettingsSchema,
  storeEventCapturePayload,
  closeStoreProductEvent,
  prepareStoreProductEvent,
} from "../packages/domain/src/index";
import {
  nativeReceiptPublicationFixture,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import { storeContextFixture } from "./test-store-context-fixtures";
import {
  applyStoreContext,
  StoreContextRepository,
} from "../apps/mobile/src/store/context-repository";
import {
  applyStoreProductEvent,
  StoreProductEventRepository,
} from "../apps/mobile/src/needs/store-event-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { buildStoreConflictMessages } from "../apps/api/src/copilot/store-conflict-messages";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { CopilotStoreConflictController } from "../apps/mobile/src/copilot/store-conflict-controller";
export function storeConflictPreview<
  T extends { id: string; storeId: string; version: number },
>(
  kind: "FIELD_EVENT" | "SETTINGS" | "NEED" | "MEMBERSHIP" | "SUBSTITUTION",
  remote: T,
) {
  const visible =
    kind === "SETTINGS"
      ? (({ position, ...rest }) => {
          void position;
          return copilotVisibleStoreSettingsSchema.parse(rest);
        })(storeContextSettingsSchema.parse(remote))
      : null;
  return storeConflictPreviewSchema.parse({
    input: { kind, entityId: kind === "SETTINGS" ? null : remote.id },
    basis: {
      storeId: remote.storeId,
      entityId: remote.id,
      remoteVersion: remote.version,
      remoteHash: createHash("sha256")
        .update(JSON.stringify(remote))
        .digest("hex"),
      event: kind === "FIELD_EVENT" ? remote : null,
      settings: visible,
      ...(kind === "NEED" ? { need: remote } : {}),
      ...(kind === "MEMBERSHIP" ? { membership: remote } : {}),
      ...(kind === "SUBSTITUTION" ? { substitution: remote } : {}),
    },
    evidence: [
      {
        id: `store-conflict/${remote.id}`,
        sourceType: "DATA_QUALITY",
        sourceId: remote.id,
        sourceVersion: remote.version,
        label: "Comparaison",
        value: "Aucune décision effectuée.",
        factKind: "QUALITY",
      },
    ],
  });
}
export async function nativeStoreConflictFixture(
  kind: "FIELD_EVENT" | "SETTINGS" = "FIELD_EVENT",
  path = ":memory:",
) {
  const s = await nativeReceiptPublicationFixture(path),
    { storeId, ownerId, deviceId } = s.scope;
  const ctx = {
    commandId: randomUUID(),
    deviceId,
    capturedAt: "2026-10-09T12:00:00.000Z",
  };
  let remote;
  const entityType =
    kind === "FIELD_EVENT" ? "store_product_event" : "store_context_settings";
  if (kind === "FIELD_EVENT") {
    const birth = prepareStoreProductEvent(storeId, {
        event: {
          id: randomUUID(),
          productId: s.product.id,
          type: "OUT_OF_STOCK",
          startedAt: "2026-10-09T09:00:00.000Z",
          clientCapturedAt: "2026-10-09T10:00:00.000Z",
        },
      }),
      repo = new StoreProductEventRepository(s.a);
    await repo.create(storeId, storeEventCapturePayload(birth), ctx);
    await applyStoreProductEvent(s.a, storeId, birth, 1);
    await s.a.runAsync(
      "UPDATE sync_outbox SET status='ACKNOWLEDGED' WHERE entity_type=?",
      entityType,
    );
    await repo.close(storeId, birth.id, "2026-10-09T11:00:00.000Z", {
      ...ctx,
      commandId: randomUUID(),
    });
    remote = closeStoreProductEvent(
      birth,
      "2026-10-09T11:30:00.000Z",
      ctx.capturedAt,
    );
  } else {
    const initial = { ...storeContextFixture(), id: storeId, storeId },
      repo = new StoreContextRepository(s.a);
    await repo.save(initial, ctx);
    await applyStoreContext(s.a, storeId, initial, 1);
    await s.a.runAsync(
      "UPDATE sync_outbox SET status='ACKNOWLEDGED' WHERE entity_type=?",
      entityType,
    );
    await repo.save(
      { ...initial, version: 2, schoolZone: "B", updatedAt: ctx.capturedAt },
      { ...ctx, commandId: randomUUID() },
    );
    remote = {
      ...initial,
      version: 2,
      schoolZone: "A" as const,
      updatedAt: ctx.capturedAt,
    };
  }
  const command = (await new OutboxRepository(s.a).listPending(storeId)).find(
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
  const table =
    kind === "FIELD_EVENT" ? "store_product_events" : "store_context_settings";
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
      canCaptureStoreEvents: true,
      canManageStoreSettings: true,
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
      state: await controller.open(message),
    },
  };
}
