import { randomUUID } from "node:crypto";
import { layoutFixture, nextLayout } from "./test-store-layout-fixtures";
import {
  nativeReceiptPublicationFixture,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import {
  StoreLayoutRepository,
  applyStoreLayout,
} from "../apps/mobile/src/store/layout-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";

export async function nativeLayoutConflictFixture(path = ":memory:") {
  const s = await nativeReceiptPublicationFixture(path),
    base = layoutFixture(s.scope.storeId, s.scope.ownerId),
    repository = new StoreLayoutRepository(
      s.a,
      randomUUID,
      () => base.updatedAt,
      receiptReviewDigest,
    ),
    context = {
      actorId: s.scope.ownerId,
      deviceId: s.scope.deviceId,
      commandId: randomUUID(),
      canWrite: true as const,
    };
  await applyStoreLayout(s.a, base.storeId, base);
  const local = await repository.save(
      {
        storeId: base.storeId,
        action: "SAVE_DRAFT",
        expectedRevisionId: base.revisionId,
        content: {
          ...base.content,
          provenance: { kind: "USER", reference: null },
        },
      },
      context,
    ),
    remote = nextLayout(base),
    command = (await new OutboxRepository(s.a).listPending(base.storeId)).find(
      (c) => c.entityType === "store_layout",
    )!;
  await applyStoreLayout(s.a, base.storeId, remote);
  const conflict = await new ConflictRepository(s.a).recordPushConflict(
    command,
    {
      commandId: command.commandId,
      status: "CONFLICT",
      entityId: base.id,
      entityType: "store_layout",
      remoteEntity: remote,
      remoteVersion: remote.version,
    },
  );
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  await s.a.runAsync(
    "UPDATE store_layouts SET sync_state='CONFLICT' WHERE id=?",
    base.id,
  );
  return {
    ...s,
    repository,
    context,
    base,
    review: { kind: "LAYOUT" as const, local, remote, conflict, command },
  };
}
