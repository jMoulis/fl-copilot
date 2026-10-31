import { randomUUID } from "node:crypto";
import { nativeReceiptPublicationFixture } from "./test-receipt-publication-sqlite";
import { SourceDocumentRepository } from "../apps/mobile/src/documents/source-document-repository";
import { DocumentArchiveRepository } from "../apps/mobile/src/documents/document-archive-repository";
import { MercalysBatchRepository } from "../apps/mobile/src/documents/mercalys-batch-repository";
import { mercalysBatchInputSchema } from "../packages/domain/src/index";

export async function documentArchiveFixture(path = ":memory:", count = 3) {
  const s = await nativeReceiptPublicationFixture(path);
  const sources = new SourceDocumentRepository(s.a);
  const original = (await sources.getDocument(s.f.p.source.id))!;
  const originalFile = (await sources.getFileForDocument(original.id))!;
  const document = {
    ...original,
    id: randomUUID(),
    sourceType: "WEEKLY_COMMERCIAL_PDF" as const,
    originalFilename: "Pense-bête test.pdf",
    localFileUri: "file:///fixture.pdf",
    checksum: "sha256:" + "b".repeat(64),
    remoteUploadStatus: "LOCAL_ONLY" as const,
    remoteProcessingStatus: null,
    syncState: "LOCAL_ONLY" as const,
    remoteVersion: null,
    dirty: true,
  };
  const file = {
    ...originalFile,
    id: randomUUID(),
    sourceDocumentId: document.id,
    localUri: document.localFileUri,
    mimeType: "application/pdf",
    checksum: document.checksum,
    uploadStatus: "LOCAL_ONLY" as const,
  };
  await sources.createCommercialPdf({ document, file });
  const batch = mercalysBatchInputSchema.parse({
    id: randomUUID(),
    storeId: s.scope.storeId,
    ownerId: s.scope.ownerId,
    conversationId: null,
    createdAt: "2026-10-31T08:00:00.000Z",
    files: Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      filename: String(i) + ".xlsx",
      localUri: "file:///fixture-" + i + ".xlsx",
      sizeBytes: 1,
      checksum: "sha256:" + "c".repeat(64),
    })),
  });
  const batches = new MercalysBatchRepository(s.a, s.scope);
  await batches.create(batch);
  const archives = new DocumentArchiveRepository(s.a, s.scope);
  return {
    ...s,
    sources,
    document,
    batch,
    batches,
    archives,
    context: () => ({
      commandId: randomUUID(),
      deviceId: s.scope.deviceId,
      canWrite: () => true,
    }),
  };
}
