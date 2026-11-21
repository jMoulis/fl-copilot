import {
  procurementCatalogueDraftSchema,
  MAX_PROCUREMENT_SOURCE_BYTES,
  type ProcurementCatalogueDraft,
} from "@fl-copilot/domain";
import {
  parseProcurementCatalogue,
  procurementCatalogueBytes,
} from "@fl-copilot/import-core";
import { z } from "zod";
import { SourceDocumentRepository } from "./source-document-repository";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";

const inputSchema = z.strictObject({
  id: z.uuid(),
  storeId: z.uuid(),
  ownerId: z.uuid(),
  sourceDocumentId: z.uuid(),
  sourceRecordId: z.uuid(),
  fileId: z.uuid(),
  filename: z.string().trim().min(1).max(255),
  // Caller must copy the file into app-owned durable storage before staging.
  localUri: z
    .string()
    .startsWith("file://")
    .refine((s) => !s.includes("\0")),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  importedAt: z.string().datetime({ offset: true }),
  expectedPdv: z.string().regex(/^\d{1,12}$/),
});
type DraftInput = z.infer<typeof inputSchema>;
type DraftRow = {
  id: string;
  store_id: string;
  owner_id: string;
  source_document_id: string;
  checksum: string;
  normalized_checksum: string;
  imported_at: string;
  normalized_payload_json: string;
};

/** Private local staging, with no publication, upload or Product mutation.
 * Publication/Outbox and server authority are a subsequent explicit review step.
 */
export class ProcurementCatalogueDraftRepository {
  constructor(
    private readonly db: OutboxDatabase & AtomicMutationDatabase,
    private readonly originals: {
      read(localUri: string, maximumBytes: number): Promise<Uint8Array>;
      sha256(bytes: Uint8Array): Promise<string>;
    },
  ) {}

  async stage(raw: DraftInput, assertCurrentScope: () => void) {
    const input = inputSchema.parse(raw);
    assertCurrentScope();
    const bytes = await this.originals.read(
      input.localUri,
      MAX_PROCUREMENT_SOURCE_BYTES,
    );
    if (!bytes.length || bytes.length > MAX_PROCUREMENT_SOURCE_BYTES)
      throw Error("PROCUREMENT_SOURCE_SIZE_INVALID");
    if ((await this.originals.sha256(bytes)) !== input.checksum)
      throw Error("PROCUREMENT_SOURCE_CHANGED");
    const catalogue = parseProcurementCatalogue(bytes, input.expectedPdv);
    const draft = procurementCatalogueDraftSchema.parse({
      id: input.id,
      storeId: input.storeId,
      ownerId: input.ownerId,
      sourceDocumentId: input.sourceDocumentId,
      checksum: input.checksum,
      normalizedChecksum: await this.originals.sha256(
        procurementCatalogueBytes(catalogue),
      ),
      importedAt: input.importedAt,
      catalogue,
    });
    let result = { draft, duplicate: false };
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      assertCurrentScope();
      const prior = await readDraft(
        tx,
        input.storeId,
        input.ownerId,
        input.checksum,
      );
      if (prior) {
        if (prior.normalizedChecksum !== draft.normalizedChecksum)
          throw Error("PROCUREMENT_DRAFT_NORMALIZATION_CHANGED");
        result = { draft: prior, duplicate: true };
        return;
      }
      const sources = new SourceDocumentRepository(joinedMutationDatabase(tx));
      await sources.createWithFile({
        document: {
          id: input.sourceDocumentId,
          storeId: input.storeId,
          sourceType: "PROCUREMENT_CATALOGUE",
          originalFilename: input.filename,
          localFileUri: input.localUri,
          checksum: input.checksum,
          sourceGeneratedAt: catalogue.asOf,
          businessPeriodStart: null,
          businessPeriodEnd: null,
          localProcessingStatus: "TO_VALIDATE",
          remoteUploadStatus: "LOCAL_ONLY",
          remoteProcessingStatus: null,
          parserVersion: catalogue.parserVersion,
          extractionModelVersion: null,
          version: 1,
          createdAt: input.importedAt,
          updatedAt: input.importedAt,
          deletedAt: null,
          syncState: "LOCAL_ONLY",
          remoteVersion: null,
          dirty: true,
        },
        file: {
          id: input.fileId,
          storeId: input.storeId,
          sourceDocumentId: input.sourceDocumentId,
          localUri: input.localUri,
          mimeType: "application/json",
          sizeBytes: bytes.length,
          checksum: input.checksum,
          retentionStatus: "RETAINED",
          uploadStatus: "LOCAL_ONLY",
          createdAt: input.importedAt,
          updatedAt: input.importedAt,
        },
      });
      // One immutable normalized snapshot in the existing source-record path.
      // Source indexes inside offers retain their original article position.
      await sources.addRecords([
        {
          id: input.sourceRecordId,
          storeId: input.storeId,
          sourceDocumentId: input.sourceDocumentId,
          sourceIndex: 0,
          sourcePage: null,
          rawPayload: {
            pdv: catalogue.pdv,
            assortmentId: catalogue.assortmentId,
            asOf: catalogue.asOf,
          },
          normalizedPayload: catalogue,
          status: "PARSED",
          errorCodes: [],
          warningCodes: [],
          version: 1,
          createdAt: input.importedAt,
          updatedAt: input.importedAt,
          deletedAt: null,
        },
      ]);
      await tx.runAsync(
        "INSERT INTO procurement_catalogue_drafts(id,store_id,owner_id,source_document_id,source_record_id,checksum,normalized_checksum,imported_at) VALUES(?,?,?,?,?,?,?,?)",
        input.id,
        input.storeId,
        input.ownerId,
        input.sourceDocumentId,
        input.sourceRecordId,
        input.checksum,
        draft.normalizedChecksum,
        input.importedAt,
      );
      assertCurrentScope();
    });
    // Never remove any original here, including a second selected copy.
    return result;
  }

  async get(
    storeId: string,
    ownerId: string,
    checksum: string,
  ): Promise<ProcurementCatalogueDraft | null> {
    z.uuid().parse(storeId);
    z.uuid().parse(ownerId);
    z.string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .parse(checksum);
    return readDraft(this.db, storeId, ownerId, checksum);
  }
}

async function readDraft(
  db: OutboxDatabase,
  storeId: string,
  ownerId: string,
  checksum: string,
) {
  const row = await db.getFirstAsync<DraftRow>(
    `SELECT d.*,r.normalized_payload_json FROM procurement_catalogue_drafts d
    JOIN source_records r ON r.id=d.source_record_id AND r.store_id=d.store_id
    AND r.source_document_id=d.source_document_id AND r.deleted_at IS NULL
    WHERE d.store_id=? AND d.owner_id=? AND d.checksum=?`,
    storeId,
    ownerId,
    checksum,
  );
  if (!row) return null;
  return procurementCatalogueDraftSchema.parse({
    id: row.id,
    storeId: row.store_id,
    ownerId: row.owner_id,
    sourceDocumentId: row.source_document_id,
    checksum: row.checksum,
    normalizedChecksum: row.normalized_checksum,
    importedAt: row.imported_at,
    catalogue: JSON.parse(row.normalized_payload_json),
  });
}
