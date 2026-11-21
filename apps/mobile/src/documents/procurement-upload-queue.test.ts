import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { procurementPublicationFixture } from "../../../../scripts/test-procurement-publication-fixtures";
import { SourceUploadQueue } from "./source-upload-queue";
it("keeps ordering originals owner-scoped and uploads them without Mercalys or commercial processing", async () => {
  const f = await procurementPublicationFixture();
  try {
    await f.repository.publish(f.publicationInput, () => undefined);
    const init = vi.fn(async () => ({
      uploadId: randomUUID(),
      objectKey: "private-original",
      status: "UPLOAD_REQUIRED" as const,
      uploadUrl: "https://test.invalid/upload",
      expiresAt: null,
      headers: {},
    }));
    const complete = vi.fn(async () => ({
      sourceDocumentId: f.input.sourceDocumentId,
      remoteUploadStatus: "CONFIRMED" as const,
    }));
    const verify = vi.fn(async () => {
      throw Error("No Mercalys verification for ordering JSON");
    });
    const upload = vi.fn(async () => ({ localUri: f.input.localUri }));
    const queue = new SourceUploadQueue(
      f.device,
      { init, complete, verify },
      { upload },
    );
    expect(await queue.process(f.config.storeId, randomUUID())).toEqual({
      attempted: 0,
      confirmed: 0,
    });
    expect(init).not.toHaveBeenCalled();
    expect(await queue.process(f.config.storeId, f.ownerId)).toEqual({
      attempted: 1,
      confirmed: 1,
    });
    expect(init).toHaveBeenCalledWith(
      f.config.storeId,
      expect.objectContaining({
        sourceType: "PROCUREMENT_CATALOGUE",
        mimeType: "application/json",
      }),
      f.ownerId,
    );
    expect(complete).toHaveBeenCalledWith(
      f.config.storeId,
      expect.any(String),
      { checksum: f.input.checksum, sizeBytes: f.bytes.length },
      f.ownerId,
    );
    expect(verify).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(
      f.device.raw
        .prepare("SELECT retention_status,upload_status FROM local_files")
        .get(),
    ).toEqual({ retention_status: "RETAINED", upload_status: "CONFIRMED" });
  } finally {
    f.device.raw.close();
  }
});
