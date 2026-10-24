import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { nativeCatalogueConflictFixture } from "../../../../scripts/test-catalogue-conflict-fixtures";
import { receiptReviewDigest } from "../../../../scripts/test-receipt-publication-sqlite";
import { MobileSyncService } from "../sync/sync-service";
import { ProductMasterRepository } from "./product-master-repository";
import { ProductMasterConflictRepository } from "./conflict-repository";
import { syncPushResponseSchema } from "@fl-copilot/sync-contracts";
for (const kind of ["PRODUCT", "IDENTIFIER", "ALIAS"] as const)
  it(`${kind} becomes reviewable when the real mobile push persists a conflict`, async () => {
    const s = await nativeCatalogueConflictFixture(kind),
      r = s.review;
    try {
      // Start immediately before the actual push result, rather than pre-setting
      // the entity's CONFLICT state as the older controller fixtures did.
      await s.a.runAsync(
        "DELETE FROM sync_conflicts WHERE entity_id=?",
        r.local.id,
      );
      await s.a.runAsync(
        `UPDATE ${r.table} SET sync_state='PENDING' WHERE id=?`,
        r.local.id,
      );
      await s.a.runAsync(
        "UPDATE sync_outbox SET status='PENDING' WHERE command_id=?",
        r.command.commandId,
      );
      const service = new MobileSyncService(
        s.a,
        {
          push: async (request) =>
            syncPushResponseSchema.parse({
              protocolVersion: 1,
              serverTime: new Date().toISOString(),
              results: request.commands.map((c) => ({
                commandId: c.commandId,
                entityType: c.entityType,
                entityId: c.entityId,
                status: "CONFLICT",
                remoteVersion: 2,
                remoteEntity: r.remote,
                error: {
                  code: "SYNC_VERSION_CONFLICT",
                  messageFr: "Modification concurrente.",
                  retryable: false,
                  requestId: randomUUID(),
                },
              })),
            }),
          bootstrap: async () => {
            throw Error("NOT_USED");
          },
          pull: async () => {
            throw Error("NOT_USED");
          },
        },
        { appVersion: "test", deviceId: s.scope.deviceId },
      );
      expect((await service.push(s.scope.storeId)).conflicts).toBe(1);
      const repo = new ProductMasterRepository(s.a),
        current =
          kind === "PRODUCT"
            ? await repo.getProduct(r.local.id)
            : kind === "IDENTIFIER"
              ? await repo.getIdentifier(r.local.id)
              : await repo.getAlias(r.local.id);
      expect(current!.syncState).toBe("CONFLICT");
      const review = await new ProductMasterConflictRepository(
        s.a,
        receiptReviewDigest,
      ).review(s.scope.storeId, r.conflict.id);
      expect(review.canKeep).toBe(true);
      expect(review.canAdopt).toBe(true);
      expect(review.current.entity).toEqual(r.local);
      expect(review.remote).toEqual(r.remote);
    } finally {
      s.db.close();
    }
  });
it("rolls back the catalogue state when the push result cannot be bound to its command", async () => {
  const s = await nativeCatalogueConflictFixture("ALIAS"),
    r = s.review;
  try {
    await s.a.runAsync(
      "DELETE FROM sync_conflicts WHERE entity_id=?",
      r.local.id,
    );
    await s.a.runAsync(
      "UPDATE product_aliases SET sync_state='PENDING' WHERE id=?",
      r.local.id,
    );
    await s.a.runAsync(
      "UPDATE sync_outbox SET status='PENDING' WHERE command_id=?",
      r.command.commandId,
    );
    const before = s.db
      .prepare("SELECT * FROM product_aliases ORDER BY id")
      .all();
    const service = new MobileSyncService(
      s.a,
      {
        push: async (request) =>
          syncPushResponseSchema.parse({
            protocolVersion: 1,
            serverTime: new Date().toISOString(),
            results: request.commands.map((c) => ({
              commandId: c.commandId,
              entityType: c.entityType,
              entityId: randomUUID(),
              status: "CONFLICT",
              remoteVersion: 2,
              remoteEntity: r.remote,
            })),
          }),
        bootstrap: async () => {
          throw Error("NOT_USED");
        },
        pull: async () => {
          throw Error("NOT_USED");
        },
      },
      { appVersion: "test", deviceId: s.scope.deviceId },
    );
    await expect(service.push(s.scope.storeId)).rejects.toThrow(
      "Conflict result does not match",
    );
    expect(
      s.db.prepare("SELECT * FROM product_aliases ORDER BY id").all(),
    ).toEqual(before);
    expect(
      s.db
        .prepare("SELECT COUNT(*) n FROM sync_conflicts WHERE status='OPEN'")
        .get()!.n,
    ).toBe(0);
  } finally {
    s.db.close();
  }
});
