import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import {
  readStoreConflictProposal,
  productAliasSchema,
  productIdentifierSchema,
  productSchema,
} from "@fl-copilot/domain";
import { nativeCatalogueConflictFixture } from "../../../../scripts/test-catalogue-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotStoreConflictController } from "./store-conflict-controller";
import { readStoreConflictCurrent } from "./store-conflict-review";
import { OutboxRepository } from "../sync/outbox-repository";
import { ProductMasterConflictRepository } from "../products/conflict-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { applyProductMasterChange } from "../products/apply-product-master";
const kinds = ["PRODUCT", "IDENTIFIER", "ALIAS"] as const;
it.each(kinds)(
  "resolves both %s versions offline and replays once after restart",
  async (kind) => {
    for (const decision of ["KEEP_LOCAL", "ADOPT_REMOTE"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "catalogue-conflict-")),
        path = join(dir, "local.db"),
        s = await nativeCatalogueConflictFixture(kind, path);
      let reopened: DatabaseSync | undefined;
      try {
        const r = s.review;
        expect(r.state.status).toBe("READY");
        expect(r.state.review?.canKeepLocal).toBe(true);
        expect(readStoreConflictProposal(r.message).content.schemaVersion).toBe(
          5,
        );
        const preserve = [
            "sales_observations",
            "waste_observations",
            "source_documents",
            "waste_lines",
          ],
          before = preserve.map((t) =>
            s.db.prepare(`SELECT * FROM ${t}`).all(),
          );
        const siblings = s.db
          .prepare(
            `SELECT id FROM ${kind === "PRODUCT" ? "product_identifiers" : "products"} ORDER BY id`,
          )
          .all();
        expect(
          (
            await r.controller.confirm(
              r.message,
              r.state.review!.basisHash,
              decision,
              true,
            )
          ).status,
        ).toBe("COMPLETED");
        const current = await readStoreConflictCurrent(
          s.a,
          readStoreConflictProposal(r.message).content,
          receiptReviewDigest,
        );
        expect(current?.entity.version).toBe(decision === "KEEP_LOCAL" ? 3 : 2);
        if (decision === "ADOPT_REMOTE")
          expect(current?.entity).toEqual(r.remote);
        if (kind === "IDENTIFIER")
          expect(productIdentifierSchema.parse(current!.entity).value).toBe(
            "00042",
          );
        if (kind === "ALIAS")
          expect(productAliasSchema.parse(current!.entity).confidence).toBe(
            0.8,
          );
        expect(
          preserve.map((t) => s.db.prepare(`SELECT * FROM ${t}`).all()),
        ).toEqual(before);
        expect(
          s.db
            .prepare(
              `SELECT id FROM ${kind === "PRODUCT" ? "product_identifiers" : "products"} ORDER BY id`,
            )
            .all(),
        ).toEqual(siblings);
        expect(s.count("product_master_conflict_history")).toBe(1);
        const commands = (
          await new OutboxRepository(s.a).listPending(s.scope.storeId)
        ).filter((c) => c.entityType === r.entityType);
        expect(commands).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
        if (commands[0]) expect(commands[0].expectedRemoteVersion).toBe(2);
        const outbox = s.db
          .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
          .all();
        s.db.close();
        reopened = new DatabaseSync(path);
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
              r.state.review!.basisHash,
              decision,
              true,
            )
          ).status,
        ).toBe("COMPLETED");
        expect(
          reopened
            .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
            .all(),
        ).toEqual(outbox);
        await expect(
          new CopilotStoreConflictController(
            new ReceiptTestDatabase(reopened),
            { ...r.scope, canManageProducts: false },
            receiptReviewDigest,
            randomUUID,
          ).open(r.message),
        ).rejects.toThrow("FORBIDDEN");
      } finally {
        if (reopened) reopened.close();
        else s.db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  },
);
it.each(kinds)(
  "uses the same canonical %s resolver manually with rollback and current authority",
  async (kind) => {
    const s = await nativeCatalogueConflictFixture(kind);
    try {
      const r = s.review,
        repo = new ProductMasterConflictRepository(s.a, receiptReviewDigest),
        state = await repo.review(s.scope.storeId, r.conflict.id),
        ctx = {
          commandId: randomUUID(),
          deviceId: s.scope.deviceId,
          jobId: randomUUID(),
          reviewHash: state.hash,
          canResolve: () => true,
        };
      const before = s.db.prepare(`SELECT * FROM ${r.table}`).all(),
        outbox = s.db
          .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
          .all();
      s.a.fail = true;
      await expect(
        repo.resolve(s.scope.storeId, r.conflict.id, true, ctx),
      ).rejects.toThrow();
      s.a.fail = false;
      expect(s.db.prepare(`SELECT * FROM ${r.table}`).all()).toEqual(before);
      expect(
        s.db.prepare("SELECT * FROM sync_outbox ORDER BY local_sequence").all(),
      ).toEqual(outbox);
      expect(s.count("product_master_conflict_history")).toBe(0);
      let allowed = true;
      s.a.afterRun = (sql) => {
        if (sql.includes("INSERT INTO product_master_conflict_history"))
          allowed = false;
      };
      await expect(
        repo.resolve(s.scope.storeId, r.conflict.id, true, {
          ...ctx,
          canResolve: () => allowed,
        }),
      ).rejects.toThrow();
      s.a.afterRun = undefined;
      expect(s.count("product_master_conflict_history")).toBe(0);
      await repo.resolve(s.scope.storeId, r.conflict.id, true, ctx);
      expect(s.count("product_master_conflict_history")).toBe(1);
      await expect(
        repo.resolve(s.scope.storeId, r.conflict.id, true, ctx),
      ).rejects.toThrow();
      expect(s.count("product_master_conflict_history")).toBe(1);
    } finally {
      s.db.close();
    }
  },
);
it.each(kinds)(
  "rejects stale %s reviews, in-flight commands, cancellation and failed commit",
  async (kind) => {
    const s = await nativeCatalogueConflictFixture(kind);
    try {
      const r = s.review,
        hash = r.state.review!.basisHash;
      s.a.fail = true;
      await expect(
        r.controller.confirm(r.message, hash, "KEEP_LOCAL", true),
      ).rejects.toThrow();
      s.a.fail = false;
      expect(s.count("copilot_tool_results")).toBe(0);
      expect(s.count("product_master_conflict_history")).toBe(0);
      const signal = new AbortController();
      signal.abort();
      await expect(
        r.controller.confirm(
          r.message,
          hash,
          "KEEP_LOCAL",
          true,
          signal.signal,
        ),
      ).rejects.toThrow();
      await s.a.runAsync(
        "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
        r.command.commandId,
      );
      expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
      await expect(
        r.controller.confirm(r.message, hash, "ADOPT_REMOTE", true),
      ).rejects.toThrow();
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each(kinds)(
  "protects pending %s edits and blocks comparison when a newer pull or delete arrives",
  async (kind) => {
    for (const deletion of [false, true]) {
      const s = await nativeCatalogueConflictFixture(kind);
      try {
        const r = s.review,
          before = s.db.prepare(`SELECT * FROM ${r.table}`).all();
        await applyProductMasterChange(s.a, s.scope.storeId, {
          entityType: r.entityType,
          entityId: r.remote.id,
          entityVersion: 3,
          operation: deletion ? "DELETE" : "UPSERT",
          ...(deletion ? {} : { entity: { ...r.remote, version: 3 } }),
        });
        expect(s.db.prepare(`SELECT * FROM ${r.table}`).all()).toEqual(before);
        expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
        await expect(
          r.controller.confirm(
            r.message,
            r.state.review!.basisHash,
            "KEEP_LOCAL",
            true,
          ),
        ).rejects.toThrow();
        expect(s.count("copilot_tool_results")).toBe(0);
      } finally {
        s.db.close();
      }
    }
  },
);
it.each(["LOCAL", "REMOTE"] as const)(
  "requires separate consent to reverse a %s alias rejection",
  async (side) => {
    const s = await nativeCatalogueConflictFixture("ALIAS", ":memory:", side);
    try {
      const r = s.review,
        decision = side === "LOCAL" ? "ADOPT_REMOTE" : "KEEP_LOCAL";
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          decision,
          true,
        ),
      ).rejects.toThrow();
      expect(
        (
          await r.controller.confirm(
            r.message,
            r.state.review!.basisHash,
            decision,
            true,
            undefined,
            { reactivateRejected: true },
          )
        ).status,
      ).toBe("COMPLETED");
      expect((await r.controller.open(r.message)).status).toBe("COMPLETED");
    } finally {
      s.db.close();
    }
  },
);
it.each(["LOCAL", "REMOTE"] as const)(
  "requires separate consent to reverse %s product inactivity",
  async (side) => {
    const s = await nativeCatalogueConflictFixture("PRODUCT", ":memory:", side);
    try {
      const r = s.review,
        decision = side === "LOCAL" ? "ADOPT_REMOTE" : "KEEP_LOCAL";
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          decision,
          true,
        ),
      ).rejects.toThrow();
      expect(
        (
          await r.controller.confirm(
            r.message,
            r.state.review!.basisHash,
            decision,
            true,
            undefined,
            {
              reactivateRejected: false,
              retainWithdrawn: false,
              activateProduct: true,
            },
          )
        ).status,
      ).toBe("COMPLETED");
      expect(
        productSchema.parse(
          (await readStoreConflictCurrent(
            s.a,
            readStoreConflictProposal(r.message).content,
            receiptReviewDigest,
          ))!.entity,
        ).status,
      ).toBe("ACTIVE");
    } finally {
      s.db.close();
    }
  },
);
it.each(kinds)(
  "blocks %s collisions without preventing restoration of a valid synchronized version",
  async (kind) => {
    const s = await nativeCatalogueConflictFixture(kind);
    try {
      const r = s.review,
        repo = new ProductMasterRepository(s.a),
        other = {
          ...r.product,
          id: randomUUID(),
          label:
            kind === "PRODUCT"
              ? productSchema.parse(r.local).label
              : kind === "ALIAS"
                ? productAliasSchema.parse(r.local).alias
                : "Autre produit",
        };
      await repo.upsertProduct(other, {
        commandId: randomUUID(),
        deviceId: s.scope.deviceId,
      });
      if (kind === "IDENTIFIER")
        await repo.upsertIdentifier(
          { ...r.identifier, id: randomUUID(), productId: other.id },
          { commandId: randomUUID(), deviceId: s.scope.deviceId },
        );
      const state = await r.controller.open(r.message);
      expect(state.review?.canKeepLocal).toBe(false);
      expect(state.review?.canAdoptRemote).toBe(true);
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          "KEEP_LOCAL",
          true,
        ),
      ).rejects.toThrow();
      expect(
        (
          await r.controller.confirm(
            r.message,
            state.review!.basisHash,
            "ADOPT_REMOTE",
            true,
          )
        ).status,
      ).toBe("COMPLETED");
    } finally {
      s.db.close();
    }
  },
);

it.each(kinds)(
  "binds %s dependency changes and preserves explicit identity scope",
  async (kind) => {
    const s = await nativeCatalogueConflictFixture(kind);
    try {
      const r = s.review;
      if (kind === "PRODUCT")
        await s.a.runAsync(
          "UPDATE product_aliases SET version=version+1,status='VALIDATED' WHERE id=?",
          r.alias.id,
        );
      else
        await s.a.runAsync(
          "UPDATE products SET version=version+1 WHERE id=?",
          r.product.id,
        );
      const state = await r.controller.open(r.message);
      expect(state.review?.canKeepLocal).toBe(true);
      if (kind !== "PRODUCT")
        await expect(
          r.controller.confirm(
            r.message,
            r.state.review!.basisHash,
            "KEEP_LOCAL",
            true,
          ),
        ).rejects.toThrow("STALE");
      const body = readStoreConflictProposal(r.message).content;
      await expect(
        r.controller.open({
          ...r.message,
          text: JSON.stringify({ ...body, schemaVersion: 4 }),
        }),
      ).rejects.toThrow();
      await s.a.runAsync(
        "UPDATE sync_conflicts SET remote_payload_json=? WHERE id=?",
        JSON.stringify({ ...r.remote, storeId: randomUUID() }),
        r.conflict.id,
      );
      expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each(["IDENTIFIER", "ALIAS"] as const)(
  "does not reassign a %s to another product through conflict resolution",
  async (kind) => {
    const s = await nativeCatalogueConflictFixture(kind);
    try {
      const r = s.review;
      await s.a.runAsync(
        "UPDATE sync_conflicts SET remote_payload_json=? WHERE id=?",
        JSON.stringify({ ...r.remote, productId: randomUUID() }),
        r.conflict.id,
      );
      const state = await r.controller.open(r.message);
      expect(state.status).toBe("BLOCKED");
      expect(state.review?.canKeepLocal).toBe(false);
      expect(state.review?.canAdoptRemote).toBe(false);
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          "KEEP_LOCAL",
          true,
        ),
      ).rejects.toThrow();
    } finally {
      s.db.close();
    }
  },
);
it("queues deterministic recomputation with product resolution while keeping stored numbers intact", async () => {
  const s = await nativeCatalogueConflictFixture("PRODUCT");
  try {
    const r = s.review;
    await s.a.runAsync(
      "INSERT INTO product_daily_performance(id,store_id,product_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES(?,?,?,?,?,?,?,?,?)",
      randomUUID(),
      s.scope.storeId,
      r.product.id,
      "2026-10-01",
      "{}",
      "LOCAL",
      "test",
      "before",
      r.product.createdAt,
    );
    const before = s.db
        .prepare("SELECT * FROM product_daily_performance")
        .all(),
      jobs = s.count("local_jobs");
    s.a.fail = true;
    await expect(
      r.controller.confirm(
        r.message,
        r.state.review!.basisHash,
        "KEEP_LOCAL",
        true,
      ),
    ).rejects.toThrow();
    s.a.fail = false;
    expect(s.count("local_jobs")).toBe(jobs);
    expect(
      (
        await r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          "KEEP_LOCAL",
          true,
        )
      ).status,
    ).toBe("COMPLETED");
    expect(
      s.db.prepare("SELECT * FROM product_daily_performance").all(),
    ).toEqual(before);
    const job = s.db
      .prepare(
        "SELECT payload_json FROM local_jobs WHERE type='ANALYTICS_RECOMPUTE_PRODUCT_DATES'",
      )
      .get();
    expect(JSON.parse(String(job?.payload_json))).toMatchObject({
      storeId: s.scope.storeId,
      scopes: [{ productId: r.product.id, businessDate: "2026-10-01" }],
    });
  } finally {
    s.db.close();
  }
});
