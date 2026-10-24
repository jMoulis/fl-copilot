import { createHash, randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import { readCommercialOriginal } from "../src/copilot/commercial-original-reader";
import { commercialPdfFixture } from "./fixtures/commercial-pdf";

function fixture() {
  const storeId = randomUUID(),
    sourceDocumentId = randomUUID(),
    pdf = commercialPdfFixture([
      "Semaine 43, tomate 1,99 euros",
      "Semaine 44, avocat 2,50 euros",
    ]),
    abort = new AbortController();
  const source = {
    _id: sourceDocumentId,
    storeId,
    sourceType: "WEEKLY_COMMERCIAL_PDF",
    originalFilename: "op.pdf",
    checksum: `sha256:${createHash("sha256").update(pdf).digest("hex")}`,
    sizeBytes: pdf.length,
    mimeType: "application/pdf",
    objectKey: "private/registered-original.pdf",
    createdAt: new Date("2026-10-01T10:00:00Z"),
    remoteUploadStatus: "CONFIRMED",
    deletedAt: null as Date | null,
  };
  const collections: string[] = [];
  const db = {
    collection: (name: string) => {
      collections.push(name);
      if (name !== "sourceDocuments")
        throw Error("No workflow or writes permitted");
      return {
        findOne: async (query: Record<string, unknown>) =>
          Object.entries(query).every(
            ([k, v]) => source[k as keyof typeof source] === v,
          )
            ? source
            : null,
      };
    },
  } as unknown as Db;
  const read = vi.fn(async () => pdf.slice());
  return {
    storeId,
    sourceDocumentId,
    pdf,
    abort,
    source,
    db,
    read,
    collections,
  };
}
it("reads a registered original containing future weeks before any processing job, with real PDF parsing and unchanged bytes", async () => {
  const f = fixture(),
    r = await readCommercialOriginal(
      f.db,
      f.storeId,
      { sourceDocumentId: f.sourceDocumentId },
      f.abort.signal,
      { read: f.read },
    );
  expect(r.pdf).toEqual(f.pdf);
  expect(r.snapshot.source.pageCount).toBe(2);
  expect(f.collections).toEqual(["sourceDocuments", "sourceDocuments"]);
  expect(JSON.stringify(r.snapshot)).not.toContain(f.source.objectKey);
  expect(f.read).toHaveBeenCalledWith(f.source.objectKey, {
    maximumBytes: f.pdf.length,
    signal: f.abort.signal,
  });
});
it.each([
  "FOREIGN_STORE",
  "FOREIGN_ID",
  "PENDING",
  "DELETED",
  "WRONG_TYPE",
  "OVERSIZE",
])("rejects %s before private storage is read", async (mode) => {
  const f = fixture();
  let store = f.storeId,
    id = f.sourceDocumentId;
  if (mode === "FOREIGN_STORE") store = randomUUID();
  if (mode === "FOREIGN_ID") id = randomUUID();
  if (mode === "PENDING") f.source.remoteUploadStatus = "PENDING";
  if (mode === "DELETED") f.source.deletedAt = new Date();
  if (mode === "WRONG_TYPE") f.source.sourceType = "WASTE_RECEIPT";
  if (mode === "OVERSIZE") f.source.sizeBytes = 21 * 1024 * 1024;
  await expect(
    readCommercialOriginal(
      f.db,
      store,
      { sourceDocumentId: id },
      f.abort.signal,
      { read: f.read },
    ),
  ).rejects.toThrow();
  expect(f.read).not.toHaveBeenCalled();
});
it.each(["CORRUPT", "REMOVED", "CHANGED", "ABORT"])(
  "rejects %s without a success snapshot",
  async (mode) => {
    const f = fixture();
    const read = async () => {
      if (mode === "CORRUPT") return new Uint8Array(f.pdf.length);
      if (mode === "REMOVED") f.source.deletedAt = new Date();
      if (mode === "CHANGED") f.source.checksum = `sha256:${"a".repeat(64)}`;
      if (mode === "ABORT") f.abort.abort();
      return f.pdf.slice();
    };
    await expect(
      readCommercialOriginal(
        f.db,
        f.storeId,
        { sourceDocumentId: f.sourceDocumentId },
        f.abort.signal,
        { read },
      ),
    ).rejects.toThrow();
  },
);
