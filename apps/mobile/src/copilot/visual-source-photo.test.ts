import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createVisualSourcePhotoPort } from "./visual-source-photo";
import {
  visualActionFixture,
  visualActionDigest,
} from "../../../../scripts/test-visual-action-fixtures";
import { CopilotVisualActionController } from "./visual-action-controller";
import type { VisualFileStorage } from "../products/visual-file-storage-port";

it("adopts an explicitly viewed source through canonical metadata, one upload job and an immutable private result", async () => {
  const s = await visualActionFixture("ASSIGN_SOURCE");
  try {
    expect(s.state.status).toBe("READY");
    const retainedBefore = s.db.raw
      .prepare("SELECT * FROM source_documents")
      .all();
    const before = s.db.raw.prepare("SELECT count(*) n FROM sync_outbox").get()!
      .n as number;
    await s.controller.prepareSourcePhoto(s.message);
    const result = await s.controller.confirm(
      s.message,
      s.state.review!.basisHash,
      s.consent,
    );
    expect(result.result).toMatchObject({
      action: "ASSIGN_SOURCE",
      sourceDocumentId: s.sourcePhoto.sourceDocumentId,
      sourceChecksum: s.sourcePhoto.checksum,
      assetContentHash: s.sourcePhoto.checksum,
      rightsConfirmed: true,
      syncState: "PENDING",
    });
    const link = await s.library.get(
      "product_visual_link",
      s.f.storeId,
      s.f.link.id,
    );
    expect(link!.entity.overrideAssetId).toBe(result.result!.assetId);
    const asset = await s.library.get(
      "visual_asset",
      s.f.storeId,
      result.result!.assetId!,
    );
    expect(asset!.entity.provenance).toMatchObject({
      type: "USER_UPLOAD",
      confirmedBy: s.f.actorId,
    });
    expect(s.db.raw.prepare("SELECT * FROM source_documents").all()).toEqual(
      retainedBefore,
    );
    expect(
      s.db.raw.prepare("SELECT count(*) n FROM sync_outbox").get()!.n,
    ).toBe(before + 3);
    expect(
      s.db.raw
        .prepare(
          "SELECT count(*) n FROM local_jobs WHERE type='VISUAL_FILE_TRANSFER'",
        )
        .get()!.n,
    ).toBe(1);
    const reloaded = new CopilotVisualActionController(
      s.db,
      s.scope,
      visualActionDigest,
      randomUUID,
    );
    expect(
      (await reloaded.confirm(s.message, s.state.review!.basisHash, s.consent))
        .result,
    ).toEqual(result.result);
    expect(
      s.db.raw.prepare("SELECT count(*) n FROM sync_outbox").get()!.n,
    ).toBe(before + 3);
  } finally {
    s.db.raw.close();
  }
});
it.each([
  "NO_PHOTO",
  "NO_RIGHTS",
  "UNPREPARED",
  "CHANGED_SOURCE",
  "DELETED_SOURCE",
  "CHANGED_PRODUCT",
  "JOURNAL_FAIL",
  "CANCEL_AFTER_JOURNAL",
] as const)("does not partially apply source photo on %s", async (mode) => {
  const s = await visualActionFixture("ASSIGN_SOURCE");
  try {
    if (mode !== "UNPREPARED") await s.controller.prepareSourcePhoto(s.message);
    if (mode === "CHANGED_SOURCE")
      s.db.raw
        .prepare("UPDATE source_documents SET checksum=? WHERE id=?")
        .run(`sha256:${"d".repeat(64)}`, s.sourcePhoto.sourceDocumentId);
    if (mode === "DELETED_SOURCE")
      s.db.raw
        .prepare("UPDATE source_documents SET deleted_at=? WHERE id=?")
        .run(s.f.at, s.sourcePhoto.sourceDocumentId);
    if (mode === "CHANGED_PRODUCT")
      await s.products.upsertProduct(
        { ...s.f.product, label: "autre", version: 2 },
        { commandId: randomUUID(), deviceId: s.f.deviceId },
      );
    let live = true;
    const original = s.transaction.runAsync.bind(s.transaction);
    vi.spyOn(s.transaction, "runAsync").mockImplementation(
      async (sql, ...params) => {
        const r = await original(sql, ...params);
        if (sql.startsWith("INSERT INTO copilot_tool_results")) {
          if (mode === "JOURNAL_FAIL") throw Error("DISK_FAILURE");
          if (mode === "CANCEL_AFTER_JOURNAL") live = false;
        }
        return r;
      },
    );
    const snapshot = () =>
      [
        "visual_assets",
        "visual_identities",
        "product_visual_links",
        "sync_outbox",
        "local_jobs",
        "copilot_tool_results",
      ].map((t) => s.db.raw.prepare(`SELECT * FROM ${t}`).all());
    const before = snapshot();
    await expect(
      s.controller.confirm(
        s.message,
        s.state.review!.basisHash,
        {
          ...s.consent,
          photoReviewed: mode !== "NO_PHOTO",
          rightsConfirmed: mode !== "NO_RIGHTS",
        },
        undefined,
        () => live,
      ),
    ).rejects.toThrow();
    expect(snapshot()).toEqual(before);
  } finally {
    s.db.raw.close();
  }
});
it("requires the existing owner-verified original and exact captured bytes, outside the writer transaction", async () => {
  const s = await visualActionFixture("ASSIGN_SOURCE");
  try {
    const originals = {
      local: vi.fn(async () => ({
        localUri: "file:///owned-original.png",
        views: null,
      })),
      request: vi.fn(async () => {}),
    };
    const files = {
      capture: vi.fn(async () => s.capturedPhoto.source),
      uri: vi.fn(async () => s.capturedPhoto.uri),
      read: vi.fn(async () => new Uint8Array()),
    } as unknown as VisualFileStorage;
    const port = createVisualSourcePhotoPort(s.f.storeId, originals, files);
    const check = vi.fn();
    const prepared = await port.prepare(s.sourcePhoto, check);
    await port.verify(s.sourcePhoto, prepared, check);
    expect(files.capture).toHaveBeenCalledWith(
      s.f.storeId,
      "file:///owned-original.png",
    );
    expect(files.read).toHaveBeenCalledWith(
      s.f.storeId,
      "SOURCE",
      s.capturedPhoto.source,
    );
    await expect(
      port.verify(
        { ...s.sourcePhoto, checksum: `sha256:${"d".repeat(64)}` },
        prepared,
        check,
      ),
    ).rejects.toThrow("VISUAL_SOURCE_FILE_CHANGED");
    originals.local.mockResolvedValueOnce(null as never);
    await expect(port.prepare(s.sourcePhoto, check)).rejects.toThrow(
      "VISUAL_SOURCE_ORIGINAL_REQUIRED",
    );
    expect(originals.request).toHaveBeenCalledWith(
      s.sourcePhoto.sourceDocumentId,
    );
  } finally {
    s.db.raw.close();
  }
});
it("rolls back if the original becomes unavailable after the photo was viewed", async () => {
  const s = await visualActionFixture("ASSIGN_SOURCE");
  try {
    await s.controller.prepareSourcePhoto(s.message);
    s.sourcePhotoPort.verify = async () => {
      throw Error("SOURCE_ORIGINAL_UNAVAILABLE");
    };
    const before = s.db.raw.prepare("SELECT * FROM sync_outbox").all();
    await expect(
      s.controller.confirm(s.message, s.state.review!.basisHash, s.consent),
    ).rejects.toThrow("SOURCE_ORIGINAL_UNAVAILABLE");
    expect(s.db.raw.prepare("SELECT * FROM sync_outbox").all()).toEqual(before);
    expect(
      s.db.raw.prepare("SELECT count(*) n FROM copilot_tool_results").get()!.n,
    ).toBe(0);
  } finally {
    s.db.raw.close();
  }
});
it("does not admit source paths, fabricated approval or source arguments in the legacy capability", async () => {
  const { visualActionInputSchema, legacyVisualActionInputSchema } =
    await import("@fl-copilot/domain");
  const s = await visualActionFixture("ASSIGN_SOURCE");
  try {
    expect(visualActionInputSchema.safeParse(s.input).success).toBe(true);
    expect(legacyVisualActionInputSchema.safeParse(s.input).success).toBe(
      false,
    );
    for (const extra of [
      { localUri: "file:///foreign.png" },
      { rightsConfirmed: true },
      { ownerId: randomUUID() },
      { visualIdentityId: randomUUID() },
    ])
      expect(
        visualActionInputSchema.safeParse({ ...s.input, ...extra }).success,
      ).toBe(false);
  } finally {
    s.db.raw.close();
  }
});
it("does not confuse native capture time with the later server registration time", async () => {
  const s = await visualActionFixture("ASSIGN_SOURCE");
  try {
    const capturedAt = new Date(
      Date.parse(s.sourcePhoto.registeredAt) - 60_000,
    ).toISOString();
    s.db.raw
      .prepare("UPDATE source_documents SET created_at=? WHERE id=?")
      .run(capturedAt, s.sourcePhoto.sourceDocumentId);
    expect((await s.controller.open(s.message)).status).toBe("READY");
    await s.controller.prepareSourcePhoto(s.message);
    expect(
      (
        await s.controller.confirm(
          s.message,
          s.state.review!.basisHash,
          s.consent,
        )
      ).status,
    ).toBe("COMPLETED");
  } finally {
    s.db.raw.close();
  }
});
