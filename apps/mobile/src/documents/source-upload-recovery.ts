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
      "SELECT id,store_id,source_document_id,checksum,local_uri,retention_status,upload_status FROM local_files WHERE source_document_id=? AND store_id=? ORDER BY id LIMIT 2",
      id,
      storeId,
    );
    const job = jobs.length === 1 ? jobs[0] : undefined;
    const file = files.length === 1 ? files[0] : undefined;
    const payload = payloadSchema.safeParse(
      job ? JSON.parse(job.payload_json) : null,
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
        "L’original n’a pas été retrouvé sur cet appareil. Cet envoi ne peut pas reprendre ici ; retrouvez d’abord le fichier d’origine.";
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
        JSON.stringify({ storeId, id, scope, document, jobs, files }),
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
