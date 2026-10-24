import { randomUUID } from "node:crypto";
import {
  productSchema,
  productAliasSchema,
  productIdentifierSchema,
} from "@fl-copilot/domain";
import { expect, it } from "vitest";
import { syncPushResponseSchema } from "@fl-copilot/sync-contracts";
import { nativeCatalogueConflictFixture } from "../../../../scripts/test-catalogue-conflict-fixtures";
import { MobileSyncService } from "../sync/sync-service";
import { ProductMasterRepository } from "./product-master-repository";

for (const kind of ["PRODUCT", "IDENTIFIER", "ALIAS"] as const)
  it(`${kind} exposes a permanent push rejection without changing the saved business values`, async () => {
    const s = await nativeCatalogueConflictFixture(kind),
      r = s.review;
    try {
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
      const before = s.db
        .prepare(`SELECT * FROM ${r.table} WHERE id=?`)
        .get(r.local.id)!;
      let calls = 0;
      const service = new MobileSyncService(
        s.a,
        {
          push: async (request) => {
            calls++;
            return syncPushResponseSchema.parse({
              protocolVersion: 1,
              serverTime: new Date().toISOString(),
              results: request.commands.map((c) => ({
                commandId: c.commandId,
                entityType: c.entityType,
                entityId: c.entityId,
                status: "REJECTED",
                error: {
                  code: "STORE_ROLE_FORBIDDEN",
                  messageFr: "Droits insuffisants.",
                  retryable: false,
                  requestId: randomUUID(),
                },
              })),
            });
          },
          bootstrap: async () => {
            throw Error("NOT_USED");
          },
          pull: async () => {
            throw Error("NOT_USED");
          },
        },
        { appVersion: "test", deviceId: s.scope.deviceId },
      );
      expect(await service.push(s.scope.storeId)).toEqual({
        pushed: 0,
        conflicts: 0,
        failed: 1,
      });
      const repo = new ProductMasterRepository(s.a);
      const current =
        kind === "PRODUCT"
          ? await repo.getProduct(r.local.id)
          : kind === "IDENTIFIER"
            ? await repo.getIdentifier(r.local.id)
            : await repo.getAlias(r.local.id);
      expect(current!.syncState).toBe("ERROR");
      expect(
        s.db.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(r.local.id),
      ).toEqual({ ...before, sync_state: "ERROR" });
      expect(
        s.db
          .prepare(
            "SELECT status,last_error_code,payload_json FROM sync_outbox WHERE command_id=?",
          )
          .get(r.command.commandId),
      ).toEqual({
        status: "FAILED",
        last_error_code: "STORE_ROLE_FORBIDDEN",
        payload_json: JSON.stringify(r.command.payload),
      });
      expect(await service.push(s.scope.storeId)).toEqual({
        pushed: 0,
        conflicts: 0,
        failed: 0,
      });
      expect(calls).toBe(1);
    } finally {
      s.db.close();
    }
  });

for (const kind of ["PRODUCT", "IDENTIFIER", "ALIAS"] as const) {
  for (const scenario of ["TRANSIENT", "NEWER", "ROLLBACK"] as const)
    it(`${kind} preserves pending data and atomicity for ${scenario} rejection handling`, async () => {
      const s = await nativeCatalogueConflictFixture(kind),
        r = s.review;
      try {
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
        const before = s.db
          .prepare(`SELECT * FROM ${r.table} WHERE id=?`)
          .get(r.local.id)!;
        const originals = () =>
          [
            "source_documents",
            "local_files",
            "source_records",
            "waste_receipts",
            "waste_lines",
            "sales_observations",
            "waste_observations",
          ].map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY id`).all());
        const sourceBefore = originals();
        const nextId = randomUUID();
        let nextRow: unknown;
        let calls = 0;
        if (scenario === "ROLLBACK")
          s.db.exec(
            "CREATE TRIGGER reject_terminal BEFORE UPDATE OF status ON sync_outbox WHEN NEW.status='FAILED' BEGIN SELECT RAISE(ABORT,'test terminal failure'); END",
          );
        const service = new MobileSyncService(
          s.a,
          {
            push: async (request) => {
              calls++;
              if (scenario === "NEWER" && calls === 1) {
                const repo = new ProductMasterRepository(s.a),
                  value = { ...r.local, version: r.local.version + 1 };
                const ctx = {
                  commandId: nextId,
                  deviceId: s.scope.deviceId,
                  expectedRemoteVersion: 1,
                };
                if (kind === "PRODUCT")
                  await repo.upsertProduct(productSchema.parse(value), ctx);
                else if (kind === "IDENTIFIER")
                  await repo.upsertIdentifier(
                    productIdentifierSchema.parse(value),
                    ctx,
                  );
                else
                  await repo.upsertAlias(productAliasSchema.parse(value), ctx);
                nextRow = s.db
                  .prepare(`SELECT * FROM ${r.table} WHERE id=?`)
                  .get(r.local.id);
              }
              return syncPushResponseSchema.parse({
                protocolVersion: 1,
                serverTime: new Date().toISOString(),
                results: request.commands.map((c) => ({
                  commandId: c.commandId,
                  entityType: c.entityType,
                  entityId: c.entityId,
                  status:
                    scenario === "TRANSIENT" || c.commandId === nextId
                      ? "RETRYABLE_ERROR"
                      : "REJECTED",
                  error: {
                    code: "STORE_ROLE_FORBIDDEN",
                    messageFr: "Envoi refusé.",
                    retryable:
                      scenario === "TRANSIENT" || c.commandId === nextId,
                    requestId: randomUUID(),
                  },
                })),
              });
            },
            bootstrap: async () => {
              throw Error("NOT_USED");
            },
            pull: async () => {
              throw Error("NOT_USED");
            },
          },
          { appVersion: "test", deviceId: s.scope.deviceId, maxRetries: 0 },
        );
        if (scenario === "ROLLBACK")
          await expect(service.push(s.scope.storeId)).rejects.toThrow(
            "test terminal failure",
          );
        else await service.push(s.scope.storeId);
        expect(originals()).toEqual(sourceBefore);
        expect(
          s.db.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(r.local.id),
        ).toEqual(scenario === "NEWER" ? nextRow : before);
        const old = s.db
          .prepare("SELECT status FROM sync_outbox WHERE command_id=?")
          .get(r.command.commandId)!;
        expect(old.status).toBe(
          scenario === "TRANSIENT"
            ? "PENDING"
            : scenario === "ROLLBACK"
              ? "SYNCING"
              : "FAILED",
        );
        if (scenario === "NEWER")
          expect(
            s.db
              .prepare("SELECT status FROM sync_outbox WHERE command_id=?")
              .get(nextId)!.status,
          ).toBe("PENDING");
      } finally {
        s.db.close();
      }
    });
}
