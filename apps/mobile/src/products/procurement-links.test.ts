import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  procurementLinksFixture,
  linkTime,
} from "../../../../scripts/test-procurement-links-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { OutboxRepository } from "../sync/outbox-repository";
import { applyProcurementLinkReview } from "./procurement-links";
const close: DatabaseSync[] = [];
afterEach(() => {
  for (const db of close.splice(0)) db.close();
});
it("confirms one reviewed link for two supplier offers in one atomic command and restores it offline", async () => {
  const f = await procurementLinksFixture();
  close.push(f.device.raw);
  expect(f.preview.rows[0]).toMatchObject({
    state: "PLU_MATCH",
    products: [{ productId: f.product.id }],
  });
  const before = f.device.raw.prepare("SELECT * FROM products").all();
  const ctx = f.context(),
    review = await f.links.confirmBatch([f.link], ctx);
  expect(review!.decisions).toHaveLength(1);
  expect(await f.links.confirmBatch([f.link], f.context())).toBeNull();
  expect(
    f.device.raw
      .prepare(
        "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='procurement_link_review'",
      )
      .get(),
  ).toEqual({ n: 1 });
  expect(f.device.raw.prepare("SELECT * FROM products").all()).toEqual(before);
  const second = new VisualTestDatabase(new DatabaseSync(":memory:"));
  close.push(second.raw);
  await runLocalMigrations(second);
  await second.withExclusiveTransactionAsync((tx) =>
    applyProcurementLinkReview(tx, f.product.storeId, review),
  );
  await second.withExclusiveTransactionAsync((tx) =>
    applyProcurementLinkReview(tx, f.product.storeId, review),
  );
  expect(
    second.raw
      .prepare("SELECT COUNT(*) n FROM procurement_product_links")
      .get(),
  ).toEqual({ n: 1 });
  expect(
    second.raw.prepare("SELECT COUNT(*) n FROM procurement_link_reviews").get(),
  ).toEqual({ n: 1 });
  expect(second.raw.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({
    n: 0,
  });
});
it("preserves a later local withdrawal when the first confirmation is acknowledged, and orders overlapping batches", async () => {
  const f = await procurementLinksFixture();
  close.push(f.device.raw);
  const first = await f.links.confirmBatch([f.link], f.context());
  const withdrawn = {
    ...f.link,
    status: "WITHDRAWN",
    version: 2,
    updatedAt: "2026-11-22T09:00:00.000Z",
  };
  const second = await f.links.confirmBatch([withdrawn], {
    ...f.context(),
    createdAt: withdrawn.updatedAt,
  });
  const outbox = new OutboxRepository(f.device);
  const pending = await outbox.listPending(f.product.storeId, 100, f.ownerId);
  expect(
    pending
      .filter((c) => c.entityType === "procurement_link_review")
      .map((c) => c.entityId),
  ).toEqual([first!.id]);
  expect(
    (await outbox.listPending(f.product.storeId, 100, randomUUID())).filter(
      (c) => c.entityType === "procurement_link_review",
    ),
  ).toEqual([]);
  await f.device.withExclusiveTransactionAsync((tx) =>
    applyProcurementLinkReview(tx, f.product.storeId, first, true),
  );
  expect((await f.links.list(f.product.storeId))[0]).toMatchObject({
    entity: { version: 2, status: "WITHDRAWN" },
    syncState: "PENDING",
  });
  const c = pending.find((c) => c.entityId === first!.id)!;
  await outbox.markSyncing(c.commandId);
  await outbox.markAcknowledged(c.commandId);
  expect(
    (await outbox.listPending(f.product.storeId, 100, f.ownerId))
      .filter((c) => c.entityType === "procurement_link_review")
      .map((c) => c.entityId),
  ).toEqual([second!.id]);
  await f.device.withExclusiveTransactionAsync((tx) =>
    applyProcurementLinkReview(tx, f.product.storeId, second, true),
  );
  // Replaying the earlier history cannot overwrite the remote head.
  await f.device.withExclusiveTransactionAsync((tx) =>
    applyProcurementLinkReview(tx, f.product.storeId, first),
  );
  const row = f.device.raw
    .prepare(
      "SELECT remote_version,remote_payload_json FROM procurement_product_links",
    )
    .get()!;
  expect(row.remote_version).toBe(2);
  expect(JSON.parse(String(row.remote_payload_json)).status).toBe("WITHDRAWN");
});
it("rolls the whole decision back if the user scope changes or the target ownership differs", async () => {
  const f = await procurementLinksFixture();
  close.push(f.device.raw);
  await expect(
    f.links.confirmBatch([{ ...f.link, productId: randomUUID() }], f.context()),
  ).rejects.toThrow();
  let calls = 0;
  await expect(
    f.links.confirmBatch([f.link], {
      ...f.context(),
      assertCurrentScope: () => {
        if (++calls === 3) throw Error("SCOPE_CHANGED");
      },
    }),
  ).rejects.toThrow("SCOPE_CHANGED");
  expect(await f.links.list(f.product.storeId)).toEqual([]);
  expect(
    f.device.raw
      .prepare("SELECT COUNT(*) n FROM procurement_link_reviews")
      .get(),
  ).toEqual({ n: 0 });
  expect(
    f.device.raw
      .prepare(
        "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='procurement_link_review'",
      )
      .get(),
  ).toEqual({ n: 0 });
});
it("requires a justified manual decision when explicit PLU contradicts the constructed ITM", async () => {
  const f = await procurementLinksFixture();
  close.push(f.device.raw);
  await expect(
    f.links.confirmBatch(
      [
        {
          ...f.link,
          basis: { ...f.link.basis, method: "MANUAL", reason: null },
        },
      ],
      f.context(),
    ),
  ).rejects.toThrow();
  const review = await f.links.confirmBatch(
    [
      {
        ...f.link,
        basis: {
          ...f.link.basis,
          method: "MANUAL",
          reason: "Référence vérifiée par le responsable",
        },
      },
    ],
    f.context(),
  );
  expect(review!.decisions[0]!.link.basis.reason).toContain("vérifiée");
  expect(review!.createdAt).toBe(linkTime);
});

it("rejects a whole batch when its last choice is invalid", async () => {
  const f = await procurementLinksFixture();
  close.push(f.device.raw);
  const { procurementProductLinkId } = await import("./procurement-links");
  const bad = {
    ...f.link,
    id: procurementProductLinkId(f.product.storeId, "999999"),
    genericId: "999999",
  };
  await expect(
    f.links.confirmBatch([f.link, bad], f.context()),
  ).rejects.toThrow();
  expect(await f.links.list(f.product.storeId)).toEqual([]);
  expect(
    f.device.raw
      .prepare("SELECT COUNT(*) n FROM procurement_link_reviews")
      .get(),
  ).toEqual({ n: 0 });
});

it.each(["APPLIED", "CONFLICT", "REJECTED"] as const)(
  "keeps the canonical review and projection state consistent after %s",
  async (status) => {
    const f = await procurementLinksFixture();
    close.push(f.device.raw);
    await f.links.confirmBatch([f.link], f.context());
    await f.device.runAsync(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES(?,?,1)",
      f.product.storeId,
      "cursor",
    );
    await f.device.runAsync(
      "INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
      `procurement-links:${f.product.storeId}`,
      "1",
      linkTime,
    );
    const { MobileSyncService } = await import("../sync/sync-service");
    const service = new MobileSyncService(
      f.device,
      {
        bootstrap: async () => {
          throw Error("Unexpected bootstrap");
        },
        pull: async () => ({
          procurementLinks: true,
          changes: [],
          nextCursor: "cursor",
          hasMore: false,
          serverTime: linkTime,
        }),
        push: async (request) => ({
          serverTime: linkTime,
          results: request.commands.map((c) => ({
            commandId: c.commandId,
            entityId: c.entityId,
            entityType: c.entityType,
            status,
            ...(status === "APPLIED"
              ? { remoteVersion: 1, remoteEntity: c.payload }
              : {
                  error: {
                    code: "TEST_FAILURE",
                    messageFr: "Choix à vérifier",
                    retryable: false,
                    requestId: randomUUID(),
                  },
                }),
          })),
        }),
      },
      {
        appVersion: "test",
        deviceId: f.publicationInput.deviceId,
        copilotOwnerId: f.ownerId,
        procurementLinks: true,
        maxRetries: 0,
      },
    );
    await service.push(f.product.storeId);
    expect((await f.links.list(f.product.storeId))[0]!.syncState).toBe(
      status === "APPLIED"
        ? "SYNCED"
        : status === "CONFLICT"
          ? "CONFLICT"
          : "ERROR",
    );
    expect(
      f.device.raw
        .prepare("SELECT sync_state FROM procurement_link_reviews")
        .get(),
    ).toEqual({
      sync_state:
        status === "APPLIED"
          ? "SYNCED"
          : status === "CONFLICT"
            ? "CONFLICT"
            : "ERROR",
    });
  },
);
