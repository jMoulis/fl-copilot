import { z } from "zod";
import {
  MAX_PROCUREMENT_SOURCE_BYTES,
  storeContextSettingsSchema,
} from "@fl-copilot/domain";
import {
  parseProcurementCatalogue,
  procurementCatalogueBytes,
  serializeProcurementCatalogue,
} from "@fl-copilot/import-core";
import {
  procurementPublicationSchema,
  synchronizedProcurementCatalogueSchema,
  serializeProcurementPublication,
  type ProcurementPublication,
} from "@fl-copilot/sync-contracts";
import { ProcurementCatalogueDraftRepository } from "./procurement-catalogue-draft";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";

export async function applyProcurementCatalogue(
  tx: OutboxDatabase,
  storeId: string,
  raw: unknown,
  acknowledgement = false,
) {
  const entity = synchronizedProcurementCatalogueSchema.parse(raw);
  const p = entity.publication;
  if (entity.storeId !== storeId)
    throw Error("PROCUREMENT_SNAPSHOT_SCOPE_INVALID");
  const old = await tx.getFirstAsync<{
    store_id: string;
    payload_json: string;
    dirty: number;
  }>(
    "SELECT store_id,payload_json,dirty FROM procurement_catalogue_snapshots WHERE id=?",
    entity.id,
  );
  if (old && old.store_id !== storeId)
    throw Error("PROCUREMENT_SNAPSHOT_SCOPE_INVALID");
  if (old && old.payload_json !== serializeProcurementPublication(p)) {
    if (old.dirty && !acknowledgement) return;
    throw Error("PROCUREMENT_SNAPSHOT_IMMUTABLE");
  }
  const duplicate = await tx.getFirstAsync<{ id: string; dirty: number }>(
    "SELECT id,dirty FROM procurement_catalogue_snapshots WHERE store_id=? AND checksum=?",
    storeId,
    p.checksum,
  );
  if (duplicate && duplicate.id !== entity.id) {
    // Push will record the immutable conflict and its remote snapshot. Do not
    // block unrelated pull changes or discard the offline user's confirmation.
    if (duplicate.dirty && !acknowledgement) return;
    throw Error("PROCUREMENT_SNAPSHOT_DUPLICATE_CONFLICT");
  }
  const source = await tx.getFirstAsync<{
    store_id: string;
    checksum: string;
    source_type: string;
  }>(
    "SELECT store_id,checksum,source_type FROM source_documents WHERE id=?",
    p.sourceDocumentId,
  );
  if (
    source &&
    (source.store_id !== storeId ||
      source.checksum !== p.checksum ||
      source.source_type !== "PROCUREMENT_CATALOGUE")
  )
    throw Error("PROCUREMENT_SNAPSHOT_SOURCE_CHANGED");
  if (!source)
    await tx.runAsync(
      `INSERT INTO source_documents(id,store_id,source_type,original_filename,checksum,source_generated_at,local_processing_status,remote_upload_status,remote_processing_status,parser_version,version,created_at,updated_at,sync_state,remote_version,dirty)
      VALUES(?,?,'PROCUREMENT_CATALOGUE',?,?,?,'PUBLISHED','CONFIRMED','PUBLISHED',?,1,?,?,'SYNCED',1,0)`,
      p.sourceDocumentId,
      storeId,
      p.originalFilename,
      p.checksum,
      p.catalogue.asOf,
      p.catalogue.parserVersion,
      p.importedAt,
      p.confirmedAt,
    );
  const record = await tx.getFirstAsync<{
    store_id: string;
    source_document_id: string;
    normalized_payload_json: string;
  }>(
    "SELECT store_id,source_document_id,normalized_payload_json FROM source_records WHERE id=?",
    p.sourceRecordId,
  );
  if (
    record &&
    (record.store_id !== storeId ||
      record.source_document_id !== p.sourceDocumentId ||
      serializeProcurementCatalogue(
        JSON.parse(record.normalized_payload_json),
      ) !== serializeProcurementCatalogue(p.catalogue))
  )
    throw Error("PROCUREMENT_SNAPSHOT_SOURCE_CHANGED");
  if (!record)
    await tx.runAsync(
      `INSERT INTO source_records(id,store_id,source_document_id,source_index,raw_payload_json,normalized_payload_json,status,error_codes_json,warning_codes_json,version,created_at,updated_at)
    VALUES(?,?,?,0,?,?,'PUBLISHED','[]','[]',1,?,?)`,
      p.sourceRecordId,
      storeId,
      p.sourceDocumentId,
      JSON.stringify({
        pdv: p.catalogue.pdv,
        assortmentId: p.catalogue.assortmentId,
        asOf: p.catalogue.asOf,
      }),
      serializeProcurementCatalogue(p.catalogue),
      p.importedAt,
      p.confirmedAt,
    );
  if (record)
    await tx.runAsync(
      "UPDATE source_records SET status='PUBLISHED' WHERE id=? AND store_id=? AND source_document_id=?",
      p.sourceRecordId,
      storeId,
      p.sourceDocumentId,
    );
  await tx.runAsync(
    `INSERT INTO procurement_catalogue_snapshots(id,store_id,source_document_id,checksum,as_of,payload_json,sync_state,remote_version,dirty)
    VALUES(?,?,?,?,?,?,'SYNCED',1,0) ON CONFLICT(id) DO UPDATE SET sync_state='SYNCED',remote_version=1,dirty=0`,
    p.id,
    storeId,
    p.sourceDocumentId,
    p.checksum,
    p.catalogue.asOf,
    serializeProcurementPublication(p),
  );
  await tx.runAsync(
    "UPDATE source_documents SET local_processing_status='PUBLISHED',remote_upload_status='CONFIRMED',sync_state='SYNCED',remote_version=1,dirty=0,remote_processing_status='PUBLISHED' WHERE id=? AND store_id=?",
    p.sourceDocumentId,
    storeId,
  );
  // Owner originals remain RETAINED even after publication; never attach a store-visible copy.
}

export class ProcurementPublicationRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private originals: ConstructorParameters<
      typeof ProcurementCatalogueDraftRepository
    >[1],
  ) {}

  async publish(
    input: {
      storeId: string;
      ownerId: string;
      checksum: string;
      normalizedChecksum: string;
      confirmedAt: string;
      commandId: string;
      deviceId: string;
    },
    assertCurrentScope: () => void,
  ) {
    z.uuid().parse(input.commandId);
    z.uuid().parse(input.deviceId);
    z.string().datetime({ offset: true }).parse(input.confirmedAt);
    assertCurrentScope();
    const drafts = new ProcurementCatalogueDraftRepository(
      this.db,
      this.originals,
    );
    const draft = await drafts.get(
      input.storeId,
      input.ownerId,
      input.checksum,
    );
    if (!draft || draft.normalizedChecksum !== input.normalizedChecksum)
      throw Error("PROCUREMENT_DRAFT_CHANGED");
    const source = await this.db.getFirstAsync<{
      original_filename: string;
      local_uri: string;
      id: string;
      source_record_id: string;
    }>(
      `SELECT s.original_filename,f.local_uri,f.id,d.source_record_id FROM procurement_catalogue_drafts d
      JOIN source_documents s ON s.id=d.source_document_id AND s.store_id=d.store_id
      JOIN local_files f ON f.source_document_id=s.id AND f.store_id=s.store_id AND f.checksum=s.checksum
      WHERE d.id=? AND d.store_id=? AND d.owner_id=? AND s.deleted_at IS NULL AND f.retention_status='RETAINED' AND f.local_uri=s.local_file_uri`,
      draft.id,
      input.storeId,
      input.ownerId,
    );
    if (!source) throw Error("PROCUREMENT_ORIGINAL_REQUIRED");
    const bytes = await this.originals.read(
      source.local_uri,
      MAX_PROCUREMENT_SOURCE_BYTES,
    );
    if (
      (await this.originals.sha256(bytes)) !== draft.checksum ||
      (await this.originals.sha256(
        procurementCatalogueBytes(draft.catalogue),
      )) !== draft.normalizedChecksum ||
      serializeProcurementCatalogue(
        parseProcurementCatalogue(bytes, draft.catalogue.pdv),
      ) !== serializeProcurementCatalogue(draft.catalogue)
    )
      throw Error("PROCUREMENT_SOURCE_CHANGED");
    const p = procurementPublicationSchema.parse({
      ...draft,
      sourceRecordId: source.source_record_id,
      originalFilename: source.original_filename,
      confirmedAt: input.confirmedAt,
    });
    let result: ProcurementPublication = p;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      assertCurrentScope();
      const current = await tx.getFirstAsync<{ normalized_checksum: string }>(
        "SELECT normalized_checksum FROM procurement_catalogue_drafts WHERE id=? AND store_id=? AND owner_id=?",
        draft.id,
        input.storeId,
        input.ownerId,
      );
      if (current?.normalized_checksum !== draft.normalizedChecksum)
        throw Error("PROCUREMENT_DRAFT_CHANGED");
      const config = await tx.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM store_context_settings WHERE store_id=?",
        input.storeId,
      );
      const pdv = config
        ? storeContextSettingsSchema.parse(JSON.parse(config.payload_json))
            .pdvCode
        : null;
      if (!pdv || BigInt(pdv) !== BigInt(draft.catalogue.pdv))
        throw Error("PROCUREMENT_STORE_PDV_REQUIRED");
      const existing = await tx.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM procurement_catalogue_snapshots WHERE store_id=? AND checksum=?",
        input.storeId,
        input.checksum,
      );
      if (existing) {
        result = procurementPublicationSchema.parse(
          JSON.parse(existing.payload_json),
        );
        return;
      }
      const sameDate = await tx.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM procurement_catalogue_snapshots WHERE store_id=? AND as_of=? ORDER BY id LIMIT 1",
        input.storeId,
        p.catalogue.asOf,
      );
      if (sameDate) {
        const prior = procurementPublicationSchema.parse(
          JSON.parse(sameDate.payload_json),
        );
        if (prior.normalizedChecksum !== p.normalizedChecksum)
          throw Error("PROCUREMENT_ASOF_CONFLICT");
        result = prior;
        return;
      }
      await tx.runAsync(
        "INSERT INTO procurement_catalogue_snapshots(id,store_id,source_document_id,checksum,as_of,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,?,'PENDING',1)",
        p.id,
        p.storeId,
        p.sourceDocumentId,
        p.checksum,
        p.catalogue.asOf,
        serializeProcurementPublication(p),
      );
      await tx.runAsync(
        "UPDATE source_documents SET local_processing_status='PUBLISHED',remote_upload_status='PENDING',sync_state='PENDING',dirty=1 WHERE id=? AND store_id=?",
        p.sourceDocumentId,
        p.storeId,
      );
      await tx.runAsync(
        "UPDATE source_records SET status='PUBLISHED' WHERE id=? AND store_id=? AND source_document_id=?",
        p.sourceRecordId,
        p.storeId,
        p.sourceDocumentId,
      );
      await tx.runAsync(
        "UPDATE local_files SET upload_status='PENDING' WHERE id=? AND store_id=?",
        source.id,
        p.storeId,
      );
      await tx.runAsync(
        "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,created_at,updated_at) VALUES(?,'SOURCE_UPLOAD_AND_REGISTER',?,'PENDING',0,?,?)",
        p.sourceDocumentId,
        JSON.stringify({
          storeId: p.storeId,
          ownerId: p.ownerId,
          sourceDocumentId: p.sourceDocumentId,
          localFileId: source.id,
        }),
        p.confirmedAt,
        p.confirmedAt,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: input.commandId,
        deviceId: input.deviceId,
        storeId: p.storeId,
        entityId: p.id,
        entityType: "procurement_catalogue_snapshot",
        commandType: "PROCUREMENT_CATALOGUE_PUBLISH",
        expectedRemoteVersion: null,
        payload: p,
        createdAt: p.confirmedAt,
      });
      assertCurrentScope();
    });
    return result;
  }
}
