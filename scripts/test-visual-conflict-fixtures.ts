import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { visualLibraryFixture } from "./test-visual-library-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import { ProductMasterRepository } from "../apps/mobile/src/products/product-master-repository";
import {
  VisualLibraryRepository,
  applyVisualEntity,
  visualTables,
} from "../apps/mobile/src/products/visual-library-repository";
import { VisualConflictRepository } from "../apps/mobile/src/products/visual-conflict-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import {
  visualEntitySchemas,
  type VisualEntityType,
  type VisualEntityMap,
} from "../packages/domain/src/index";
export const visualConflictKinds = [
  "visual_asset",
  "visual_identity",
  "product_visual_link",
] as const;
export async function nativeVisualConflictFixture(
  kind: VisualEntityType,
  path = ":memory:",
  retired?: "LOCAL" | "REMOTE",
) {
  const db = new DatabaseSync(path),
    a = new ReceiptTestDatabase(db),
    f = visualLibraryFixture(),
    at = "2026-10-20T12:00:00.000Z",
    otherActor = randomUUID();
  await runLocalMigrations(a);
  await new ProductMasterRepository(a).upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  for (const [type, entity] of [
    ["visual_asset", f.asset],
    ["visual_identity", f.identity],
    ["product_visual_link", f.link],
  ] as const)
    await applyVisualEntity(a, f.storeId, type, entity);
  const base =
    kind === "visual_asset"
      ? f.asset
      : kind === "visual_identity"
        ? f.identity
        : f.link;
  const version = (actor: string, local: boolean) =>
    visualEntitySchemas[kind].parse({
      ...base,
      version: 2,
      updatedAt: at,
      updatedBy: actor,
      deletedAt: retired === (local ? "LOCAL" : "REMOTE") ? at : null,
      ...("canonicalName" in base
        ? { canonicalName: local ? "Tomate locale" : "Tomate distante" }
        : {}),
      ...("review" in base
        ? { review: { ...base.review, actorId: actor, at } }
        : {}),
      ...("verification" in base ? { verifiedBy: actor, verifiedAt: at } : {}),
    }) as VisualEntityMap[VisualEntityType];
  const local = version(f.actorId, true),
    remote = version(otherActor, false),
    library = new VisualLibraryRepository(a),
    outbox = new OutboxRepository(a),
    commandId = randomUUID();
  await library.save(kind, local, {
    commandId,
    storeId: f.storeId,
    actorId: f.actorId,
    deviceId: f.deviceId,
    canWrite: true,
    expectedLocalVersion: 1,
  });
  const command = (await outbox.getById(commandId))!;
  await outbox.markSyncing(commandId);
  const conflict = await new ConflictRepository(a).recordPushConflict(command, {
    commandId,
    entityType: kind,
    entityId: base.id,
    status: "CONFLICT",
    remoteVersion: 2,
    remoteEntity: remote,
  });
  await outbox.markConflict(commandId, "VISUAL_VERSION_CONFLICT");
  await a.runAsync(
    `UPDATE ${visualTables[kind]} SET sync_state='CONFLICT' WHERE id=?`,
    base.id,
  );
  await applyVisualEntity(a, f.storeId, kind, remote);
  const repo = new VisualConflictRepository(
      a,
      receiptReviewDigest,
      () => "2026-10-24T12:00:00.000Z",
    ),
    scope = { storeId: f.storeId, ownerId: f.actorId, deviceId: f.deviceId },
    count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
  return {
    db,
    a,
    f,
    library,
    outbox,
    scope,
    count,
    kind,
    review: {
      table: visualTables[kind],
      local,
      remote,
      command,
      conflict,
      repo,
    },
    context: (reviewHash: string) => ({
      actorId: f.actorId,
      commandId: randomUUID(),
      deviceId: f.deviceId,
      reviewHash,
      rightsConfirmed: true,
      canResolve: () => true,
    }),
  };
}
