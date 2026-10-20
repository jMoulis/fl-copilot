import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { readStoreConflictProposal } from "@fl-copilot/domain";
import { nativeCatalogueConflictFixture } from "../../../../scripts/test-catalogue-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotStoreConflictController } from "./store-conflict-controller";
import {
  ProductMasterConflictRepository,
  readCatalogueConflictPolicy,
} from "../products/conflict-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { applyProductMasterChange } from "../products/apply-product-master";
const kinds = ["PRODUCT", "IDENTIFIER", "ALIAS"] as const;
it.each(kinds)(
  "accepts a proven remote %s deletion explicitly, preserves local history and reopens without replaying any mutation",
  async (kind) => {
    const dir = await mkdtemp(join(tmpdir(), "fl-deleted-catalogue-")),
      path = join(dir, "local.sqlite"),
      s = await nativeCatalogueConflictFixture(kind, path, undefined, true);
    let closed = false;
    try {
      const r = s.review,
        before = s.db
          .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
          .all(),
        tables = [
          "sales_observations",
          "waste_observations",
          "source_documents",
          "waste_lines",
        ],
        data = tables.map((t) => s.db.prepare(`SELECT * FROM ${t}`).all());
      expect(r.state.status).toBe("READY");
      expect(r.state.review).toMatchObject({
        canKeepLocal: false,
        canAdoptRemote: true,
        cataloguePolicy: {
          remoteDeleted: true,
          activateRemote: false,
          reactivateRemote: false,
        },
      });
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          "ADOPT_REMOTE",
          true,
        ),
      ).rejects.toThrow("DELETION_CONFIRMATION_REQUIRED");
      expect(s.count("product_master_conflict_history")).toBe(0);
      expect(
        s.db.prepare("SELECT * FROM sync_outbox ORDER BY local_sequence").all(),
      ).toEqual(before);
      const result = await r.controller.confirm(
        r.message,
        r.state.review!.basisHash,
        "ADOPT_REMOTE",
        true,
        undefined,
        {
          reactivateRejected: false,
          retainWithdrawn: false,
          activateProduct: false,
          acceptRemoteDeletion: true,
        },
      );
      expect(result).toMatchObject({
        status: "COMPLETED",
        result: { acceptRemoteDeletion: true, syncState: "SYNCED" },
      });
      expect(
        s.db
          .prepare(
            `SELECT deleted_at,dirty,sync_state FROM ${r.table} WHERE id=?`,
          )
          .get(r.remote.id),
      ).toEqual({
        deleted_at: r.remote.deletedAt,
        dirty: 0,
        sync_state: "SYNCED",
      });
      const history = s.db
        .prepare(
          "SELECT local_json,remote_json,decision FROM product_master_conflict_history",
        )
        .get()!;
      expect(JSON.parse(history.local_json as string)).toEqual(r.local);
      expect(JSON.parse(history.remote_json as string)).toEqual(r.remote);
      expect(history.decision).toBe("ADOPT_REMOTE");
      expect(
        tables.map((t) => s.db.prepare(`SELECT * FROM ${t}`).all()),
      ).toEqual(data);
      expect(
        s.db
          .prepare(
            "SELECT operation,version FROM product_master_remote_snapshots WHERE entity_type=? AND entity_id=?",
          )
          .get(r.entityType, r.remote.id),
      ).toEqual({ operation: "DELETE", version: 2 });
      const after = s.db
        .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
        .all();
      expect(after).toHaveLength(before.length);
      expect(
        await new OutboxRepository(s.a).countActive(
          s.scope.storeId,
          s.scope.ownerId,
        ),
      ).toEqual({ pending_count: 0, failed_count: 0 });
      expect(
        s.db
          .prepare(
            "SELECT status,last_error_code FROM sync_outbox WHERE command_id=?",
          )
          .get(r.command.commandId),
      ).toEqual({
        status: "FAILED",
        last_error_code: "PRODUCT_MASTER_CONFLICT_SUPERSEDED",
      });
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
              "ADOPT_REMOTE",
              true,
            )
          ).status,
        ).toBe("COMPLETED");
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
it.each(kinds)(
  "uses the same %s deletion resolver manually after a matching DELETE pull, and refuses a newer unseen deletion",
  async (kind) => {
    for (const newer of [false, true]) {
      const s = await nativeCatalogueConflictFixture(
        kind,
        ":memory:",
        undefined,
        true,
      );
      try {
        const r = s.review,
          repo = new ProductMasterConflictRepository(s.a, receiptReviewDigest);
        await applyProductMasterChange(s.a, s.scope.storeId, {
          entityType: r.entityType,
          entityId: r.remote.id,
          entityVersion: newer ? 3 : 2,
          operation: "DELETE",
        });
        const review = await repo.review(s.scope.storeId, r.conflict.id);
        expect(review.canAdopt).toBe(!newer);
        expect(review.canKeep).toBe(false);
        const ctx = {
          commandId: randomUUID(),
          deviceId: s.scope.deviceId,
          jobId: randomUUID(),
          reviewHash: review.hash,
          canResolve: () => true,
        };
        await expect(
          repo.resolve(s.scope.storeId, r.conflict.id, false, ctx),
        ).rejects.toThrow();
        if (newer) {
          await expect(
            repo.resolve(s.scope.storeId, r.conflict.id, false, {
              ...ctx,
              acceptRemoteDeletion: true,
            }),
          ).rejects.toThrow("STALE");
          expect(s.count("product_master_conflict_history")).toBe(0);
        } else {
          expect((await r.controller.open(r.message)).status).toBe("READY");
          await repo.resolve(s.scope.storeId, r.conflict.id, false, {
            ...ctx,
            acceptRemoteDeletion: true,
          });
          expect(s.count("product_master_conflict_history")).toBe(1);
        }
      } finally {
        s.db.close();
      }
    }
  },
);
it("rolls back tombstone adoption, evidence and superseded commands on late failure or revoked authority", async () => {
  for (const mode of ["late", "authority", "cancel"]) {
    const s = await nativeCatalogueConflictFixture(
      "PRODUCT",
      ":memory:",
      undefined,
      true,
    );
    try {
      const r = s.review,
        repo = new ProductMasterConflictRepository(s.a, receiptReviewDigest),
        review = await repo.review(s.scope.storeId, r.conflict.id),
        before = [
          "products",
          "sync_outbox",
          "sync_conflicts",
          "product_master_remote_snapshots",
        ].map((t) => s.db.prepare(`SELECT * FROM ${t}`).all());
      if (mode === "late")
        s.db.exec(
          "CREATE TRIGGER reject_deletion_history BEFORE INSERT ON product_master_conflict_history BEGIN SELECT RAISE(ABORT,'TEST_LATE_FAILURE'); END;",
        );
      const abort = new AbortController();
      if (mode === "cancel") abort.abort();
      let checks = 0;
      await expect(
        repo.resolve(s.scope.storeId, r.conflict.id, false, {
          commandId: randomUUID(),
          deviceId: s.scope.deviceId,
          jobId: randomUUID(),
          reviewHash: review.hash,
          acceptRemoteDeletion: true,
          signal: abort.signal,
          canResolve: () => mode !== "authority" || ++checks === 1,
        }),
      ).rejects.toThrow();
      expect(
        [
          "products",
          "sync_outbox",
          "sync_conflicts",
          "product_master_remote_snapshots",
        ].map((t) => s.db.prepare(`SELECT * FROM ${t}`).all()),
      ).toEqual(before);
      expect(s.count("product_master_conflict_history")).toBe(0);
    } finally {
      s.db.close();
    }
  }
});
it("never treats an absent remote payload or a reassigned identity as permission to delete", async () => {
  const s = await nativeCatalogueConflictFixture(
    "ALIAS",
    ":memory:",
    undefined,
    true,
  );
  try {
    const r = s.review;
    for (const remote of [
      null,
      { ...r.remote, productId: randomUUID() },
      { ...r.remote, source: "MERCALYS" },
    ]) {
      expect(
        await readCatalogueConflictPolicy(s.a, "ALIAS", r.local, remote),
      ).toMatchObject({ canAdopt: false, canKeep: false });
    }
    await s.a.runAsync(
      "UPDATE sync_conflicts SET remote_payload_json='null' WHERE id=?",
      r.conflict.id,
    );
    expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
    expect(
      readStoreConflictProposal(r.message).content.basis.alias?.deletedAt,
    ).toBe(r.remote.deletedAt);
  } finally {
    s.db.close();
  }
});
