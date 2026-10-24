import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { nativeCatalogueConflictFixture } from "../../../../scripts/test-catalogue-conflict-fixtures";
import {
  receiptReviewDigest,
  ReceiptTestDatabase,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { OutboxRepository } from "../sync/outbox-repository";
import { applyProductMasterChange } from "../products/apply-product-master";
import { storeConflictPreview } from "../../../../scripts/test-store-conflict-fixtures";
import { buildStoreConflictMessages } from "../../../api/src/copilot/store-conflict-messages";
import { applyCopilotRecord } from "./conversation-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { ProductMasterConflictRepository } from "../products/conflict-repository";
import { CopilotStoreConflictController } from "./store-conflict-controller";

type Fixture = Awaited<ReturnType<typeof nativeCatalogueConflictFixture>>;
async function addConflict(s: Fixture, remote = s.review.remote) {
  const command = { ...s.review.command, commandId: randomUUID() };
  await new OutboxRepository(s.a).enqueue(command);
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  return new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    status: "CONFLICT",
    entityType: command.entityType,
    entityId: command.entityId,
    remoteVersion: remote.version,
    remoteEntity: remote,
  });
}
for (const kind of ["PRODUCT", "IDENTIFIER", "ALIAS"] as const)
  for (const decision of ["KEEP_LOCAL", "ADOPT_REMOTE"] as const)
    it(`resolves the reviewed ${kind} group via manual and chat paths (${decision}), retains every snapshot and replays after restart`, async () => {
      for (const channel of ["MANUAL", "CHAT"] as const) {
        const dir = mkdtempSync(join(tmpdir(), "fl-catalogue-group-")),
          path = join(dir, "db.sqlite"),
          s = await nativeCatalogueConflictFixture(kind, path);
        let reopened: DatabaseSync | undefined;
        try {
          const r = s.review;
          const older = await addConflict(
            s,
            kind === "PRODUCT"
              ? r.product
              : kind === "IDENTIFIER"
                ? r.identifier
                : r.alias,
          );
          await s.a.runAsync(
            "UPDATE sync_conflicts SET created_at='2030-01-01T00:00:00.000Z' WHERE id=?",
            older.id,
          );
          await addConflict(s);
          const untouchedTables = [
              "sales_observations",
              "waste_observations",
              "source_documents",
              "waste_lines",
            ],
            untouched = untouchedTables.map((t) =>
              s.db.prepare(`SELECT * FROM ${t}`).all(),
            );
          const retained = s.db
            .prepare(
              "SELECT id,local_payload_json,remote_payload_json FROM sync_conflicts ORDER BY id",
            )
            .all();
          const repository = new ProductMasterConflictRepository(
              s.a,
              receiptReviewDigest,
            ),
            manual = await repository.review(s.scope.storeId, r.conflict.id),
            chat = await r.controller.open(r.message);
          expect(manual.canKeep).toBe(true);
          expect(manual.canAdopt).toBe(true);
          expect(chat.status).toBe("READY");
          expect(manual.remote).toEqual(r.remote);
          if (channel === "CHAT")
            await r.controller.confirm(
              r.message,
              chat.review!.basisHash,
              decision,
              true,
            );
          else
            await repository.resolve(
              s.scope.storeId,
              r.conflict.id,
              decision === "KEEP_LOCAL",
              {
                commandId: randomUUID(),
                deviceId: s.scope.deviceId,
                jobId: randomUUID(),
                reviewHash: manual.hash,
                canResolve: () => true,
              },
            );
          expect(
            s.db
              .prepare(
                "SELECT id,local_payload_json,remote_payload_json FROM sync_conflicts ORDER BY id",
              )
              .all(),
          ).toEqual(retained);
          expect(
            s.db.prepare("SELECT DISTINCT status FROM sync_conflicts").all(),
          ).toEqual([
            {
              status:
                decision === "KEEP_LOCAL"
                  ? "RESOLVED_LOCAL"
                  : "RESOLVED_REMOTE",
            },
          ]);
          expect(s.count("product_master_conflict_history")).toBe(1);
          expect(
            untouchedTables.map((t) =>
              s.db.prepare(`SELECT * FROM ${t}`).all(),
            ),
          ).toEqual(untouched);
          const commands = s.db
            .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
            .all();
          expect(
            commands.filter(
              (c) => c.entity_type === r.entityType && c.status === "PENDING",
            ),
          ).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
          s.db.close();
          reopened = new DatabaseSync(path);
          if (channel === "CHAT") {
            const controller = new CopilotStoreConflictController(
              new ReceiptTestDatabase(reopened),
              r.scope,
              receiptReviewDigest,
              randomUUID,
            );
            expect(
              (
                await controller.confirm(
                  r.message,
                  chat.review!.basisHash,
                  decision,
                  true,
                )
              ).status,
            ).toBe("COMPLETED");
          }
          expect(
            reopened
              .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
              .all(),
          ).toEqual(commands);
          expect(
            reopened
              .prepare(
                "SELECT COUNT(*) AS n FROM sync_conflicts WHERE status='OPEN'",
              )
              .get()!.n,
          ).toBe(0);
        } finally {
          if (reopened) reopened.close();
          else s.db.close();
          rmSync(dir, { recursive: true, force: true });
        }
      }
    });
it("invalidates both comparisons when an older group snapshot changes without changing its latest remote", async () => {
  const s = await nativeCatalogueConflictFixture("PRODUCT");
  try {
    const other = await addConflict(s, s.review.product),
      repo = new ProductMasterConflictRepository(s.a, receiptReviewDigest),
      manual = await repo.review(s.scope.storeId, s.review.conflict.id),
      chat = await s.review.controller.open(s.review.message);
    expect(chat.status).toBe("READY");
    await s.a.runAsync(
      "UPDATE sync_conflicts SET local_payload_json=json_set(local_payload_json,'$.label','OLDER EDIT') WHERE id=?",
      other.id,
    );
    const before = s.db
      .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
      .all();
    await expect(
      repo.resolve(s.scope.storeId, s.review.conflict.id, true, {
        commandId: randomUUID(),
        deviceId: s.scope.deviceId,
        jobId: randomUUID(),
        reviewHash: manual.hash,
        canResolve: () => true,
      }),
    ).rejects.toThrow();
    await expect(
      s.review.controller.confirm(
        s.review.message,
        chat.review!.basisHash,
        "KEEP_LOCAL",
        true,
      ),
    ).rejects.toThrow();
    expect(s.count("product_master_conflict_history")).toBe(0);
    expect(
      s.db.prepare("SELECT * FROM sync_outbox ORDER BY local_sequence").all(),
    ).toEqual(before);
  } finally {
    s.db.close();
  }
});

it.each(["CONTRADICTORY", "REASSIGNED", "NULL", "VERSION", "LIMIT"] as const)(
  "refuses an unverified catalogue group (%s) without any write",
  async (mode) => {
    const s = await nativeCatalogueConflictFixture("ALIAS");
    try {
      const r = s.review,
        remote =
          mode === "CONTRADICTORY"
            ? { ...r.remote, confidence: 0.1 }
            : mode === "REASSIGNED"
              ? { ...r.remote, productId: randomUUID() }
              : r.remote;
      const other = await addConflict(s, remote);
      if (mode === "NULL")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET remote_payload_json='null' WHERE id=?",
          other.id,
        );
      if (mode === "VERSION")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET remote_version=5 WHERE id=?",
          other.id,
        );
      if (mode === "LIMIT") for (let i = 0; i < 99; i++) await addConflict(s);
      const before = s.db
        .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
        .all();
      const repo = new ProductMasterConflictRepository(
        s.a,
        receiptReviewDigest,
      );
      const manual = await repo
          .review(s.scope.storeId, r.conflict.id)
          .catch(() => null),
        chat = await r.controller.open(r.message);
      expect(manual?.canAdopt ?? false).toBe(false);
      expect(manual?.canKeep ?? false).toBe(false);
      expect(chat.status).toBe("BLOCKED");
      await expect(
        r.controller.confirm(
          r.message,
          chat.review!.basisHash,
          "ADOPT_REMOTE",
          true,
        ),
      ).rejects.toThrow();
      expect(
        s.db.prepare("SELECT * FROM sync_outbox ORDER BY local_sequence").all(),
      ).toEqual(before);
      expect(s.count("product_master_conflict_history")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each(["ROLLBACK", "CANCEL", "PERMISSION", "NEW_CONFLICT"] as const)(
  "preserves the whole reviewed group after a late failure (%s)",
  async (mode) => {
    const s = await nativeCatalogueConflictFixture("PRODUCT");
    try {
      await addConflict(s);
      const r = s.review,
        state = await r.controller.open(r.message);
      if (mode === "NEW_CONFLICT") await addConflict(s);
      const before = s.db
          .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
          .all(),
        conflicts = s.db
          .prepare("SELECT * FROM sync_conflicts ORDER BY id")
          .all(),
        entity = s.db.prepare("SELECT * FROM products ORDER BY id").all(),
        cancel = new AbortController();
      if (mode === "ROLLBACK") s.a.fail = true;
      if (mode === "CANCEL")
        s.a.afterRun = (sql) => {
          if (sql.includes("UPDATE sync_conflicts SET status=")) cancel.abort();
        };
      if (mode === "PERMISSION") r.scope.canManageProducts = false;
      await expect(
        r.controller.confirm(
          r.message,
          state.review!.basisHash,
          "KEEP_LOCAL",
          true,
          cancel.signal,
        ),
      ).rejects.toThrow();
      expect(
        s.db.prepare("SELECT * FROM sync_outbox ORDER BY local_sequence").all(),
      ).toEqual(before);
      expect(
        s.db.prepare("SELECT * FROM sync_conflicts ORDER BY id").all(),
      ).toEqual(conflicts);
      expect(s.db.prepare("SELECT * FROM products ORDER BY id").all()).toEqual(
        entity,
      );
      expect(s.count("product_master_conflict_history")).toBe(0);
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);

it.each(["REMOTE", "LOCAL"] as const)(
  "retains separate deletion consent with a reviewed catalogue group (%s)",
  async (mode) => {
    const s = await nativeCatalogueConflictFixture(
      "PRODUCT",
      ":memory:",
      undefined,
      mode === "REMOTE",
      mode === "LOCAL",
    );
    try {
      await addConflict(s);
      const r = s.review,
        state = await r.controller.open(r.message);
      expect(state.status).toBe("READY");
      await expect(
        r.controller.confirm(
          r.message,
          state.review!.basisHash,
          "ADOPT_REMOTE",
          true,
        ),
      ).rejects.toThrow("CONFIRMATION_REQUIRED");
      expect(s.count("product_master_conflict_history")).toBe(0);
      const result = await r.controller.confirm(
        r.message,
        state.review!.basisHash,
        "ADOPT_REMOTE",
        true,
        undefined,
        {
          acceptRemoteDeletion: mode === "REMOTE",
          confirmLocalDeletionChoice: mode === "LOCAL",
        },
      );
      expect(result.status).toBe("COMPLETED");
      expect(
        await new ConflictRepository(s.a).listOpen(s.scope.storeId),
      ).toHaveLength(0);
      expect(
        s.db
          .prepare("SELECT deleted_at FROM products WHERE id=?")
          .get(r.remote.id)!.deleted_at,
      ).toBe(r.remote.deletedAt);
      expect(
        s.db
          .prepare("SELECT COUNT(*) n FROM sync_outbox WHERE status='PENDING'")
          .get()!.n,
      ).toBe(0);
    } finally {
      s.db.close();
    }
  },
);

it("does not adopt a newer captured remote version through an older chat comparison", async () => {
  const s = await nativeCatalogueConflictFixture("PRODUCT");
  try {
    const r = s.review;
    await addConflict(s, { ...r.remote, version: 3 });
    const manual = await new ProductMasterConflictRepository(
      s.a,
      receiptReviewDigest,
    ).review(s.scope.storeId, r.conflict.id);
    expect(manual.remote.version).toBe(3);
    expect(manual.canAdopt).toBe(true);
    expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
    expect(s.count("product_master_conflict_history")).toBe(0);
  } finally {
    s.db.close();
  }
});
it("resolves all one hundred reviewed catalogue conflicts without leaving an OPEN row or replaying old commands", async () => {
  const s = await nativeCatalogueConflictFixture("PRODUCT");
  try {
    for (let i = 0; i < 99; i++) await addConflict(s);
    const r = s.review,
      state = await r.controller.open(r.message);
    expect(state.status).toBe("READY");
    expect(state.review!.catalogueConflicts).toHaveLength(100);
    await r.controller.confirm(
      r.message,
      state.review!.basisHash,
      "KEEP_LOCAL",
      true,
    );
    expect(
      await new ConflictRepository(s.a).listOpen(s.scope.storeId),
    ).toHaveLength(0);
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_conflicts WHERE status='RESOLVED_LOCAL'",
        )
        .get()!.n,
    ).toBe(100);
    const pending = (
      await new OutboxRepository(s.a).listPending(s.scope.storeId)
    ).filter((c) => c.entityType === r.entityType);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.expectedRemoteVersion).toBe(2);
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE last_error_code='PRODUCT_MASTER_CONFLICT_SUPERSEDED'",
        )
        .get()!.n,
    ).toBe(100);
    expect(s.count("product_master_conflict_history")).toBe(1);
  } finally {
    s.db.close();
  }
});

it.each(["KEEP_LOCAL", "ADOPT_REMOTE"] as const)(
  "reviews a newer verified pull with the old conflict group after a fresh chat comparison (%s)",
  async (decision) => {
    const s = await nativeCatalogueConflictFixture("PRODUCT");
    try {
      const r = s.review;
      await addConflict(s);
      const remote = { ...r.remote, version: 3 };
      await applyProductMasterChange(s.a, s.scope.storeId, {
        entityType: r.entityType,
        entityId: remote.id,
        entityVersion: 3,
        operation: "UPSERT",
        entity: remote,
      });
      expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
      const repo = new ProductMasterConflictRepository(
          s.a,
          receiptReviewDigest,
        ),
        manual = await repo.review(s.scope.storeId, r.conflict.id);
      expect(manual.canKeep).toBe(true);
      expect(manual.remote).toEqual(remote);
      const message = buildStoreConflictMessages(s.f.assistant, [
        storeConflictPreview("PRODUCT", remote),
      ])[0]!;
      await s.a.withExclusiveTransactionAsync((tx) =>
        applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
      );
      const state = await r.controller.open(message);
      expect(state.status).toBe("READY");
      await r.controller.confirm(
        message,
        state.review!.basisHash,
        decision,
        true,
      );
      expect(
        await new ConflictRepository(s.a).listOpen(s.scope.storeId),
      ).toHaveLength(0);
      const pending = (
        await new OutboxRepository(s.a).listPending(s.scope.storeId)
      ).filter((c) => c.entityType === r.entityType);
      expect(pending).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
      if (pending[0]) expect(pending[0].expectedRemoteVersion).toBe(3);
      expect(
        s.db.prepare("SELECT version FROM products WHERE id=?").get(remote.id)!
          .version,
      ).toBe(decision === "KEEP_LOCAL" ? 4 : 3);
    } finally {
      s.db.close();
    }
  },
);
