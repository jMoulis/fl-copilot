import { attachRecoveredSourceOriginal } from "./source-original-links";
import {
  mercalysPublicationSchema,
  synchronizedMercalysPublicationSchema,
  type MercalysPublication,
} from "@fl-copilot/sync-contracts";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { enqueueAnalyticsRecomputationJob } from "../analytics/local-recomputation";
import { localOperationFailureCode } from "../observability/local-operation-failure";

type Row = Record<string, string | number | null>;
function camel(row: Row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, s: string) => s.toUpperCase()),
      v,
    ]),
  );
}
export async function readMercalysPublication(
  tx: OutboxDatabase,
  storeId: string,
  id: string,
): Promise<MercalysPublication | null> {
  const source = await tx.getFirstAsync<Row>(
    "SELECT * FROM source_documents WHERE id=? AND store_id=? AND source_type IN ('MERCALYS_SALES','MERCALYS_WASTE') AND local_processing_status='PUBLISHED' AND deleted_at IS NULL",
    id,
    storeId,
  );
  if (!source) return null;
  const records = await tx.getAllAsync<Row>(
    "SELECT * FROM source_records WHERE source_document_id=? AND store_id=? ORDER BY source_index,id",
    id,
    storeId,
  );
  const read = async (table: string) =>
    (
      await tx.getAllAsync<Row>(
        `SELECT * FROM ${table} WHERE source_document_id=? AND store_id=? ORDER BY id`,
        id,
        storeId,
      )
    ).map(camel);
  return mercalysPublicationSchema.parse({
    source: camel(source),
    records: records.map((r) => ({
      ...camel(r),
      rawPayload: JSON.parse(String(r.raw_payload_json)),
      normalizedPayload: JSON.parse(String(r.normalized_payload_json)),
      errorCodes: JSON.parse(String(r.error_codes_json)),
      warningCodes: JSON.parse(String(r.warning_codes_json)),
    })),
    sales: await read("sales_observations"),
    waste: await read("waste_observations"),
  });
}
/** Called inside the publication transaction; also repairs pre-upgrade publications. */
export async function enqueueMercalysPublications(
  tx: OutboxDatabase,
  storeId: string,
  generateId: () => string,
  now: string,
  sourceIds?: readonly string[],
) {
  if (sourceIds?.length === 0) return;
  const device = await tx.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key='device_id'",
  );
  if (!device) throw Error("MERCALYS_DEVICE_ID_REQUIRED");
  const sources = await tx.getAllAsync<{ id: string }>(
    `SELECT id FROM source_documents WHERE store_id=? AND source_type IN ('MERCALYS_SALES','MERCALYS_WASTE') AND local_processing_status='PUBLISHED' AND deleted_at IS NULL ${sourceIds ? `AND id IN (${sourceIds.map(() => "?").join(",")})` : ""} ORDER BY created_at,id`,
    storeId,
    ...(sourceIds ?? []),
  );
  for (const { id } of sources) {
    const pending = await tx.getFirstAsync(
      "SELECT command_id FROM sync_outbox WHERE store_id=? AND entity_type='mercalys_publication' AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED')",
      storeId,
      id,
    );
    if (pending) continue;
    const payload = await readMercalysPublication(tx, storeId, id);
    if (!payload) continue;
    const json = JSON.stringify(payload);
    const prior = await tx.getFirstAsync<{
      remote_version: number | null;
      last_payload_json: string;
    }>(
      "SELECT * FROM mercalys_publication_sync WHERE source_document_id=? AND store_id=?",
      id,
      storeId,
    );
    if (prior?.last_payload_json === json && prior.remote_version !== null)
      continue;
    await new OutboxRepository(tx, () => now).enqueue({
      commandId: generateId(),
      storeId,
      deviceId: device.value,
      commandType: "MERCALYS_PUBLISH",
      entityType: "mercalys_publication",
      entityId: id,
      expectedRemoteVersion: prior?.remote_version ?? null,
      payload,
      createdAt: now,
    });
    await tx.runAsync(
      "UPDATE source_documents SET sync_state='PENDING',dirty=1 WHERE id=? AND store_id=?",
      id,
      storeId,
    );
    await tx.runAsync(
      "UPDATE local_files SET retention_status='RETAINED' WHERE source_document_id=? AND store_id=? AND retention_status!='REMOVED'",
      id,
      storeId,
    );
  }
}
export async function repairMercalysPublications(
  db: AtomicMutationDatabase & OutboxDatabase,
  storeId: string,
  generateId: () => string,
  reportFailure?: (reason: unknown) => void,
) {
  // Do not hold the SQLite writer while rereading the complete historical catalogue.
  // Clean acknowledged sources need no repair. A damaged source must not block
  // independently valid publications, product commands, or the subsequent sync.
  const sources = await db.getAllAsync<{ id: string }>(
    `SELECT d.id FROM source_documents d WHERE d.store_id=?
     AND d.source_type IN ('MERCALYS_SALES','MERCALYS_WASTE')
     AND d.local_processing_status='PUBLISHED' AND d.deleted_at IS NULL
     AND (d.dirty=1 OR NOT EXISTS (SELECT 1 FROM mercalys_publication_sync s
       WHERE s.store_id=d.store_id AND s.source_document_id=d.id AND s.remote_version IS NOT NULL)
       OR EXISTS (SELECT 1 FROM local_jobs j WHERE j.type='MERCALYS_PUBLICATION_REPAIR'
         AND j.status='FAILED' AND json_extract(j.payload_json,'$.storeId')=d.store_id
         AND json_extract(j.payload_json,'$.sourceDocumentId')=d.id))
     AND NOT EXISTS (SELECT 1 FROM sync_outbox o WHERE o.store_id=d.store_id
       AND o.entity_type='mercalys_publication' AND o.entity_id=d.id
       AND o.status IN ('PENDING','SYNCING','CONFLICT','FAILED'))
     ORDER BY d.created_at,d.id`,
    storeId,
  );
  for (const { id } of sources) {
    const timestamp = new Date().toISOString(),
      jobId = `mercalys-repair:${storeId}:${id}`;
    try {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await enqueueMercalysPublications(tx, storeId, generateId, timestamp, [
          id,
        ]);
        await tx.runAsync(
          "UPDATE local_jobs SET status='COMPLETED',last_error=NULL,updated_at=? WHERE id=? AND type='MERCALYS_PUBLICATION_REPAIR'",
          timestamp,
          jobId,
        );
      });
    } catch (reason) {
      try {
        reportFailure?.(reason);
      } catch {
        /* Diagnostics cannot block unrelated commands. */
      }
      // A durable, source-scoped diagnostic stays visible in Synchronisation;
      // neither the source nor its observations or existing commands are removed.
      await db.runAsync(
        `INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,last_error,created_at,updated_at)
        VALUES(?,'MERCALYS_PUBLICATION_REPAIR',?,'FAILED',1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status='FAILED',attempt_count=attempt_count+1,last_error=excluded.last_error,updated_at=excluded.updated_at`,
        jobId,
        JSON.stringify({ storeId, sourceDocumentId: id }),
        localOperationFailureCode(reason) ??
          "MERCALYS_PUBLICATION_REPAIR_FAILED",
        timestamp,
        timestamp,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
/** Frozen snapshots queue in source order, including an initial packet not yet acknowledged. */
export async function enqueueMercalysContinuation(
  tx: OutboxDatabase,
  storeId: string,
  sourceId: string,
  generateId: () => string,
  now: string,
) {
  const prior = await tx.getFirstAsync<{
    status: string;
    expected_remote_version: number | null;
    payload_json: string;
  }>(
    "SELECT status,expected_remote_version,payload_json FROM sync_outbox WHERE store_id=? AND entity_type='mercalys_publication' AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') ORDER BY local_sequence DESC LIMIT 1",
    storeId,
    sourceId,
  );
  if (prior && ["CONFLICT", "FAILED"].includes(prior.status))
    throw Error("MERCALYS_CONTINUATION_CONFLICT");
  const payload = await readMercalysPublication(tx, storeId, sourceId);
  if (!payload) throw Error("MERCALYS_CONTINUATION_SOURCE_CHANGED");
  const json = JSON.stringify(payload);
  if (prior?.payload_json === json) return;
  const journal = await tx.getFirstAsync<{ remote_version: number | null }>(
    "SELECT remote_version FROM mercalys_publication_sync WHERE store_id=? AND source_document_id=?",
    storeId,
    sourceId,
  );
  const device = await tx.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key='device_id'",
  );
  if (!device) throw Error("MERCALYS_DEVICE_ID_REQUIRED");
  await new OutboxRepository(tx, () => now).enqueue({
    commandId: generateId(),
    storeId,
    deviceId: device.value,
    commandType: "MERCALYS_PUBLISH",
    entityType: "mercalys_publication",
    entityId: sourceId,
    expectedRemoteVersion: prior
      ? (prior.expected_remote_version ?? 0) + 1
      : (journal?.remote_version ?? null),
    payload,
    createdAt: now,
  });
  await tx.runAsync(
    "UPDATE source_documents SET sync_state='PENDING',dirty=1 WHERE id=? AND store_id=?",
    sourceId,
    storeId,
  );
  await tx.runAsync(
    "UPDATE local_files SET retention_status='RETAINED' WHERE source_document_id=? AND store_id=? AND retention_status!='REMOVED'",
    sourceId,
    storeId,
  );
}
function snake(key: string) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
async function insertObject(
  tx: OutboxDatabase,
  table: string,
  value: Record<string, unknown>,
) {
  const keys = Object.keys(value);
  await tx.runAsync(
    `INSERT INTO ${table} (${keys.map(snake).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    ...keys.map((k) => value[k] as string | number | null),
  );
}
export async function applyMercalysPublication(
  tx: OutboxDatabase,
  storeId: string,
  entity: unknown,
  acknowledgement = false,
) {
  const snapshot = synchronizedMercalysPublicationSchema.parse(entity),
    p = snapshot.publication;
  if (
    snapshot.storeId !== storeId ||
    p.source.storeId !== storeId ||
    snapshot.id !== p.source.id
  )
    throw Error("MERCALYS_PUBLICATION_STORE_MISMATCH");
  const journal = await tx.getFirstAsync<{ remote_version: number | null }>(
    "SELECT * FROM mercalys_publication_sync WHERE source_document_id=? AND store_id=?",
    snapshot.id,
    storeId,
  );
  if ((journal?.remote_version ?? 0) >= snapshot.remoteVersion) return;
  if (
    !acknowledgement &&
    (await tx.getFirstAsync(
      "SELECT command_id FROM sync_outbox WHERE entity_type='mercalys_publication' AND entity_id=? AND store_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED')",
      snapshot.id,
      storeId,
    ))
  )
    return;
  const existingSource = await tx.getFirstAsync<{ store_id: string }>(
    "SELECT store_id FROM source_documents WHERE id=?",
    snapshot.id,
  );
  if (existingSource && existingSource.store_id !== storeId)
    throw Error("MERCALYS_PUBLICATION_STORE_MISMATCH");
  if (!existingSource)
    await tx.runAsync(
      `INSERT INTO source_documents(id,store_id,source_type,original_filename,local_file_uri,checksum,business_period_start,business_period_end,local_processing_status,remote_upload_status,remote_processing_status,parser_version,version,created_at,updated_at,sync_state,remote_version,dirty) VALUES(?,?,?,?,NULL,?,?,?,'PUBLISHED','CONFIRMED','PUBLISHED',?,1,?,?,'SYNCED',?,0)`,
      snapshot.id,
      storeId,
      p.source.sourceType,
      p.source.originalFilename,
      p.source.checksum,
      p.source.businessPeriodStart,
      p.source.businessPeriodEnd,
      p.source.parserVersion,
      p.source.createdAt,
      p.source.createdAt,
      snapshot.remoteVersion,
    );
  await attachRecoveredSourceOriginal(tx, storeId, snapshot.id);
  for (const r of p.records) {
    const exists = await tx.getFirstAsync<{
      store_id: string;
      source_document_id: string;
      version: number;
    }>(
      "SELECT store_id,source_document_id,version FROM source_records WHERE id=?",
      r.id,
    );
    if (
      exists &&
      (exists.store_id !== storeId || exists.source_document_id !== snapshot.id)
    )
      throw Error("MERCALYS_PUBLICATION_STORE_MISMATCH");
    if (!exists) {
      const {
        rawPayload,
        normalizedPayload,
        errorCodes,
        warningCodes,
        ...rest
      } = r;
      await insertObject(tx, "source_records", {
        ...rest,
        sourceIndex: r.sourceIndex ?? null,
        sourcePage: r.sourcePage ?? null,
        rawPayloadJson: JSON.stringify(rawPayload),
        normalizedPayloadJson: JSON.stringify(normalizedPayload),
        errorCodesJson: JSON.stringify(errorCodes),
        warningCodesJson: JSON.stringify(warningCodes),
      });
    } else if (r.version > exists.version) {
      await tx.runAsync(
        "UPDATE source_records SET normalized_payload_json=?,status=?,error_codes_json=?,warning_codes_json=?,version=?,updated_at=? WHERE id=? AND store_id=? AND source_document_id=? AND version<?",
        JSON.stringify(r.normalizedPayload),
        r.status,
        JSON.stringify(r.errorCodes),
        JSON.stringify(r.warningCodes),
        r.version,
        r.updatedAt,
        r.id,
        storeId,
        snapshot.id,
        r.version,
      );
    }
  }
  for (const [table, observations] of [
    ["sales_observations", p.sales],
    ["waste_observations", p.waste],
  ] as const) {
    for (const o of observations) {
      const current = await tx.getFirstAsync<{
        store_id: string;
        version: number;
        dirty: number;
        source_document_id: string;
      }>(
        `SELECT store_id,version,dirty,source_document_id FROM ${table} WHERE id=?`,
        o.id,
      );
      if (
        current &&
        (current.store_id !== storeId ||
          current.source_document_id !== snapshot.id)
      )
        throw Error("MERCALYS_PUBLICATION_STORE_MISMATCH");
      if (current && current.version > o.version) continue;
      if (current && !acknowledgement && current.dirty) continue;
      if (current)
        await tx.runAsync(
          `DELETE FROM ${table} WHERE id=? AND store_id=?`,
          o.id,
          storeId,
        );
      await insertObject(tx, table, {
        ...o,
        syncState: "SYNCED",
        remoteVersion: snapshot.remoteVersion,
        dirty: 0,
      });
    }
  }
  await tx.runAsync(
    "INSERT INTO mercalys_publication_sync(source_document_id,store_id,remote_version,last_payload_json) VALUES(?,?,?,?) ON CONFLICT(source_document_id) DO UPDATE SET remote_version=excluded.remote_version,last_payload_json=excluded.last_payload_json",
    snapshot.id,
    storeId,
    snapshot.remoteVersion,
    JSON.stringify(p),
  );
  const current = await readMercalysPublication(tx, storeId, snapshot.id);
  if (JSON.stringify(current) === JSON.stringify(p)) {
    await tx.runAsync(
      "UPDATE source_documents SET remote_processing_status='PUBLISHED',sync_state='SYNCED',dirty=0 WHERE id=? AND store_id=?",
      snapshot.id,
      storeId,
    );
    await tx.runAsync(
      "UPDATE local_files SET retention_status='CLEANUP_ELIGIBLE' WHERE source_document_id=? AND store_id=? AND upload_status='CONFIRMED' AND retention_status!='REMOVED'",
      snapshot.id,
      storeId,
    );
  }
  await enqueueAnalyticsRecomputationJob(tx, {
    jobId: `mercalys-publication:${snapshot.id}:${snapshot.remoteVersion}`,
    storeId,
    scopes: [...p.sales, ...p.waste].map((o) => ({
      productId: o.productId,
      businessDate: o.businessDate,
    })),
    createdAt: p.source.createdAt,
  });
}
