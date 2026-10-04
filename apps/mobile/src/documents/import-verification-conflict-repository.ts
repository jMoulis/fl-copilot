import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";

type VerificationConflictDatabase = AtomicMutationDatabase & OutboxDatabase;

export interface ImportVerificationConflict {
  sourceDocumentId: string;
  storeId: string;
  sourceType: "MERCALYS_SALES" | "MERCALYS_WASTE";
  filename: string | null;
  businessPeriodStart: string | null;
  businessPeriodEnd: string | null;
  localFingerprint: string;
  remoteFingerprint: string | null;
  differenceSummary: {
    added: number;
    removed: number;
    modified: number;
  } | null;
  localRecordCount: number;
  status: "OPEN" | "KEPT_LOCAL" | "RESOLVED";
  detectedAt: string;
  acknowledgedAt: string | null;
}

interface ConflictRow {
  source_document_id: string;
  store_id: string;
  source_type: "MERCALYS_SALES" | "MERCALYS_WASTE";
  original_filename: string | null;
  business_period_start: string | null;
  business_period_end: string | null;
  local_fingerprint: string;
  remote_fingerprint: string | null;
  difference_summary_json: string | null;
  local_record_count: number;
  status: "OPEN" | "KEPT_LOCAL" | "RESOLVED";
  detected_at: string;
  acknowledged_at: string | null;
}

const conflictSelect = `
  SELECT c.source_document_id, c.store_id, d.source_type,
         d.original_filename, d.business_period_start, d.business_period_end,
         c.local_fingerprint, c.remote_fingerprint,
         c.difference_summary_json, c.status, c.detected_at,
         c.acknowledged_at,
         (SELECT COUNT(*) FROM source_records r
          WHERE r.source_document_id = c.source_document_id
            AND r.store_id = c.store_id AND r.deleted_at IS NULL)
           AS local_record_count
  FROM import_verification_conflicts c
  JOIN source_documents d
    ON d.id = c.source_document_id AND d.store_id = c.store_id
`;

export class ImportVerificationConflictRepository {
  constructor(
    private readonly database: VerificationConflictDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async listOpen(storeId: string) {
    const rows = await this.database.getAllAsync<ConflictRow>(
      `${conflictSelect}
       WHERE c.store_id = ? AND c.status = 'OPEN'
       ORDER BY c.detected_at DESC, c.source_document_id`,
      storeId,
    );
    return rows.map(mapConflict);
  }

  async getBySourceDocumentId(sourceDocumentId: string, storeId: string) {
    const row = await this.database.getFirstAsync<ConflictRow>(
      `${conflictSelect}
       WHERE c.source_document_id = ? AND c.store_id = ?`,
      sourceDocumentId,
      storeId,
    );
    return row ? mapConflict(row) : null;
  }

  async keepLocalTemporarily(sourceDocumentId: string, storeId: string) {
    const acknowledgedAt = this.now();
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const conflict = await transaction.runAsync(
        `UPDATE import_verification_conflicts
         SET status = 'KEPT_LOCAL', acknowledged_at = ?
         WHERE source_document_id = ? AND store_id = ? AND status = 'OPEN'`,
        acknowledgedAt,
        sourceDocumentId,
        storeId,
      );
      if (Number(conflict.changes) !== 1) {
        throw new Error("Import verification conflict is no longer open.");
      }
      await transaction.runAsync(
        `UPDATE source_documents
         SET sync_state = 'SYNCED', updated_at = ?
         WHERE id = ? AND store_id = ?
           AND remote_processing_status = 'RECONCILING'`,
        acknowledgedAt,
        sourceDocumentId,
        storeId,
      );
    });
    return this.getBySourceDocumentId(sourceDocumentId, storeId);
  }
}

function mapConflict(row: ConflictRow): ImportVerificationConflict {
  return {
    sourceDocumentId: row.source_document_id,
    storeId: row.store_id,
    sourceType: row.source_type,
    filename: row.original_filename,
    businessPeriodStart: row.business_period_start,
    businessPeriodEnd: row.business_period_end,
    localFingerprint: row.local_fingerprint,
    remoteFingerprint: row.remote_fingerprint,
    differenceSummary: row.difference_summary_json
      ? (JSON.parse(
          row.difference_summary_json,
        ) as ImportVerificationConflict["differenceSummary"])
      : null,
    localRecordCount: Number(row.local_record_count),
    status: row.status,
    detectedAt: row.detected_at,
    acknowledgedAt: row.acknowledged_at,
  };
}
