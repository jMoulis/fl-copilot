import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  visualAssetSchema,
  visualIdentitySchema,
  productVisualLinkSchema,
  type Product,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import { MobileSyncService } from "../sync/sync-service";
import { ProductMasterRepository } from "./product-master-repository";
import {
  VisualLibraryRepository,
  applyVisualEntity,
} from "./visual-library-repository";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
type Value = string | number | null;
class SQLiteAdapter implements OutboxDatabase {
  constructor(readonly raw: DatabaseSync) {}
  async getFirstAsync<T>(sql: string, ...params: Value[]) {
    return (this.raw.prepare(sql).get(...params) as T) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: Value[]) {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  async runAsync(sql: string, ...params: Value[]) {
    return this.raw.prepare(sql).run(...params);
  }
  async execAsync(sql: string) {
    this.raw.exec(sql);
  }
  async withExclusiveTransactionAsync(
    task: (db: OutboxDatabase) => Promise<void>,
  ) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.raw.exec("COMMIT");
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
}
const storeId = "11111111-1111-4111-8111-111111111111",
  actorId = "22222222-2222-4222-8222-222222222222",
  deviceId = "33333333-3333-4333-8333-333333333333",
  at = "2026-10-20T10:00:00.000Z",
  later = "2026-10-20T11:00:00.000Z";
const base = {
  createdBy: actorId,
  updatedBy: actorId,
  storeId,
  version: 1,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
};
const asset = visualAssetSchema.parse({
  ...base,
  id: "44444444-4444-4444-8444-444444444444",
  contentHash: `sha256:${"a".repeat(64)}`,
  mimeType: "image/jpeg",
  width: 500,
  height: 500,
  sizeBytes: 1000,
  provenance: {
    type: "USER_UPLOAD",
    rights: "USER_CONFIRMED",
    confirmedBy: actorId,
    confirmedAt: at,
  },
  review: { status: "APPROVED", actorId, at },
});
const identity = visualIdentitySchema.parse({
  ...base,
  id: "55555555-5555-4555-8555-555555555555",
  canonicalName: "Tomate ronde rouge",
  specificity: "GENERIC",
  variety: null,
  appearance: null,
  brand: null,
  primaryAssetId: asset.id,
});
const product: Product = {
  ...base,
  id: "66666666-6666-4666-8666-666666666666",
  label: "Tomate vrac",
  category: "VEGETABLE",
  nature: "BULK",
  salesUnit: "KG",
  status: "ACTIVE",
};
const link = productVisualLinkSchema.parse({
  ...base,
  id: "77777777-7777-4777-8777-777777777777",
  productId: product.id,
  visualIdentityId: identity.id,
  overrideAssetId: asset.id,
  linkType: "MANUAL_OVERRIDE",
  verification: "APPROVED",
  verifiedBy: actorId,
  verifiedAt: at,
});
const ctx = (version: number | null = null) => ({
  storeId,
  actorId,
  deviceId,
  canWrite: true,
  commandId: randomUUID(),
  expectedLocalVersion: version,
});
async function setup(path = ":memory:") {
  const raw = new DatabaseSync(path),
    db = new SQLiteAdapter(raw);
  await runLocalMigrations(db);
  const repo = new VisualLibraryRepository(db);
  await new ProductMasterRepository(db).upsertProduct(product, {
    commandId: randomUUID(),
    deviceId,
  });
  return { raw, db, repo };
}
it("retains one reusable approved asset and a manual override through product reimport and file-backed restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-library-")),
    path = join(dir, "device.db");
  let raw: DatabaseSync | undefined;
  try {
    const first = await setup(path);
    raw = first.raw;
    await first.repo.save("visual_asset", asset, ctx());
    await first.repo.save("visual_identity", identity, ctx());
    await first.repo.save("product_visual_link", link, ctx());
    const other = { ...product, id: actorId, label: "Tomate Espagne" };
    await new ProductMasterRepository(first.db).upsertProduct(other, {
      commandId: randomUUID(),
      deviceId,
    });
    await first.repo.save(
      "product_visual_link",
      {
        ...link,
        id: deviceId,
        productId: other.id,
        linkType: "INHERITED_GENERIC",
        overrideAssetId: null,
      },
      ctx(),
    );
    await new ProductMasterRepository(first.db).upsertProduct(
      { ...product, label: "Libellé réimporté", version: 2, updatedAt: later },
      { commandId: randomUUID(), deviceId },
    );
    expect(await first.repo.resolve(product)).toMatchObject({
      kind: "ASSET",
      asset: { id: asset.id },
      link: { linkType: "MANUAL_OVERRIDE" },
    });
    expect(await first.repo.resolve(other)).toMatchObject({
      kind: "ASSET",
      asset: { id: asset.id },
    });
    expect(await first.repo.list("visual_asset", storeId)).toHaveLength(1);
    raw.close();
    raw = new DatabaseSync(path);
    const restored = new VisualLibraryRepository(new SQLiteAdapter(raw));
    expect(await restored.resolve(product)).toMatchObject({
      kind: "ASSET",
      link: { id: link.id, overrideAssetId: asset.id },
    });
    expect(await restored.list("visual_asset", actorId)).toEqual([]);
    const commands = await new OutboxRepository(
      new SQLiteAdapter(raw),
    ).listPending(storeId);
    expect(
      commands.filter((c) => c.entityType === "visual_asset"),
    ).toHaveLength(1);
    expect(
      commands.filter((c) => c.entityType === "product_visual_link"),
    ).toHaveLength(2);
    expect(
      commands.every((c) => !JSON.stringify(c.payload).includes("file://")),
    ).toBe(true);
  } finally {
    raw?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rolls back metadata when the Outbox write fails and refuses duplicate binary/product links", async () => {
  const { raw, repo } = await setup();
  try {
    raw.exec(
      "CREATE TRIGGER deny_visual_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'OUTBOX_FAILED'); END",
    );
    await expect(repo.save("visual_asset", asset, ctx())).rejects.toThrow(
      "OUTBOX_FAILED",
    );
    expect(await repo.list("visual_asset", storeId)).toEqual([]);
    raw.exec("DROP TRIGGER deny_visual_outbox");
    await repo.save("visual_asset", asset, ctx());
    await expect(
      repo.save("visual_asset", { ...asset, id: actorId }, ctx()),
    ).rejects.toThrow();
    await repo.save("visual_identity", identity, ctx());
    await repo.save("product_visual_link", link, ctx());
    await expect(
      repo.save("product_visual_link", { ...link, id: actorId }, ctx()),
    ).rejects.toThrow();
    expect(await repo.list("visual_asset", storeId)).toHaveLength(1);
    expect(await repo.list("product_visual_link", storeId)).toHaveLength(1);
  } finally {
    raw.close();
  }
});
it("keeps a newer offline choice through an older ACK, then hides a remotely revoked image and demands conflict review", async () => {
  const { raw, db, repo } = await setup();
  try {
    await repo.save("visual_asset", asset, ctx());
    await repo.save("visual_identity", identity, ctx());
    await repo.save("product_visual_link", link, ctx());
    const next = {
      ...asset,
      version: 2,
      updatedAt: later,
      review: { ...asset.review, at: later },
    };
    await repo.save("visual_asset", next, ctx(1));
    await applyVisualEntity(db, storeId, "visual_asset", asset, 1);
    expect(await repo.get("visual_asset", storeId, asset.id)).toMatchObject({
      entity: { version: 2 },
      remoteVersion: 1,
      dirty: true,
    });
    const revoked = {
      ...next,
      version: 3,
      review: { status: "REVOKED" as const, actorId, at: later },
    };
    await applyVisualEntity(db, storeId, "visual_asset", revoked);
    expect(await repo.resolve(product)).toMatchObject({ kind: "PLACEHOLDER" });
    expect(
      (await repo.get("visual_asset", storeId, asset.id))!.entity.version,
    ).toBe(2);
    await expect(
      repo.save("visual_asset", { ...next, version: 3 }, ctx(2)),
    ).rejects.toThrow("VISUAL_RESOLVE_REQUIRED");
    await expect(
      applyVisualEntity(db, storeId, "visual_asset", {
        ...revoked,
        width: 501,
      }),
    ).rejects.toThrow("VISUAL_HISTORY_CHANGED");
    const pending = (
      await new OutboxRepository(db).listPending(storeId)
    ).filter((c) => c.entityType === "visual_asset");
    expect(pending.map((c) => c.expectedRemoteVersion)).toEqual([null, 1]);
  } finally {
    raw.close();
  }
});
it("refuses stale, foreign, unauthorized, mutable-binary and unreviewed decisions without replacing the local image", async () => {
  const { raw, repo } = await setup();
  try {
    await repo.save("visual_asset", asset, ctx());
    const next = {
      ...asset,
      version: 2,
      updatedAt: later,
      review: { ...asset.review, at: later },
    };
    await expect(repo.save("visual_asset", next, ctx())).rejects.toThrow(
      "VISUAL_REVISION_INVALID",
    );
    await expect(
      repo.save("visual_asset", next, { ...ctx(1), canWrite: false }),
    ).rejects.toThrow("VISUAL_ACCESS_INVALID");
    await expect(
      repo.save(
        "visual_asset",
        { ...next, contentHash: `sha256:${"b".repeat(64)}` },
        ctx(1),
      ),
    ).rejects.toThrow("VISUAL_BINARY_IMMUTABLE");
    await expect(
      repo.save(
        "visual_asset",
        { ...next, review: { ...next.review, actorId: deviceId } },
        ctx(1),
      ),
    ).rejects.toThrow("VISUAL_REVIEW_REQUIRED");
    await expect(
      repo.save(
        "visual_asset",
        { ...next, storeId: actorId },
        { ...ctx(1), storeId: actorId },
      ),
    ).rejects.toThrow("VISUAL_SCOPE_INVALID");
    await expect(
      repo.save(
        "visual_identity",
        { ...identity, primaryAssetId: actorId },
        ctx(),
      ),
    ).rejects.toThrow("VISUAL_ASSET_UNAVAILABLE");
    expect((await repo.get("visual_asset", storeId, asset.id))!.entity).toEqual(
      asset,
    );
  } finally {
    raw.close();
  }
});

it.each(["visual_asset", "product_visual_link"] as const)(
  "retains a cross-device %s collision as an explicit conflict instead of blocking the pull",
  async (kind) => {
    const { raw, db, repo } = await setup();
    try {
      await repo.save("visual_asset", asset, ctx());
      await repo.save("visual_identity", identity, ctx());
      await repo.save("product_visual_link", link, ctx());
      const incoming =
        kind === "visual_asset"
          ? { ...asset, id: deviceId }
          : { ...link, id: deviceId };
      await db.withExclusiveTransactionAsync((tx) =>
        applyVisualEntity(tx, storeId, kind, incoming),
      );
      const localId = kind === "visual_asset" ? asset.id : link.id;
      expect(await repo.get(kind, storeId, localId)).toMatchObject({
        syncState: "CONFLICT",
        dirty: true,
        entity: { id: localId },
      });
      expect(await repo.get(kind, storeId, incoming.id)).toBeNull();
      const conflict = await db.getFirstAsync<{
        remote_payload_json: string;
        local_payload_json: string;
      }>(
        "SELECT remote_payload_json,local_payload_json FROM sync_conflicts WHERE entity_type=?",
        kind,
      );
      expect(JSON.parse(conflict!.remote_payload_json).id).toBe(incoming.id);
      expect(JSON.parse(conflict!.local_payload_json).id).toBe(localId);
      expect(await repo.resolve(product)).toMatchObject({
        kind: "PLACEHOLDER",
      });
      if (kind === "visual_asset") {
        const revoked = {
          ...asset,
          id: deviceId,
          version: 2,
          review: { status: "REVOKED" as const, actorId, at },
        };
        await db.withExclusiveTransactionAsync((tx) =>
          applyVisualEntity(tx, storeId, kind, revoked),
        );
        const refreshed = await db.getFirstAsync<{
          remote_payload_json: string;
        }>(
          "SELECT remote_payload_json FROM sync_conflicts WHERE entity_type=?",
          kind,
        );
        expect(JSON.parse(refreshed!.remote_payload_json).review.status).toBe(
          "REVOKED",
        );
      }
    } finally {
      raw.close();
    }
  },
);
it("does not execute or extend another user's unsynchronized visual decision", async () => {
  const { raw, db, repo } = await setup();
  try {
    await repo.save("visual_asset", asset, ctx());
    raw.exec(
      "UPDATE sync_outbox SET status='ACKNOWLEDGED' WHERE entity_type='product'",
    );
    let calls = 0;
    const service = new MobileSyncService(
      db,
      {
        bootstrap: async () => {
          throw Error("UNEXPECTED_BOOTSTRAP");
        },
        pull: async () => {
          throw Error("UNEXPECTED_PULL");
        },
        push: async () => {
          calls++;
          throw Error("UNEXPECTED_PUSH");
        },
      },
      { appVersion: "test", deviceId, copilotOwnerId: deviceId },
    );
    expect(await service.push(storeId)).toMatchObject({
      pushed: 0,
      conflicts: 0,
      failed: 0,
    });
    expect(calls).toBe(0);
    await expect(
      repo.save(
        "visual_asset",
        {
          ...asset,
          version: 2,
          updatedBy: deviceId,
          review: { ...asset.review, actorId: deviceId },
        },
        { ...ctx(1), actorId: deviceId },
      ),
    ).rejects.toThrow("VISUAL_OWNER_PENDING");
    expect(
      (await new OutboxRepository(db).listPending(storeId)).map(
        (c) => c.entityType,
      ),
    ).toEqual(["visual_asset"]);
  } finally {
    raw.close();
  }
});
