import {
  MAX_MERCALYS_BATCH_FILE_BYTES,
  sourceOriginalRestorationSchema,
  type SourceOriginalRestoration,
} from "@fl-copilot/domain";
import { z } from "zod";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { assertIntakeConversation } from "./intake-conversation";

type Database = OutboxDatabase & AtomicMutationDatabase;
export type UploadIntakeScope = { ownerId: string; conversationId: string };
const payloadSchema = z.strictObject({
  storeId: z.uuid(),
  sourceDocumentId: z.uuid(),
  localFileId: z.uuid(),
});
const supportedSources = [
  "MERCALYS_SALES",
  "MERCALYS_WASTE",
  "WEEKLY_COMMERCIAL_PDF",
];
interface DocumentRow {
  id: string;
  store_id: string;
  source_type: string;
  original_filename: string | null;
  checksum: string | null;
  local_file_uri: string | null;
  remote_upload_status: string;
  sync_state: string;
  deleted_at: string | null;
}
interface JobRow {
  id: string;
  payload_json: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error: string | null;
  updated_at: string;
}
interface FileRow {
  id: string;
  store_id: string;
  source_document_id: string | null;
  checksum: string;
  local_uri: string;
  retention_status: string;
  upload_status: string;
  mime_type: string;
  size_bytes: number;
}
export class SourceUploadRecoveryRepository {
  constructor(
    private readonly db: Database,
    private readonly digest: (text: string) => Promise<string>,
    private readonly now = () => new Date().toISOString(),
  ) {}
  private async read(
    db: OutboxDatabase,
    storeId: string,
    id: string,
    scope?: UploadIntakeScope,
  ) {
    if (scope)
      await assertIntakeConversation(
        db,
        { storeId, ...scope },
        scope.conversationId,
      );
    const document = await db.getFirstAsync<DocumentRow>(
      `SELECT id,store_id,source_type,original_filename,checksum,local_file_uri,remote_upload_status,sync_state,deleted_at FROM source_documents d WHERE id=? AND store_id=?
       ${scope ? `AND EXISTS (SELECT 1 FROM mercalys_intake_batches b, json_each(b.request_json,'$.files') f WHERE b.store_id=d.store_id AND b.owner_id=? AND b.conversation_id=? AND json_extract(f.value,'$.checksum')=d.checksum)` : ""}`,
      id,
      storeId,
      ...(scope ? [scope.ownerId, scope.conversationId] : []),
    );
    if (
      !document ||
      document.deleted_at ||
      !supportedSources.includes(document.source_type)
    )
      throw Error("SOURCE_RECOVERY_UNAVAILABLE");
    const jobs = await db.getAllAsync<JobRow>(
      `SELECT id,payload_json,status,attempt_count,next_attempt_at,last_error,updated_at FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.sourceDocumentId')=? ORDER BY id LIMIT 2`,
      storeId,
      id,
    );
    const files = await db.getAllAsync<FileRow>(
      "SELECT id,store_id,source_document_id,checksum,local_uri,retention_status,upload_status,mime_type,size_bytes FROM local_files WHERE source_document_id=? AND store_id=? ORDER BY id LIMIT 2",
      id,
      storeId,
    );
    const job = jobs.length === 1 ? jobs[0] : undefined;
    const file = files.length === 1 ? files[0] : undefined;
    const payload = payloadSchema.safeParse(
      job ? JSON.parse(job.payload_json) : null,
    );
    const blockedCommand = await db.getFirstAsync(
      "SELECT command_id FROM sync_outbox WHERE store_id=? AND entity_id=? AND entity_type='mercalys_publication' AND status IN ('FAILED','CONFLICT') LIMIT 1",
      storeId,
      id,
    );
    const openConflict = await db.getFirstAsync(
      "SELECT id FROM sync_conflicts WHERE store_id=? AND entity_id=? AND entity_type IN ('mercalys_publication','source_document') AND status='OPEN' LIMIT 1",
      storeId,
      id,
    );
    const consistentOriginal = !!(
      job &&
      file &&
      payload.success &&
      payload.data.storeId === storeId &&
      payload.data.sourceDocumentId === id &&
      payload.data.localFileId === file.id &&
      file.checksum === document.checksum &&
      file.local_uri === document.local_file_uri &&
      file.retention_status === "RETAINED" &&
      file.local_uri
    );
    const canRestore = !!(
      !blockedCommand &&
      !openConflict &&
      consistentOriginal &&
      document.remote_upload_status === "FAILED" &&
      document.sync_state === "ERROR" &&
      job?.status === "FAILED" &&
      job.last_error === "SOURCE_UPLOAD_LOCAL_FILE_MISSING" &&
      file?.upload_status === "FAILED" &&
      /^sha256:[a-f0-9]{64}$/.test(file.checksum) &&
      Number.isSafeInteger(file.size_bytes) &&
      file.size_bytes > 0 &&
      file.size_bytes <=
        (document.source_type === "WEEKLY_COMMERCIAL_PDF"
          ? 100 * 1024 * 1024
          : MAX_MERCALYS_BATCH_FILE_BYTES) &&
      file.mime_type ===
        (document.source_type === "WEEKLY_COMMERCIAL_PDF"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    );
    let reason: string | null = null;
    if (document.remote_upload_status === "CONFIRMED")
      reason =
        "L’original est déjà envoyé. Une analyse en attente se suit séparément ; renvoyer le fichier ne la relancerait pas.";
    else if (document.sync_state === "CONFLICT")
      reason = "Examinez la différence d’import avant de reprendre l’envoi.";
    else if (
      job?.status === "RUNNING" ||
      document.remote_upload_status === "UPLOADING"
    )
      reason = "L’envoi est déjà en cours.";
    else if (job?.last_error === "SOURCE_UPLOAD_LOCAL_FILE_MISSING")
      reason =
        "L’original n’a pas été retrouvé sur cet appareil. Retrouvez ce même fichier pour reprendre son envoi sans refaire l’import.";
    else if (
      document.remote_upload_status === "INVALID" ||
      job?.last_error === "SOURCE_UPLOAD_INVALID"
    )
      reason =
        "Le fichier ne correspond pas à la source enregistrée. Vérifiez l’original avant toute reprise.";
    else if (
      job?.next_attempt_at &&
      Date.parse(job.next_attempt_at) > Date.parse(this.now()) &&
      [
        "RATE_LIMITED",
        "AUTH_RATE_LIMITED",
        "SOURCE_BLOB_HTTP_429",
        "TOO_MANY_REQUESTS",
        "SOURCE_UPLOAD_RATE_LIMITED",
      ].includes(job.last_error ?? "")
    )
      reason =
        "Le service demande de patienter avant une nouvelle tentative. L’envoi reprendra après ce délai.";
    else if (
      !job ||
      !file ||
      !payload.success ||
      payload.data.storeId !== storeId ||
      payload.data.sourceDocumentId !== id ||
      payload.data.localFileId !== file.id ||
      file.checksum !== document.checksum ||
      file.local_uri !== document.local_file_uri ||
      file.retention_status !== "RETAINED" ||
      !file.local_uri ||
      ["INVALID", "FAILED"].includes(file.upload_status)
    )
      reason =
        "La tâche ou les références de l’original ne correspondent plus. Consultez le fichier pour examiner ce blocage.";
    else if (!["PENDING", "RETRY"].includes(job.status))
      reason =
        "Cette tâche ne peut pas être relancée automatiquement. Examinez son échec avant de réessayer.";
    return {
      sourceDocumentId: id,
      sourceType: document.source_type,
      canRestore,
      original: file
        ? {
            fileId: file.id,
            localUri: file.local_uri,
            checksum: file.checksum,
            sizeBytes: file.size_bytes,
            mimeType: file.mime_type,
          }
        : null,
      filename: document.original_filename ?? "Document",
      status: job?.status ?? "MISSING",
      nextAttemptAt: job?.next_attempt_at ?? null,
      code:
        job?.last_error && /^[A-Z][A-Z0-9_]{2,90}$/.test(job.last_error)
          ? job.last_error
          : null,
      canRetry: reason === null,
      reason,
      basisHash: await this.digest(
        JSON.stringify({
          storeId,
          id,
          scope,
          document,
          jobs,
          files,
          blockedCommand,
          openConflict,
        }),
      ),
      jobId: job?.id ?? null,
    };
  }
  review(storeId: string, id: string, scope?: UploadIntakeScope) {
    return this.read(this.db, storeId, id, scope);
  }
  async list(
    storeId: string,
    scope?: UploadIntakeScope,
    after?: { createdAt: string; id: string },
  ) {
    if (scope)
      await assertIntakeConversation(
        this.db,
        { storeId, ...scope },
        scope.conversationId,
      );
    const rows = await this.db.getAllAsync<{ id: string; created_at: string }>(
      `SELECT d.id,d.created_at FROM source_documents d WHERE d.store_id=? AND d.deleted_at IS NULL AND d.source_type IN ('MERCALYS_SALES','MERCALYS_WASTE','WEEKLY_COMMERCIAL_PDF') AND d.remote_upload_status!='CONFIRMED'
      AND EXISTS (SELECT 1 FROM local_jobs j WHERE j.type='SOURCE_UPLOAD_AND_REGISTER' AND json_extract(j.payload_json,'$.storeId')=d.store_id AND json_extract(j.payload_json,'$.sourceDocumentId')=d.id)
      ${scope ? `AND EXISTS (SELECT 1 FROM mercalys_intake_batches b, json_each(b.request_json,'$.files') f WHERE b.store_id=d.store_id AND b.owner_id=? AND b.conversation_id=? AND json_extract(f.value,'$.checksum')=d.checksum)` : ""}
      AND (? IS NULL OR d.created_at<? OR (d.created_at=? AND d.id<?)) ORDER BY d.created_at DESC,d.id DESC LIMIT 21`,
      storeId,
      ...(scope ? [scope.ownerId, scope.conversationId] : []),
      after?.createdAt ?? null,
      after?.createdAt ?? null,
      after?.createdAt ?? null,
      after?.id ?? null,
    );
    const page = rows.slice(0, 20);
    const items = [];
    for (const row of page)
      items.push(await this.read(this.db, storeId, row.id, scope));
    const last = page.at(-1);
    return {
      items,
      hasMore: rows.length > 20,
      cursor: last ? { createdAt: last.created_at, id: last.id } : undefined,
    };
  }
  async isCopyReferenced(localUri: string) {
    return !!(await this.db.getFirstAsync(
      `SELECT local_uri FROM local_files WHERE local_uri=? UNION ALL SELECT local_file_uri FROM source_documents WHERE local_file_uri=? UNION ALL SELECT restored_uri FROM source_original_restorations WHERE restored_uri=? LIMIT 1`,
      localUri,
      localUri,
      localUri,
    ));
  }
  async restoreOriginal(
    storeId: string,
    id: string,
    raw: SourceOriginalRestoration,
    authority: { canRetry(): boolean; signal?: AbortSignal },
    scope?: UploadIntakeScope,
  ) {
    const request = sourceOriginalRestorationSchema.parse(raw);
    const requestJson = JSON.stringify({ storeId, id, scope, request });
    const check = () => {
      authority.signal?.throwIfAborted();
      if (!authority.canRetry()) throw Error("SOURCE_RECOVERY_FORBIDDEN");
    };
    check();
    let replayed = false;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      check();
      const current = await this.read(tx, storeId, id, scope);
      const prior = await tx.getFirstAsync<{
        request_json: string;
        restored_uri: string;
      }>(
        "SELECT request_json,restored_uri FROM source_original_restorations WHERE operation_id=?",
        request.operationId,
      );
      check();
      if (prior) {
        if (
          prior.request_json !== requestJson ||
          prior.restored_uri !== current.original?.localUri ||
          current.original.checksum !== request.copy.checksum
        )
          throw Error("SOURCE_RESTORATION_IDENTITY_CHANGED");
        replayed = true;
        return;
      }
      if (current.basisHash !== request.basisHash)
        throw Error("SOURCE_RECOVERY_CHANGED");
      const original = current.original;
      if (!current.canRestore || !original || !current.jobId)
        throw Error("SOURCE_RESTORATION_BLOCKED");
      if (
        request.copy.checksum !== original.checksum ||
        request.copy.sizeBytes !== original.sizeBytes ||
        request.copy.mimeType !== original.mimeType ||
        request.copy.localUri === original.localUri
      )
        throw Error("SOURCE_RESTORATION_DIFFERENT_FILE");
      const timestamp = this.now();
      await tx.runAsync(
        "UPDATE source_documents SET local_file_uri=?,remote_upload_status='PENDING',sync_state='PENDING',updated_at=? WHERE id=? AND store_id=?",
        request.copy.localUri,
        timestamp,
        id,
        storeId,
      );
      await tx.runAsync(
        "UPDATE local_files SET local_uri=?,upload_status='PENDING',updated_at=? WHERE id=? AND store_id=? AND source_document_id=?",
        request.copy.localUri,
        timestamp,
        original.fileId,
        storeId,
        id,
      );
      await tx.runAsync(
        "UPDATE local_jobs SET status='RETRY',next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=?",
        timestamp,
        current.jobId,
      );
      await tx.runAsync(
        "INSERT INTO source_original_restorations(operation_id,store_id,source_document_id,local_file_id,job_id,request_json,previous_uri,restored_uri,restored_at) VALUES(?,?,?,?,?,?,?,?,?)",
        request.operationId,
        storeId,
        id,
        original.fileId,
        current.jobId,
        requestJson,
        original.localUri,
        request.copy.localUri,
        timestamp,
      );
      check();
    });
    return { replayed, sourceDocumentId: id, localUri: request.copy.localUri };
  }
  async retry(
    storeId: string,
    id: string,
    basisHash: string,
    authority: { canRetry(): boolean; signal?: AbortSignal },
    scope?: UploadIntakeScope,
  ) {
    const check = () => {
      authority.signal?.throwIfAborted();
      if (!authority.canRetry()) throw Error("SOURCE_RECOVERY_FORBIDDEN");
    };
    check();
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      check();
      const current = await this.read(tx, storeId, id, scope);
      check();
      if (current.basisHash !== basisHash)
        throw Error("SOURCE_RECOVERY_CHANGED");
      if (!current.canRetry || !current.jobId)
        throw Error("SOURCE_RECOVERY_BLOCKED");
      const updated = await tx.runAsync(
        "UPDATE local_jobs SET status='RETRY',next_attempt_at=NULL,updated_at=? WHERE id=? AND type='SOURCE_UPLOAD_AND_REGISTER' AND status IN ('PENDING','RETRY')",
        this.now(),
        current.jobId,
      );
      if (Number(updated.changes) !== 1) throw Error("SOURCE_RECOVERY_CHANGED");
      check();
    });
  }
}
export type SourceUploadRecoveryReview = Awaited<
  ReturnType<SourceUploadRecoveryRepository["review"]>
>;
