import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { ProductMasterRepository } from "./product-master-repository";
import { loadProductEditorSnapshot } from "./product-editor-service";
import { VisualLibraryRepository } from "./visual-library-repository";
import { VisualFileCache, visualFilePath } from "./visual-file-cache";
import {
  assignCapturedVisual,
  assignLibraryVisual,
  removeProductVisual,
  readProductVisualLink,
  type VisualActionContext,
} from "./visual-library-actions";
async function setup() {
  const f = visualLibraryFixture(),
    db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(db);
  const products = new ProductMasterRepository(db),
    library = new VisualLibraryRepository(db);
  await products.upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  let writable = true;
  const ctx: VisualActionContext = {
    storeId: f.storeId,
    actorId: f.actorId,
    deviceId: f.deviceId,
    id: randomUUID,
    now: () => f.at,
    canWrite: () => writable,
  };
  const basis = {
    product: (await loadProductEditorSnapshot(products, f.product.id))!,
    link: null,
  };
  const source = {
    contentHash: f.asset.contentHash,
    sizeBytes: f.asset.sizeBytes,
    mimeType: f.asset.mimeType,
    width: f.asset.width,
    height: f.asset.height,
    relativePath: visualFilePath(
      f.storeId,
      "SOURCE",
      f.asset.mimeType,
      f.asset.contentHash,
    ),
  };
  return {
    f,
    db,
    products,
    library,
    ctx,
    basis,
    source,
    setWritable: (v: boolean) => {
      writable = v;
    },
  };
}
it("keeps generated packaging illustrative, preserves AI provenance and commits canonical metadata plus its file job only after confirmation", async () => {
  const s = await setup();
  try {
    const packaged = {
      ...s.f.product,
      nature: "PACKAGED" as const,
      packaging: {
        quantity: "250",
        unit: "G" as const,
        sourceLabel: "barquette 250g",
      },
    };
    await s.products.upsertProduct(packaged, {
      commandId: randomUUID(),
      deviceId: s.f.deviceId,
    });
    const basis = {
      product: (await loadProductEditorSnapshot(s.products, packaged.id))!,
      link: null,
    };
    const source = {
      ...s.source,
      mimeType: "image/png" as const,
      width: 1024 as const,
      height: 1024 as const,
      relativePath: visualFilePath(
        s.f.storeId,
        "SOURCE",
        "image/png",
        s.source.contentHash,
      ),
    };
    const { relativePath: _path, ...descriptor } = source;
    void _path;
    const generated = {
      ...descriptor,
      provenance: {
        type: "AI_GENERATED" as const,
        provider: "TEST_FIXTURE_NOT_REAL_AI",
        model: "test",
        promptVersion: "test",
      },
    };
    await expect(
      assignCapturedVisual(s.db, basis, source, false, s.ctx, generated),
    ).rejects.toThrow("VISUAL_RIGHTS_REQUIRED");
    expect(await s.library.list("visual_asset", s.f.storeId)).toHaveLength(0);
    const asset = await assignCapturedVisual(
      s.db,
      basis,
      source,
      true,
      s.ctx,
      generated,
    );
    expect(asset.provenance).toEqual(generated.provenance);
    const identities = await s.library.list("visual_identity", s.f.storeId);
    expect(identities[0]!.entity.specificity).toBe("GENERIC");
    const resolution = await s.library.resolve(basis.product.product.entity);
    expect(resolution.kind).toBe("ASSET");
    if (resolution.kind === "ASSET") {
      expect(resolution.illustrative).toBe(true);
      expect(resolution.link.linkType).toBe("MANUAL_OVERRIDE");
    }
    expect(
      s.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM local_jobs WHERE type='VISUAL_FILE_TRANSFER'",
        )
        .get()!.n,
    ).toBe(1);
    await expect(
      assignCapturedVisual(
        s.db,
        basis,
        { ...source, sizeBytes: source.sizeBytes + 1 },
        true,
        s.ctx,
        generated,
      ),
    ).rejects.toThrow("VISUAL_FILE_BINDING_INVALID");
  } finally {
    s.db.raw.close();
  }
});
it("atomically creates one reusable visual and a retained file/upload job, with explicit rights and no product mutation", async () => {
  const s = await setup();
  try {
    const asset = await assignCapturedVisual(
      s.db,
      s.basis,
      s.source,
      true,
      s.ctx,
    );
    expect(asset.provenance).toMatchObject({
      type: "USER_UPLOAD",
      confirmedBy: s.f.actorId,
    });
    expect(await s.library.resolve(s.f.product)).toMatchObject({
      kind: "ASSET",
      asset: { id: asset.id },
      link: { linkType: "MANUAL_OVERRIDE" },
    });
    expect((await s.products.getProduct(s.f.product.id))!.entity).toEqual(
      s.f.product,
    );
    expect(
      await new VisualFileCache(s.db).get(s.f.storeId, asset, "SOURCE"),
    ).toMatchObject({ uploaded: false, pinned: true });
    expect(
      s.db.raw.prepare("SELECT type,status FROM local_jobs").all(),
    ).toEqual([{ type: "VISUAL_FILE_TRANSFER", status: "PENDING" }]);
    expect(
      s.db.raw
        .prepare("SELECT command_type FROM sync_outbox ORDER BY local_sequence")
        .all()
        .map((r) => r.command_type),
    ).toEqual([
      "PRODUCT_UPSERT",
      "VISUAL_ASSET_UPSERT",
      "VISUAL_IDENTITY_UPSERT",
      "PRODUCT_VISUAL_LINK_UPSERT",
    ]);
    const other = {
      ...s.f.product,
      id: randomUUID(),
      label: "Tomate autre origine",
    };
    await s.products.upsertProduct(other, {
      commandId: randomUUID(),
      deviceId: s.f.deviceId,
    });
    const another = {
      product: (await loadProductEditorSnapshot(s.products, other.id))!,
      link: null,
    };
    expect(
      (await assignCapturedVisual(s.db, another, s.source, true, s.ctx)).id,
    ).toBe(asset.id);
    expect((await s.library.list("visual_asset", s.f.storeId)).length).toBe(1);
    expect((await s.library.list("visual_identity", s.f.storeId)).length).toBe(
      1,
    );
    expect(s.db.raw.prepare("SELECT COUNT(*) n FROM local_jobs").get()!.n).toBe(
      1,
    );
    expect((await s.library.resolve(other)).kind).toBe("ASSET");
  } finally {
    s.db.raw.close();
  }
});
it("rolls back metadata, cache, outbox and file job together if the retained transfer cannot be queued", async () => {
  const s = await setup();
  try {
    s.db.raw.exec(
      "CREATE TRIGGER refuse_visual_job BEFORE INSERT ON local_jobs WHEN NEW.type='VISUAL_FILE_TRANSFER' BEGIN SELECT RAISE(ABORT,'TEST_NO_JOB'); END;",
    );
    await expect(
      assignCapturedVisual(s.db, s.basis, s.source, true, s.ctx),
    ).rejects.toThrow("TEST_NO_JOB");
    for (const table of [
      "visual_assets",
      "visual_identities",
      "product_visual_links",
      "visual_asset_files",
      "local_jobs",
    ])
      expect(s.db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n).toBe(
        0,
      );
    expect(
      s.db.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n,
    ).toBe(1);
  } finally {
    s.db.raw.close();
  }
});
it("refuses absent rights, stale product snapshots and lost permission without partial assignments", async () => {
  const s = await setup();
  try {
    await expect(
      assignCapturedVisual(s.db, s.basis, s.source, false, s.ctx),
    ).rejects.toThrow("VISUAL_RIGHTS_REQUIRED");
    s.setWritable(false);
    await expect(
      assignCapturedVisual(s.db, s.basis, s.source, true, s.ctx),
    ).rejects.toThrow("VISUAL_ACCESS_INVALID");
    s.setWritable(true);
    await s.products.upsertProduct(
      { ...s.f.product, version: 2, label: "Nom corrigé" },
      { commandId: randomUUID(), deviceId: s.f.deviceId },
    );
    await expect(
      assignCapturedVisual(s.db, s.basis, s.source, true, s.ctx),
    ).rejects.toThrow("VISUAL_PRODUCT_CHANGED");
    expect((await s.library.list("visual_asset", s.f.storeId)).length).toBe(0);
  } finally {
    s.db.raw.close();
  }
});
it("requires a fresh selection before replacing a link and retains original/library records when unlinking a product", async () => {
  const s = await setup();
  try {
    const asset = await assignCapturedVisual(
      s.db,
      s.basis,
      s.source,
      true,
      s.ctx,
    );
    const current = {
      ...s.basis,
      link: await readProductVisualLink(s.library, s.f.storeId, s.f.product.id),
    };
    const identity = (await s.library.list("visual_identity", s.f.storeId))[0]!;
    await expect(
      assignLibraryVisual(s.db, s.basis, identity, s.ctx),
    ).rejects.toThrow("VISUAL_SELECTION_CHANGED");
    await assignLibraryVisual(s.db, current, identity, s.ctx);
    expect(await s.library.resolve(s.f.product)).toMatchObject({
      kind: "ASSET",
      link: { linkType: "INHERITED_GENERIC" },
    });
    await expect(removeProductVisual(s.db, current, s.ctx)).rejects.toThrow(
      "VISUAL_SELECTION_CHANGED",
    );
    await removeProductVisual(
      s.db,
      {
        ...s.basis,
        link: await readProductVisualLink(
          s.library,
          s.f.storeId,
          s.f.product.id,
        ),
      },
      s.ctx,
    );
    expect((await s.library.resolve(s.f.product)).kind).toBe("PLACEHOLDER");
    expect(
      await new VisualFileCache(s.db).get(s.f.storeId, asset, "SOURCE"),
    ).not.toBeNull();
    expect(
      await s.library.get("visual_asset", s.f.storeId, asset.id),
    ).not.toBeNull();
    const removed = await readProductVisualLink(
      s.library,
      s.f.storeId,
      s.f.product.id,
    );
    expect(removed?.entity.deletedAt).not.toBeNull();
    await assignLibraryVisual(
      s.db,
      { ...s.basis, link: removed },
      identity,
      s.ctx,
    );
    const restored = await readProductVisualLink(
      s.library,
      s.f.storeId,
      s.f.product.id,
    );
    expect(restored?.entity.id).toBe(current.link?.entity.id);
    expect(restored?.entity.version).toBe(removed!.entity.version + 1);
    expect(restored?.entity.createdAt).toBe(current.link?.entity.createdAt);
    expect(restored?.entity.deletedAt).toBeNull();
    expect((await s.library.resolve(s.f.product)).kind).toBe("ASSET");
    expect(
      (await s.library.list("product_visual_link", s.f.storeId)).length,
    ).toBe(1);
  } finally {
    s.db.raw.close();
  }
});

it("takes down a shared asset explicitly without deleting any source, and cancels its pending transfers", async () => {
  const s = await setup();
  try {
    const asset = await assignCapturedVisual(
      s.db,
      s.basis,
      s.source,
      true,
      s.ctx,
    );
    const { revokeLibraryVisual } = await import("./visual-library-actions");
    const expected = (await s.library.get(
      "visual_asset",
      s.f.storeId,
      asset.id,
    ))!;
    await revokeLibraryVisual(s.db, expected, s.ctx);
    expect((await s.library.resolve(s.f.product)).kind).toBe("PLACEHOLDER");
    expect(
      s.db.raw.prepare("SELECT status,last_error FROM local_jobs").all(),
    ).toEqual([{ status: "CANCELLED", last_error: "VISUAL_REVOKED" }]);
    expect(
      await new VisualFileCache(s.db).get(s.f.storeId, asset, "SOURCE"),
    ).toMatchObject({ uploaded: false, pinned: true });
    await expect(revokeLibraryVisual(s.db, expected, s.ctx)).rejects.toThrow(
      "VISUAL_SELECTION_CHANGED",
    );
    await expect(
      assignCapturedVisual(
        s.db,
        {
          ...s.basis,
          link: await readProductVisualLink(
            s.library,
            s.f.storeId,
            s.f.product.id,
          ),
        },
        s.source,
        true,
        s.ctx,
      ),
    ).rejects.toThrow("VISUAL_ASSET_UNAVAILABLE");
  } finally {
    s.db.raw.close();
  }
});
