import {
  receiptRecoveryActionSchema,
  type receiptPublicationSourceSchema,
  receiptRecoveryStateSchema,
} from "@fl-copilot/domain";
import { z } from "zod";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { readNativeReceiptPublicationReview } from "./receipt-publication-review";
export async function readReceiptRecoveryReview(
  db: OutboxDatabase,
  source: z.infer<typeof receiptPublicationSourceSchema>,
  rawAction: unknown,
  digest: (s: string) => Promise<string>,
) {
  const action = receiptRecoveryActionSchema.parse(rawAction);
  const current = await readNativeReceiptPublicationReview(db, source, digest);
  const document = await db.getFirstAsync<{ sync_state: string }>(
    "SELECT sync_state FROM source_documents WHERE id=? AND store_id=?",
    source.sourceDocumentId,
    source.storeId,
  );
  const file = await db.getFirstAsync<{
    id: string;
    checksum: string;
    source_document_id: string;
    local_uri: string;
    retention_status: string;
  }>(
    "SELECT * FROM local_files WHERE id=? AND store_id=?",
    current.receipt.localFileId ?? null,
    source.storeId,
  );
  const jobs = await db.getAllAsync<{
    id: string;
    status: string;
    last_error: string | null;
    payload_json: string;
  }>(
    "SELECT * FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.sourceDocumentId')=? ORDER BY created_at DESC,id DESC LIMIT 2",
    source.storeId,
    source.sourceDocumentId,
  );
  const job = jobs[0] ?? null;
  let candidate: {
    receiptId: string;
    sourceDocumentId: string;
    localFileUri: string | null;
    captureDate: string | null;
    processingStatus: string;
  } | null = null;
  const duplicateId = current.receipt.duplicateCandidateSourceDocumentId;
  const candidateRow = duplicateId
    ? await db.getFirstAsync<{
        id: string;
        store_id: string;
        checksum: string;
        sync_state: string;
        receipt_sync_state: string;
        file_checksum: string | null;
        retention_status: string | null;
        receipt_id: string;
        processing_status: string;
        duplicate_status: string;
        version: number;
        updated_at: string;
        capture_date: string | null;
        local_uri: string | null;
      }>(
        `SELECT d.*,r.id AS receipt_id,r.processing_status,r.duplicate_status,r.version AS receipt_version,r.updated_at AS receipt_updated_at,r.capture_date,r.sync_state AS receipt_sync_state,f.local_uri,f.checksum AS file_checksum,f.retention_status
      FROM source_documents d JOIN waste_receipts r ON r.source_document_id=d.id AND r.store_id=d.store_id
      LEFT JOIN local_files f ON f.id=r.local_file_id AND f.store_id=d.store_id AND f.source_document_id=d.id
      WHERE d.id=? AND d.store_id=? AND d.source_type='WASTE_RECEIPT' AND d.deleted_at IS NULL AND r.deleted_at IS NULL LIMIT 1`,
        duplicateId,
        source.storeId,
      )
    : null;
  if (
    candidateRow &&
    candidateRow.id !== source.sourceDocumentId &&
    candidateRow.receipt_id !== current.receipt.id &&
    candidateRow.checksum === source.checksum &&
    !["ERROR", "CONFLICT"].includes(candidateRow.sync_state) &&
    !["ERROR", "CONFLICT"].includes(candidateRow.receipt_sync_state) &&
    candidateRow.file_checksum === source.checksum &&
    candidateRow.retention_status === "RETAINED" &&
    candidateRow.duplicate_status !== "CONFIRMED_DUPLICATE"
  )
    candidate = {
      receiptId: candidateRow.receipt_id,
      sourceDocumentId: candidateRow.id,
      localFileUri: candidateRow.local_uri,
      captureDate: candidateRow.capture_date,
      processingStatus: candidateRow.processing_status,
    };
  const jobPayload = job
    ? z
        .strictObject({
          storeId: z.uuid(),
          sourceDocumentId: z.uuid(),
          localFileId: z.uuid(),
        })
        .safeParse(
          (() => {
            try {
              return JSON.parse(job.payload_json);
            } catch {
              return null;
            }
          })(),
        )
    : null;
  const validJob =
    !job ||
    (jobPayload?.success &&
      jobPayload.data.storeId === source.storeId &&
      jobPayload.data.sourceDocumentId === source.sourceDocumentId &&
      jobPayload.data.localFileId === file?.id);
  const published = await db.getFirstAsync(
    "SELECT id FROM waste_observations WHERE store_id=? AND source_document_id=? LIMIT 1",
    source.storeId,
    source.sourceDocumentId,
  );
  let status: "READY" | "BLOCKED" | "UNCHANGED" | "READ_ONLY" = "READY",
    reason: string | null = null;
  const block = (message: string) => {
    status = "BLOCKED";
    reason = message;
  };
  if (current.receipt.processingStatus === "PUBLISHED" || published)
    status = "READ_ONLY";
  else if (
    !document ||
    ["ERROR", "CONFLICT"].includes(document.sync_state) ||
    ["ERROR", "CONFLICT"].includes(current.receipt.syncState) ||
    current.lines.some((l) => ["ERROR", "CONFLICT"].includes(l.line.syncState))
  )
    block(
      "Résolvez le conflit ou l’erreur de synchronisation avant de reprendre ce ticket.",
    );
  else if (!validJob)
    block(
      "La tâche d’envoi ne correspond plus à l’original conservé. Aucune reprise automatique.",
    );
  else if (action === "RETRY_PROCESSING") {
    if (
      job?.status === "PENDING" &&
      current.receipt.processingStatus === "UPLOAD_PENDING" &&
      current.receipt.aiStatus === "PENDING"
    )
      status = "UNCHANGED";
    else if (
      current.receipt.aiStatus === "COMPLETED" ||
      current.receipt.aiStatus === "PROCESSING" ||
      current.lines.length ||
      ["POSSIBLE_DUPLICATE", "CONFIRMED_DUPLICATE"].includes(
        current.receipt.duplicateStatus,
      )
    )
      block(
        "Ce ticket est déjà analysé, en cours de traitement ou demande une décision de doublon. Ses corrections sont conservées.",
      );
    else if (
      !file ||
      file.source_document_id !== source.sourceDocumentId ||
      file.checksum !== source.checksum ||
      file.retention_status !== "RETAINED"
    )
      block("L’original local nécessaire à la reprise n’est pas disponible.");
    else if (
      !job ||
      jobs.length !== 1 ||
      job.status === "RUNNING" ||
      ["SOURCE_UPLOAD_INVALID", "SOURCE_UPLOAD_LOCAL_FILE_MISSING"].includes(
        job.last_error ?? "",
      )
    )
      block(
        "La tâche d’envoi ne peut pas être relancée dans cet état. Consultez le ticket pour examiner le blocage.",
      );
    else if (
      !["FAILED", "RETRY", "COMPLETED"].includes(job.status) ||
      !(
        current.receipt.aiStatus === "FAILED" ||
        current.receipt.processingStatus === "FAILED" ||
        ["FAILED", "RETRY"].includes(job.status)
      )
    )
      block(
        "Aucun traitement interrompu à relancer. La tâche existante reste conservée.",
      );
  } else if (
    (action === "KEEP_BOTH" &&
      current.receipt.duplicateStatus === "NOT_DUPLICATE") ||
    (action === "CONFIRM_DUPLICATE" &&
      current.receipt.duplicateStatus === "CONFIRMED_DUPLICATE")
  )
    status = "UNCHANGED";
  else if (
    current.receipt.duplicateStatus !== "POSSIBLE_DUPLICATE" ||
    current.receipt.duplicateReason !== "EXACT_IMAGE_CHECKSUM" ||
    !candidate ||
    !candidate.localFileUri ||
    !file?.local_uri ||
    file.source_document_id !== source.sourceDocumentId ||
    file.retention_status !== "RETAINED" ||
    file.checksum !== source.checksum
  )
    block(
      "Le doublon exact ne peut plus être comparé sur cet appareil. Synchronisez puis rouvrez les tickets avant de décider.",
    );
  else if (jobs.some((j) => ["RUNNING", "PENDING", "RETRY"].includes(j.status)))
    block(
      "Une tâche d’envoi est encore active. Attendez sa fin avant de décider sur le doublon.",
    );
  const basisHash = await digest(
    JSON.stringify({
      source,
      current: current.basisHash,
      file,
      jobs,
      candidate: candidateRow,
      action,
    }),
  );
  return {
    current,
    action,
    status: z
      .enum(["READY", "BLOCKED", "UNCHANGED", "READ_ONLY"])
      .parse(status),
    reason,
    basisHash,
    candidate,
    localFileUri: file?.local_uri ?? null,
    jobStatus: job?.status ?? null,
    state: receiptRecoveryStateSchema.parse({
      processingStatus: current.receipt.processingStatus,
      aiStatus: current.receipt.aiStatus,
      duplicateStatus: current.receipt.duplicateStatus,
    }),
  };
}
