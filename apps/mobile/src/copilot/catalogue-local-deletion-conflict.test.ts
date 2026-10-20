import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { nativeCatalogueConflictFixture } from "../../../../scripts/test-catalogue-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotStoreConflictController } from "./store-conflict-controller";
import { ProductMasterConflictRepository } from "../products/conflict-repository";
import { applyProductMasterChange } from "../products/apply-product-master";
import { OutboxRepository } from "../sync/outbox-repository";
const kinds = ["PRODUCT", "IDENTIFIER", "ALIAS"] as const;
const decisions = ["KEEP_LOCAL", "ADOPT_REMOTE"] as const;
const cases = kinds.flatMap((kind) =>
  decisions.map((decision) => ({ kind, decision })),
);
it.each(cases)(
  "resolves a local $kind deletion with explicit $decision consent, preserving evidence and exactly one durable command when needed",
  async ({ kind, decision }) => {
    const dir = await mkdtemp(join(tmpdir(), "fl-local-deletion-")),
      path = join(dir, "local.sqlite"),
      s = await nativeCatalogueConflictFixture(
        kind,
        path,
        undefined,
        false,
        true,
      );
    let closed = false;
    try {
      const r = s.review,
        before = s.db
          .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
          .all(),
        untouched = [
          "products",
          "product_identifiers",
          "product_aliases",
          "source_documents",
          "sales_observations",
          "waste_observations",
          "waste_lines",
        ].filter((t) => t !== r.table),
        data = untouched.map((t) => s.db.prepare(`SELECT * FROM ${t}`).all());
      expect(r.command.commandType).toBe(
        `${r.entityType.toUpperCase()}_DELETE`,
      );
      expect(r.local.deletedAt).toBeTruthy();
      expect(r.state).toMatchObject({
        status: "READY",
        review: {
          canKeepLocal: true,
          canAdoptRemote: true,
          cataloguePolicy: { localDeleted: true, remoteDeleted: false },
        },
      });
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          decision,
          true,
        ),
      ).rejects.toThrow("LOCAL_DELETION_CONFIRMATION_REQUIRED");
      expect(
        s.db.prepare("SELECT * FROM sync_outbox ORDER BY local_sequence").all(),
      ).toEqual(before);
      expect(s.count("product_master_conflict_history")).toBe(0);
      const result = await r.controller.confirm(
        r.message,
        r.state.review!.basisHash,
        decision,
        true,
        undefined,
        { confirmLocalDeletionChoice: true },
      );
      expect(result).toMatchObject({
        status: "COMPLETED",
        result: {
          confirmLocalDeletionChoice: true,
          syncState: decision === "KEEP_LOCAL" ? "PENDING" : "SYNCED",
        },
      });
      const row = s.db
        .prepare(
          `SELECT deleted_at,version,remote_version,dirty,sync_state FROM ${r.table} WHERE id=?`,
        )
        .get(r.remote.id)!;
      expect(row).toMatchObject({
        version: decision === "KEEP_LOCAL" ? 3 : 2,
        remote_version: 2,
        dirty: decision === "KEEP_LOCAL" ? 1 : 0,
        sync_state: decision === "KEEP_LOCAL" ? "PENDING" : "SYNCED",
      });
      expect(!!row.deleted_at).toBe(decision === "KEEP_LOCAL");
      const pending = await new OutboxRepository(s.a).listPending(
        s.scope.storeId,
      );
      expect(pending).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
      if (decision === "KEEP_LOCAL") {
        expect(pending[0]).toMatchObject({
          entityId: r.remote.id,
          commandType: `${r.entityType.toUpperCase()}_DELETE`,
          expectedRemoteVersion: 2,
          payload: { id: r.remote.id, storeId: s.scope.storeId, version: 3 },
        });
        expect(pending[0]!.commandId).not.toBe(r.command.commandId);
        expect(Object.keys(pending[0]!.payload as object).sort()).toEqual([
          "deletedAt",
          "id",
          "storeId",
          "version",
        ]);
      }
      const history = s.db
        .prepare("SELECT * FROM product_master_conflict_history")
        .get()!;
      expect(JSON.parse(history.local_json as string)).toEqual(r.local);
      expect(JSON.parse(history.remote_json as string)).toEqual(r.remote);
      expect(history.decision).toBe(decision);
      expect(JSON.parse(history.resolved_json as string).deletedAt).toBe(
        row.deleted_at,
      );
      expect(
        untouched.map((t) => s.db.prepare(`SELECT * FROM ${t}`).all()),
      ).toEqual(data);
      for (const c of before)
        if (c.status !== "ACKNOWLEDGED")
          expect(
            s.db
              .prepare(
                "SELECT status,last_error_code FROM sync_outbox WHERE command_id=?",
              )
              .get(c.command_id),
          ).toMatchObject({
            status: "FAILED",
            last_error_code: "PRODUCT_MASTER_CONFLICT_SUPERSEDED",
          });
      const after = s.db
        .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
        .all();
      s.db.close();
      closed = true;
      const db = new DatabaseSync(path);
      try {
        const controller = new CopilotStoreConflictController(
          new ReceiptTestDatabase(db),
          r.scope,
          receiptReviewDigest,
          randomUUID,
        );
        expect((await controller.open(r.message)).status).toBe("COMPLETED");
        expect(
          (
            await controller.confirm(
              r.message,
              r.state.review!.basisHash,
              decision,
              true,
            )
          ).status,
        ).toBe("COMPLETED");
        await expect(
          controller.confirm(
            r.message,
            r.state.review!.basisHash,
            decision === "KEEP_LOCAL" ? "ADOPT_REMOTE" : "KEEP_LOCAL",
            true,
          ),
        ).rejects.toThrow("DECISION_CHANGED");
        expect(
          db.prepare("SELECT * FROM sync_outbox ORDER BY local_sequence").all(),
        ).toEqual(after);
      } finally {
        db.close();
      }
    } finally {
      if (!closed) s.db.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
it.each(cases)(
  "uses the same manual $kind / $decision resolver after a matching remote update",
  async ({ kind, decision }) => {
    const s = await nativeCatalogueConflictFixture(
      kind,
      ":memory:",
      undefined,
      false,
      true,
    );
    try {
      const r = s.review,
        repo = new ProductMasterConflictRepository(s.a, receiptReviewDigest);
      await applyProductMasterChange(s.a, s.scope.storeId, {
        entityType: r.entityType,
        entityId: r.remote.id,
        entityVersion: r.remote.version,
        operation: "UPSERT",
        entity: r.remote,
      });
      const review = await repo.review(s.scope.storeId, r.conflict.id),
        ctx = {
          commandId: randomUUID(),
          deviceId: s.scope.deviceId,
          jobId: randomUUID(),
          reviewHash: review.hash,
          canResolve: () => true,
        };
      await expect(
        repo.resolve(
          s.scope.storeId,
          r.conflict.id,
          decision === "KEEP_LOCAL",
          ctx,
        ),
      ).rejects.toThrow("LOCAL_DELETION_CONFIRMATION_REQUIRED");
      await repo.resolve(
        s.scope.storeId,
        r.conflict.id,
        decision === "KEEP_LOCAL",
        { ...ctx, confirmLocalDeletionChoice: true },
      );
      expect(s.count("product_master_conflict_history")).toBe(1);
      expect(
        (await new OutboxRepository(s.a).listPending(s.scope.storeId)).length,
      ).toBe(decision === "KEEP_LOCAL" ? 1 : 0);
    } finally {
      s.db.close();
    }
  },
);
it.each(decisions)(
  "rolls back $s deletion decisions on late failure, role loss or cancellation",
  async (decision) => {
    for (const mode of ["late", "authority", "cancel"]) {
      const s = await nativeCatalogueConflictFixture(
        "PRODUCT",
        ":memory:",
        undefined,
        false,
        true,
      );
      try {
        const r = s.review,
          repo = new ProductMasterConflictRepository(s.a, receiptReviewDigest),
          review = await repo.review(s.scope.storeId, r.conflict.id),
          tables = [
            "products",
            "sync_outbox",
            "sync_conflicts",
            "product_master_remote_snapshots",
            "product_master_conflict_history",
          ],
          before = tables.map((t) => s.db.prepare(`SELECT * FROM ${t}`).all());
        if (mode === "late")
          s.db.exec(
            "CREATE TRIGGER reject_local_deletion_history BEFORE INSERT ON product_master_conflict_history BEGIN SELECT RAISE(ABORT,'TEST_LATE_FAILURE'); END;",
          );
        const abort = new AbortController();
        if (mode === "cancel") abort.abort();
        let checks = 0;
        await expect(
          repo.resolve(
            s.scope.storeId,
            r.conflict.id,
            decision === "KEEP_LOCAL",
            {
              commandId: randomUUID(),
              deviceId: s.scope.deviceId,
              jobId: randomUUID(),
              reviewHash: review.hash,
              canResolve: () => mode !== "authority" || ++checks === 1,
              signal: abort.signal,
              confirmLocalDeletionChoice: true,
            },
          ),
        ).rejects.toThrow();
        expect(
          tables.map((t) => s.db.prepare(`SELECT * FROM ${t}`).all()),
        ).toEqual(before);
      } finally {
        s.db.close();
      }
    }
  },
);
it.each(["PRODUCT", "ALIAS"] as const)(
  "requires separate status reactivation when cancelling a local %s deletion",
  async (kind) => {
    const s = await nativeCatalogueConflictFixture(
      kind,
      ":memory:",
      "LOCAL",
      false,
      true,
    );
    try {
      const r = s.review,
        consent =
          kind === "PRODUCT"
            ? { activateProduct: true }
            : { reactivateRejected: true };
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          "ADOPT_REMOTE",
          true,
          undefined,
          { confirmLocalDeletionChoice: true },
        ),
      ).rejects.toThrow();
      expect(s.count("product_master_conflict_history")).toBe(0);
      const result = await r.controller.confirm(
        r.message,
        r.state.review!.basisHash,
        "ADOPT_REMOTE",
        true,
        undefined,
        { confirmLocalDeletionChoice: true, ...consent },
      );
      expect(result).toMatchObject({
        status: "COMPLETED",
        result: { confirmLocalDeletionChoice: true, ...consent },
      });
      expect((await r.controller.open(r.message)).status).toBe("COMPLETED");
    } finally {
      s.db.close();
    }
  },
);
it("does not bypass a newer remote deletion or changed identity, and deletes an identity without reactivating its parent", async () => {
  for (const mode of ["newer", "reassigned", "inactive-parent"]) {
    const s = await nativeCatalogueConflictFixture(
      "IDENTIFIER",
      ":memory:",
      undefined,
      false,
      true,
    );
    try {
      const r = s.review,
        repo = new ProductMasterConflictRepository(s.a, receiptReviewDigest);
      if (mode === "newer")
        await applyProductMasterChange(s.a, s.scope.storeId, {
          entityType: r.entityType,
          entityId: r.remote.id,
          entityVersion: 3,
          operation: "DELETE",
        });
      if (mode === "reassigned")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET remote_payload_json=? WHERE id=?",
          JSON.stringify({ ...r.remote, productId: randomUUID() }),
          r.conflict.id,
        );
      if (mode === "inactive-parent")
        await s.a.runAsync(
          "UPDATE products SET status='INACTIVE' WHERE id=?",
          r.product.id,
        );
      const review = await repo.review(s.scope.storeId, r.conflict.id);
      expect(review.canKeep).toBe(mode === "inactive-parent");
      if (mode === "inactive-parent") {
        await repo.resolve(s.scope.storeId, r.conflict.id, true, {
          commandId: randomUUID(),
          deviceId: s.scope.deviceId,
          jobId: randomUUID(),
          reviewHash: review.hash,
          canResolve: () => true,
          confirmLocalDeletionChoice: true,
        });
        expect(
          s.db
            .prepare("SELECT status FROM products WHERE id=?")
            .get(r.product.id),
        ).toEqual({ status: "INACTIVE" });
      }
    } finally {
      s.db.close();
    }
  }
});
