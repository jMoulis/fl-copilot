import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import type { VisualEntityType } from "@fl-copilot/domain";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { OutboxRepository } from "../sync/outbox-repository";
import { ProductMasterRepository } from "./product-master-repository";
import {
  VisualLibraryRepository,
  applyVisualEntity,
  visualTables,
} from "./visual-library-repository";
import { VisualRecoveryRepository } from "./visual-recovery-repository";
import { VisualFileCache, visualFilePath } from "./visual-file-cache";
import {
  assignCapturedVisual,
  readProductVisualLink,
} from "./visual-library-actions";
import { loadProductEditorSnapshot } from "./product-editor-service";

const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
const at = "2026-10-20T14:00:00.000Z";
async function setup(kind: VisualEntityType = "visual_asset", known = false) {
  const dir = mkdtempSync(join(tmpdir(), "visual-recovery-")),
    path = join(dir, "device.db");
  const db = new VisualTestDatabase(new DatabaseSync(path)),
    f = visualLibraryFixture();
  await runLocalMigrations(db);
  const library = new VisualLibraryRepository(db),
    products = new ProductMasterRepository(db),
    outbox = new OutboxRepository(db);
  await products.upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  const commandId = randomUUID();
  for (const [k, entity] of [
    ["visual_asset", f.asset],
    ["visual_identity", f.identity],
    ["product_visual_link", f.link],
  ] as const) {
    if (known || k !== kind) await applyVisualEntity(db, f.storeId, k, entity);
    if (k === kind)
      await library.save(
        k,
        { ...entity, version: known ? 2 : 1 },
        {
          storeId: f.storeId,
          actorId: f.actorId,
          deviceId: f.deviceId,
          canWrite: true,
          commandId,
          expectedLocalVersion: known ? 1 : null,
        },
      );
  }
  const id =
    kind === "visual_asset"
      ? f.asset.id
      : kind === "visual_identity"
        ? f.identity.id
        : f.link.id;
  await outbox.markSyncing(commandId);
  await outbox.markFailed(commandId, "VISUAL_ACCESS_INVALID");
  await db.runAsync(
    `UPDATE ${visualTables[kind]} SET sync_state='ERROR' WHERE id=?`,
    id,
  );
  const source = {
    contentHash: f.asset.contentHash,
    sizeBytes: f.asset.sizeBytes,
    relativePath: visualFilePath(
      f.storeId,
      "SOURCE",
      f.asset.mimeType,
      f.asset.contentHash,
    ),
  };
  await new VisualFileCache(db).remember(
    f.storeId,
    f.asset.id,
    "SOURCE",
    source,
  );
  await db.runAsync(
    "UPDATE visual_assets SET offline_required=1 WHERE id=?",
    f.asset.id,
  );
  const recovery = new VisualRecoveryRepository(db, digest, () => at);
  const context = (reviewHash: string) => ({
    actorId: f.actorId,
    deviceId: f.deviceId,
    commandId: randomUUID(),
    reviewHash,
    rightsConfirmed: true,
    canWrite: () => true,
  });
  return {
    db,
    f,
    kind,
    id,
    commandId,
    library,
    products,
    outbox,
    source,
    recovery,
    context,
    path,
    close() {
      db.raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

for (const kind of [
  "visual_asset",
  "visual_identity",
  "product_visual_link",
] as const)
  for (const known of [false, true])
    it(`retries a rejected ${kind} using a fresh command and ${known ? "the known" : "a strict-create"} version`, async () => {
      const s = await setup(kind, known);
      try {
        const before = (await s.library.get(kind, s.f.storeId, s.id))!;
        await expect(
          s.library.save(
            kind,
            { ...before.entity, version: before.entity.version + 1 },
            {
              storeId: s.f.storeId,
              actorId: s.f.actorId,
              deviceId: s.f.deviceId,
              commandId: randomUUID(),
              canWrite: true,
              expectedLocalVersion: before.entity.version,
            },
          ),
        ).rejects.toThrow("VISUAL_RESOLVE_REQUIRED");
        const review = await s.recovery.review(
          s.f.storeId,
          kind,
          s.id,
          s.f.actorId,
        );
        expect(review.canRetry).toBe(true);
        const ctx = s.context(review.hash);
        await s.recovery.recover(s.f.storeId, kind, s.id, "RETRY_LOCAL", ctx);
        const current = (await s.library.get(kind, s.f.storeId, s.id))!;
        expect(current).toMatchObject({
          entity: { id: s.id, version: known ? 2 : 1 },
          dirty: true,
          syncState: "PENDING",
          remoteVersion: known ? 1 : null,
        });
        expect(await s.outbox.getById(ctx.commandId)).toMatchObject({
          expectedRemoteVersion: known ? 1 : null,
          status: "PENDING",
        });
        expect((await s.outbox.getById(s.commandId))?.status).toBe("FAILED");
        const audit = s.db.raw
          .prepare(
            "SELECT commands_json,decision,local_json FROM visual_conflict_history",
          )
          .get()!;
        expect(JSON.parse(audit.commands_json as string)).toMatchObject([
          { command_id: s.commandId, last_error_code: "VISUAL_ACCESS_INVALID" },
        ]);
        expect(JSON.parse(audit.local_json as string)).toEqual(before.entity);
        expect(audit.decision).toBe("RETRY_LOCAL");
        expect(
          s.db.raw.prepare("SELECT COUNT(*) n FROM visual_asset_files").get()!
            .n,
        ).toBe(1);
        expect(
          (await s.library.get("visual_asset", s.f.storeId, s.f.asset.id))
            ?.offlineRequired,
        ).toBe(true);
        expect((await s.outbox.countActive(s.f.storeId)).failed_count).toBe(0);
      } finally {
        s.close();
      }
    });

it("removes a rejected link without requiring a removed parent, then permits a new explicit selection", async () => {
  const s = await setup("product_visual_link");
  try {
    await applyVisualEntity(s.db, s.f.storeId, "visual_identity", {
      ...s.f.identity,
      version: 2,
      deletedAt: at,
    });
    const review = await s.recovery.review(
      s.f.storeId,
      s.kind,
      s.id,
      s.f.actorId,
    );
    expect(review).toMatchObject({
      canRetry: false,
      canRemove: true,
      canAdopt: false,
    });
    await s.recovery.recover(
      s.f.storeId,
      s.kind,
      s.id,
      "REMOVE_LINK",
      s.context(review.hash),
    );
    expect(
      (await readProductVisualLink(s.library, s.f.storeId, s.f.product.id))
        ?.entity.deletedAt,
    ).toBe(at);
    const basis = {
      product: (await loadProductEditorSnapshot(s.products, s.f.product.id))!,
      link: await readProductVisualLink(s.library, s.f.storeId, s.f.product.id),
    };
    // Explicit photo choice creates a fresh identity and reuses the retained approved binary.
    await assignCapturedVisual(
      s.db,
      basis,
      {
        ...s.source,
        mimeType: s.f.asset.mimeType,
        width: s.f.asset.width,
        height: s.f.asset.height,
      },
      true,
      {
        storeId: s.f.storeId,
        actorId: s.f.actorId,
        deviceId: s.f.deviceId,
        canWrite: () => true,
        id: randomUUID,
        now: () => at,
      },
    );
    expect((await s.library.resolve(s.f.product)).kind).toBe("ASSET");
    expect(
      (await readProductVisualLink(s.library, s.f.storeId, s.f.product.id))
        ?.entity.id,
    ).toBe(s.id);
    expect(
      s.db.raw.prepare("SELECT COUNT(*) n FROM visual_asset_files").get()!.n,
    ).toBe(1);
  } finally {
    s.close();
  }
});

it("can retire an uncommitted image or identity without claiming fresh usage rights or deleting its source", async () => {
  for (const kind of ["visual_asset", "visual_identity"] as const) {
    const s = await setup(kind);
    try {
      if (kind === "visual_identity")
        await applyVisualEntity(s.db, s.f.storeId, "visual_asset", {
          ...s.f.asset,
          version: 2,
          deletedAt: at,
        });
      const review = await s.recovery.review(
        s.f.storeId,
        kind,
        s.id,
        s.f.actorId,
      );
      expect(review.canRetire).toBe(true);
      const ctx = { ...s.context(review.hash), rightsConfirmed: false };
      await s.recovery.recover(s.f.storeId, kind, s.id, "RETIRE_LOCAL", ctx);
      const retired = (await s.library.get(kind, s.f.storeId, s.id))!;
      expect(retired.entity).toMatchObject({
        id: s.id,
        version: 1,
        deletedAt: at,
      });
      expect(
        (await s.outbox.getById(ctx.commandId))?.expectedRemoteVersion,
      ).toBeNull();
      expect(
        s.db.raw.prepare("SELECT COUNT(*) n FROM visual_asset_files").get()!.n,
      ).toBe(1);
      if (kind === "visual_asset" && "provenance" in retired.entity) {
        expect(retired.entity.provenance).toEqual(s.f.asset.provenance);
        await expect(
          s.library.save(
            "visual_asset",
            {
              ...s.f.asset,
              version: 2,
              updatedAt: at,
              deletedAt: null,
              review: { ...s.f.asset.review, at },
            },
            {
              storeId: s.f.storeId,
              actorId: s.f.actorId,
              deviceId: s.f.deviceId,
              commandId: randomUUID(),
              expectedLocalVersion: 1,
              canWrite: true,
            },
          ),
        ).rejects.toThrow("VISUAL_RIGHTS_CONFIRMATION_INVALID");
      }
    } finally {
      s.close();
    }
  }
});

it("adopts a known remote version after restart without resending the rejected command", async () => {
  const s = await setup("visual_identity", true);
  try {
    const reopened = new VisualTestDatabase(new DatabaseSync(s.path));
    try {
      const recovery = new VisualRecoveryRepository(reopened, digest, () => at),
        review = await recovery.review(s.f.storeId, s.kind, s.id, s.f.actorId);
      await recovery.recover(
        s.f.storeId,
        s.kind,
        s.id,
        "ADOPT_REMOTE",
        s.context(review.hash),
      );
      expect(
        await new VisualLibraryRepository(reopened).get(
          s.kind,
          s.f.storeId,
          s.id,
        ),
      ).toMatchObject({
        dirty: false,
        syncState: "SYNCED",
        entity: s.f.identity,
      });
      expect(
        (await new OutboxRepository(reopened).listPending(s.f.storeId)).filter(
          (c) => c.entityType === s.kind,
        ),
      ).toHaveLength(0);
      expect((await s.outbox.getById(s.commandId))?.status).toBe("FAILED");
    } finally {
      reopened.raw.close();
    }
  } finally {
    s.close();
  }
});

it("requires rights and explicit reactivation when retrying a known revoked asset", async () => {
  const s = await setup("visual_asset", true);
  try {
    await applyVisualEntity(s.db, s.f.storeId, s.kind, {
      ...s.f.asset,
      version: 2,
      review: { status: "REVOKED", actorId: s.f.actorId, at },
    });
    const review = await s.recovery.review(
      s.f.storeId,
      s.kind,
      s.id,
      s.f.actorId,
    );
    expect(review.retryReactivates).toBe(true);
    await expect(
      s.recovery.recover(
        s.f.storeId,
        s.kind,
        s.id,
        "RETRY_LOCAL",
        s.context(review.hash),
      ),
    ).rejects.toThrow("VISUAL_CONFLICT_REACTIVATION_REQUIRED");
    await expect(
      s.recovery.recover(s.f.storeId, s.kind, s.id, "RETRY_LOCAL", {
        ...s.context(review.hash),
        reactivate: true,
        rightsConfirmed: false,
      }),
    ).rejects.toThrow("VISUAL_RIGHTS_REQUIRED");
    expect((await s.library.get(s.kind, s.f.storeId, s.id))?.syncState).toBe(
      "ERROR",
    );
  } finally {
    s.close();
  }
});

it("refuses changed comparisons, another account and an in-flight command", async () => {
  const s = await setup("visual_asset", true);
  try {
    const review = await s.recovery.review(
      s.f.storeId,
      s.kind,
      s.id,
      s.f.actorId,
    );
    expect(
      (await s.recovery.review(s.f.storeId, s.kind, s.id, randomUUID()))
        .canRetry,
    ).toBe(false);
    await applyVisualEntity(s.db, s.f.storeId, s.kind, {
      ...s.f.asset,
      version: 2,
    });
    await expect(
      s.recovery.recover(
        s.f.storeId,
        s.kind,
        s.id,
        "RETRY_LOCAL",
        s.context(review.hash),
      ),
    ).rejects.toThrow("VISUAL_RECOVERY_STALE");
    await s.db.runAsync(
      "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
      s.commandId,
    );
    expect(
      (await s.recovery.review(s.f.storeId, s.kind, s.id, s.f.actorId))
        .canAdopt,
    ).toBe(false);
  } finally {
    s.close();
  }
});

it("rolls back the baseline reset and pin/file/history changes when persistence or authority fails", async () => {
  for (const lost of [false, true]) {
    const s = await setup();
    try {
      const before = await s.library.get(s.kind, s.f.storeId, s.id),
        review = await s.recovery.review(
          s.f.storeId,
          s.kind,
          s.id,
          s.f.actorId,
        );
      if (!lost)
        s.db.raw.exec(
          "CREATE TRIGGER refuse_visual_recovery BEFORE INSERT ON visual_conflict_history BEGIN SELECT RAISE(ABORT,'TEST_NO_RECOVERY'); END;",
        );
      let checks = 0;
      await expect(
        s.recovery.recover(s.f.storeId, s.kind, s.id, "RETRY_LOCAL", {
          ...s.context(review.hash),
          canWrite: () => !lost || ++checks < 3,
        }),
      ).rejects.toThrow(lost ? "VISUAL_ACCESS_INVALID" : "TEST_NO_RECOVERY");
      expect(await s.library.get(s.kind, s.f.storeId, s.id)).toEqual(before);
      expect((await s.outbox.getById(s.commandId))?.lastErrorCode).toBe(
        "VISUAL_ACCESS_INVALID",
      );
      expect(
        s.db.raw.prepare("SELECT COUNT(*) n FROM visual_asset_files").get()!.n,
      ).toBe(1);
    } finally {
      s.close();
    }
  }
});
