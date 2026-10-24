import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { type VisualEntityType } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import { ConflictRepository } from "../sync/conflict-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { ProductMasterRepository } from "./product-master-repository";
import {
  VisualLibraryRepository,
  applyVisualEntity,
  visualTables,
} from "./visual-library-repository";
import { VisualConflictRepository } from "./visual-conflict-repository";

const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
const later = "2026-10-20T12:00:00.000Z",
  resolvedAt = "2026-10-20T13:00:00.000Z";
async function setup(
  kind: VisualEntityType = "visual_identity",
  simultaneousCreation = false,
) {
  const dir = mkdtempSync(join(tmpdir(), "fl-visual-choice-")),
    path = join(dir, "device.db");
  const db = new VisualTestDatabase(new DatabaseSync(path)),
    f = visualLibraryFixture();
  await runLocalMigrations(db);
  await new ProductMasterRepository(db).upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  for (const [type, value] of [
    ["visual_asset", f.asset],
    ["visual_identity", f.identity],
    ["product_visual_link", f.link],
  ] as const)
    if (!simultaneousCreation || kind !== type)
      await applyVisualEntity(db, f.storeId, type, value);
  const base =
    kind === "visual_asset"
      ? f.asset
      : kind === "visual_identity"
        ? f.identity
        : f.link;
  const otherActor = randomUUID();
  const local = {
    ...base,
    version: simultaneousCreation ? 1 : 2,
    updatedAt: later,
    ...("review" in base ? { review: { ...base.review, at: later } } : {}),
    ...(simultaneousCreation &&
    "provenance" in base &&
    base.provenance.type === "USER_UPLOAD"
      ? { provenance: { ...base.provenance, confirmedAt: later } }
      : {}),
    ...("verification" in base ? { verifiedAt: later } : {}),
    ...("canonicalName" in base ? { canonicalName: "Tomate locale" } : {}),
  };
  const remote = {
    ...base,
    version: simultaneousCreation ? 1 : 2,
    updatedAt: later,
    updatedBy: otherActor,
    ...(simultaneousCreation
      ? { createdBy: otherActor, createdAt: later }
      : {}),
    ...("review" in base
      ? { review: { ...base.review, actorId: otherActor, at: later } }
      : {}),
    ...("verification" in base
      ? { verifiedBy: otherActor, verifiedAt: later }
      : {}),
    ...(simultaneousCreation &&
    "provenance" in base &&
    base.provenance.type === "USER_UPLOAD"
      ? {
          provenance: {
            ...base.provenance,
            confirmedBy: otherActor,
            confirmedAt: later,
          },
        }
      : {}),
    ...("canonicalName" in base ? { canonicalName: "Tomate distante" } : {}),
  };
  const library = new VisualLibraryRepository(db),
    commandId = randomUUID();
  await library.save(kind, local, {
    commandId,
    storeId: f.storeId,
    actorId: f.actorId,
    deviceId: f.deviceId,
    canWrite: true,
    expectedLocalVersion: simultaneousCreation ? null : 1,
  });
  const outbox = new OutboxRepository(db),
    command = (await outbox.getById(commandId))!;
  await outbox.markSyncing(commandId);
  await new ConflictRepository(db).recordPushConflict(command, {
    commandId,
    entityType: kind,
    entityId: base.id,
    status: "CONFLICT",
    remoteVersion: remote.version,
    remoteEntity: remote,
  });
  await outbox.markConflict(commandId, "VISUAL_VERSION_CONFLICT");
  await db.runAsync(
    `UPDATE ${visualTables[kind]} SET sync_state='CONFLICT' WHERE id=?`,
    base.id,
  );
  await applyVisualEntity(db, f.storeId, kind, remote);
  const conflicts = new VisualConflictRepository(db, digest, () => resolvedAt);
  const context = (reviewHash: string) => ({
    actorId: f.actorId,
    commandId: randomUUID(),
    deviceId: f.deviceId,
    reviewHash,
    canResolve: () => true,
    rightsConfirmed: true,
  });
  return {
    db,
    f,
    kind,
    base,
    local,
    remote,
    library,
    outbox,
    commandId,
    conflicts,
    path,
    context,
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
] as const) {
  it(`rebases a reviewed ${kind} choice on the remote version and retains the superseded commands/history`, async () => {
    const s = await setup(kind);
    try {
      const review = await s.conflicts.review(
        s.f.storeId,
        s.commandId,
        s.f.actorId,
      );
      expect(review).toMatchObject({ canKeep: true, canAdopt: true });
      const ctx = s.context(review.hash);
      await s.conflicts.resolve(s.f.storeId, s.commandId, true, ctx);
      const current = (await s.library.get(kind, s.f.storeId, s.base.id))!;
      expect(current).toMatchObject({
        dirty: true,
        syncState: "PENDING",
        remoteVersion: 2,
        entity: {
          id: s.base.id,
          version: 3,
          updatedAt: resolvedAt,
          updatedBy: s.f.actorId,
          createdBy: s.remote.createdBy,
        },
      });
      expect(await s.outbox.getById(ctx.commandId)).toMatchObject({
        expectedRemoteVersion: 2,
        status: "PENDING",
      });
      expect(await s.outbox.getById(s.commandId)).toMatchObject({
        status: "FAILED",
        lastErrorCode: "VISUAL_LIBRARY_SUPERSEDED",
        payload: s.local,
      });
      expect(
        (await s.outbox.listPending(s.f.storeId)).some(
          (c) => c.commandId === ctx.commandId,
        ),
      ).toBe(true);
      expect(
        (await new ConflictRepository(s.db).getById(s.commandId))?.status,
      ).toBe("RESOLVED_LOCAL");
      expect(
        s.db.raw
          .prepare(
            "SELECT local_json,remote_json,actor_id FROM visual_conflict_history",
          )
          .get(),
      ).toEqual({
        local_json: JSON.stringify(s.local),
        remote_json: JSON.stringify(s.remote),
        actor_id: s.f.actorId,
      });
      // A late ACK for the remote baseline must not discard the newly reviewed local revision.
      await applyVisualEntity(s.db, s.f.storeId, kind, s.remote, 2);
      expect(
        (await s.library.get(kind, s.f.storeId, s.base.id))?.entity.version,
      ).toBe(3);
    } finally {
      s.close();
    }
  });
}

it("reconciles simultaneous creation on two devices without replacing a client ID or another creator's attribution", async () => {
  for (const kind of ["visual_asset", "product_visual_link"] as const) {
    const s = await setup(kind, true);
    try {
      expect(s.local.id).toBe(s.remote.id);
      expect(s.local.createdBy).not.toBe(s.remote.createdBy);
      const review = await s.conflicts.review(
        s.f.storeId,
        s.commandId,
        s.f.actorId,
      );
      expect(review.canKeep).toBe(true);
      const ctx = s.context(review.hash);
      await s.conflicts.resolve(s.f.storeId, s.commandId, true, ctx);
      expect(
        (await s.library.get(kind, s.f.storeId, s.local.id))?.entity,
      ).toMatchObject({
        id: s.local.id,
        version: 2,
        createdBy: s.remote.createdBy,
        updatedBy: s.f.actorId,
      });
      expect(
        (await s.outbox.getById(ctx.commandId))?.expectedRemoteVersion,
      ).toBe(1);
      expect((await s.library.list(kind, s.f.storeId)).length).toBe(1);
    } finally {
      s.close();
    }
  }
});

it("adopts the synchronized choice durably without fabricating an ACK or deleting either source", async () => {
  const s = await setup("visual_asset");
  try {
    await s.db.runAsync(
      "INSERT INTO visual_asset_files(asset_id,store_id,variant,relative_path,verified_hash,size_bytes,last_accessed_at) VALUES(?,?,'SOURCE','retained-original',?,1000,?)",
      s.base.id,
      s.f.storeId,
      s.f.asset.contentHash,
      later,
    );
    const review = await s.conflicts.review(
      s.f.storeId,
      s.commandId,
      s.f.actorId,
    );
    await s.conflicts.resolve(
      s.f.storeId,
      s.commandId,
      false,
      s.context(review.hash),
    );
    const reopened = new VisualTestDatabase(new DatabaseSync(s.path));
    try {
      expect(
        await new VisualLibraryRepository(reopened).get(
          "visual_asset",
          s.f.storeId,
          s.base.id,
        ),
      ).toMatchObject({
        entity: s.remote,
        remote: s.remote,
        remoteVersion: 2,
        dirty: false,
        syncState: "SYNCED",
      });
      expect(
        reopened.raw.prepare("SELECT COUNT(*) n FROM visual_asset_files").get()!
          .n,
      ).toBe(1);
      expect(
        (await new OutboxRepository(reopened).getById(s.commandId))?.status,
      ).toBe("FAILED");
      expect(
        await new OutboxRepository(reopened).countActive(s.f.storeId),
      ).toEqual({ pending_count: 1, failed_count: 0 }); // product only
    } finally {
      reopened.raw.close();
    }
  } finally {
    s.close();
  }
});

it("requires separate reactivation and rights decisions after a remote takedown", async () => {
  const s = await setup("visual_asset");
  try {
    const withdrawn = {
      ...s.f.asset,
      version: 3,
      updatedAt: later,
      review: { status: "REVOKED" as const, actorId: s.f.actorId, at: later },
    };
    await applyVisualEntity(s.db, s.f.storeId, "visual_asset", withdrawn);
    const review = await s.conflicts.review(
      s.f.storeId,
      s.commandId,
      s.f.actorId,
    );
    expect(review).toMatchObject({ reactivateLocal: true, canKeep: true });
    await expect(
      s.conflicts.resolve(
        s.f.storeId,
        s.commandId,
        true,
        s.context(review.hash),
      ),
    ).rejects.toThrow("VISUAL_CONFLICT_REACTIVATION_REQUIRED");
    await expect(
      s.conflicts.resolve(s.f.storeId, s.commandId, true, {
        ...s.context(review.hash),
        reactivate: true,
        rightsConfirmed: false,
      }),
    ).rejects.toThrow("VISUAL_RIGHTS_REQUIRED");
    await s.conflicts.resolve(s.f.storeId, s.commandId, true, {
      ...s.context(review.hash),
      reactivate: true,
    });
    expect(
      (await s.library.get("visual_asset", s.f.storeId, s.base.id))?.entity,
    ).toMatchObject({
      version: 4,
      review: { status: "APPROVED", actorId: s.f.actorId, at: resolvedAt },
      provenance: { confirmedAt: resolvedAt },
    });
  } finally {
    s.close();
  }
});

it("refuses stale comparisons after a newer remote or a changed parent", async () => {
  for (const changeParent of [true, false]) {
    const s = await setup("product_visual_link");
    try {
      const review = await s.conflicts.review(
        s.f.storeId,
        s.commandId,
        s.f.actorId,
      );
      if (changeParent)
        await applyVisualEntity(s.db, s.f.storeId, "visual_identity", {
          ...s.f.identity,
          version: 2,
          canonicalName: "Nouvelle désignation",
        });
      else
        await applyVisualEntity(s.db, s.f.storeId, s.kind, {
          ...s.remote,
          version: 3,
        });
      await expect(
        s.conflicts.resolve(
          s.f.storeId,
          s.commandId,
          true,
          s.context(review.hash),
        ),
      ).rejects.toThrow("VISUAL_CONFLICT_STALE");
      expect(
        (await s.library.get(s.kind, s.f.storeId, s.base.id))?.entity,
      ).toEqual(s.local);
      expect(
        s.db.raw
          .prepare("SELECT COUNT(*) n FROM visual_conflict_history")
          .get()!.n,
      ).toBe(0);
    } finally {
      s.close();
    }
  }
});

it("preserves other accounts' pending work, refuses in-flight and permits a complete owned group", async () => {
  const s = await setup();
  try {
    expect(
      (await s.conflicts.review(s.f.storeId, s.commandId, randomUUID()))
        .canAdopt,
    ).toBe(false);
    await s.db.runAsync(
      "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
      s.commandId,
    );
    expect(
      (await s.conflicts.review(s.f.storeId, s.commandId, s.f.actorId)).canKeep,
    ).toBe(false);
    await s.db.runAsync(
      "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
      s.commandId,
    );
    await s.db.runAsync(
      "INSERT INTO sync_conflicts SELECT ?,store_id,NULL,entity_type,entity_id,local_payload_json,remote_payload_json,local_expected_version,remote_version,conflict_type,status,created_at,resolved_at FROM sync_conflicts WHERE id=?",
      randomUUID(),
      s.commandId,
    );
    expect(
      (await s.conflicts.review(s.f.storeId, s.commandId, s.f.actorId))
        .canAdopt,
    ).toBe(true);
  } finally {
    s.close();
  }
});

it("never restores a local link whose product or image has become unavailable", async () => {
  const s = await setup("product_visual_link");
  try {
    await applyVisualEntity(s.db, s.f.storeId, "visual_asset", {
      ...s.f.asset,
      version: 2,
      deletedAt: later,
    });
    const review = await s.conflicts.review(
      s.f.storeId,
      s.commandId,
      s.f.actorId,
    );
    expect(review).toMatchObject({ canKeep: false, canAdopt: true });
  } finally {
    s.close();
  }
});

it("does not implicitly reconcile a newer parent snapshot or a deleted canonical product", async () => {
  for (const productDeleted of [true, false]) {
    const s = await setup("product_visual_link");
    try {
      if (productDeleted)
        await s.db.runAsync(
          "INSERT INTO product_master_remote_snapshots(store_id,entity_type,entity_id,version,operation,payload_json) VALUES(?,'product',?,2,'DELETE',NULL)",
          s.f.storeId,
          s.f.product.id,
        );
      else {
        await s.library.save(
          "visual_identity",
          { ...s.f.identity, version: 2, canonicalName: "Nom local modifié" },
          {
            storeId: s.f.storeId,
            actorId: s.f.actorId,
            deviceId: s.f.deviceId,
            commandId: randomUUID(),
            canWrite: true,
            expectedLocalVersion: 1,
          },
        );
        await applyVisualEntity(s.db, s.f.storeId, "visual_identity", {
          ...s.f.identity,
          version: 2,
          canonicalName: "Nom distant modifié",
        });
      }
      expect(
        await s.conflicts.review(s.f.storeId, s.commandId, s.f.actorId),
      ).toMatchObject({ canKeep: false, canAdopt: true });
    } finally {
      s.close();
    }
  }
});

it("rolls back the complete resolution when history persistence or authority fails", async () => {
  for (const loseAuthority of [false, true]) {
    const s = await setup();
    try {
      const review = await s.conflicts.review(
        s.f.storeId,
        s.commandId,
        s.f.actorId,
      );
      if (!loseAuthority)
        s.db.raw.exec(
          "CREATE TRIGGER refuse_visual_history BEFORE INSERT ON visual_conflict_history BEGIN SELECT RAISE(ABORT,'TEST_HISTORY_FAILURE'); END;",
        );
      let checks = 0;
      await expect(
        s.conflicts.resolve(s.f.storeId, s.commandId, true, {
          ...s.context(review.hash),
          canResolve: () => !loseAuthority || ++checks < 3,
        }),
      ).rejects.toThrow(
        loseAuthority ? "VISUAL_CONFLICT_FORBIDDEN" : "TEST_HISTORY_FAILURE",
      );
      expect(
        (await s.library.get(s.kind, s.f.storeId, s.base.id))?.entity,
      ).toEqual(s.local);
      expect((await s.outbox.getById(s.commandId))?.status).toBe("CONFLICT");
      expect(
        (await new ConflictRepository(s.db).getById(s.commandId))?.status,
      ).toBe("OPEN");
    } finally {
      s.close();
    }
  }
});

it("blocks later versions behind an unresolved visual conflict", async () => {
  const s = await setup();
  try {
    const pending = randomUUID();
    await s.outbox.enqueue({
      commandId: pending,
      storeId: s.f.storeId,
      deviceId: s.f.deviceId,
      entityType: s.kind,
      entityId: s.base.id,
      commandType: "VISUAL_IDENTITY_UPSERT",
      payload: { ...s.local, version: 3 },
      expectedRemoteVersion: 2,
    });
    expect(
      (await s.outbox.listPending(s.f.storeId)).some(
        (c) => c.commandId === pending,
      ),
    ).toBe(false);
  } finally {
    s.close();
  }
});
