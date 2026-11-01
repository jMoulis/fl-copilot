import { z } from "zod";
import { ApiClientError } from "@fl-copilot/api-client";
import {
  commercialProcessingReviewSchema,
  commercialProcessingRequestedSchema,
  type CommercialProcessingReview,
  type CommercialProcessingRequested,
  type CommercialProcessingResume,
} from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
type Database = OutboxDatabase & AtomicMutationDatabase;
const jobSchema = z.strictObject({
  operationId: z.uuid(),
  storeId: z.uuid(),
  ownerId: z.uuid(),
  sourceDocumentId: z.uuid(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mode: z.literal("RESTART").optional(),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
});
type JobRow = {
  id: string;
  payload_json: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
};
async function source(db: OutboxDatabase, storeId: string, id: string) {
  const row = await db.getFirstAsync<{
    checksum: string;
    remote_upload_status: string;
  }>(
    "SELECT checksum,remote_upload_status FROM source_documents WHERE id=? AND store_id=? AND source_type='WEEKLY_COMMERCIAL_PDF' AND deleted_at IS NULL",
    id,
    storeId,
  );
  if (!row || row.remote_upload_status !== "CONFIRMED")
    throw Error("COMMERCIAL_ANALYSIS_SOURCE_UNAVAILABLE");
  return row;
}
export class CommercialAnalysisRecoveryRepository {
  constructor(
    private readonly db: Database,
    private readonly id: () => string,
    private readonly now = () => new Date().toISOString(),
  ) {}
  private async cachedIn(db: OutboxDatabase, storeId: string, id: string) {
    const current = await source(db, storeId, id);
    const row = await db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_processing_cache WHERE store_id=? AND source_document_id=?",
      storeId,
      id,
    );
    if (!row) return null;
    try {
      const parsed = commercialProcessingReviewSchema.safeParse(
        JSON.parse(row.payload_json),
      );
      if (
        !parsed.success ||
        parsed.data.sourceDocumentId !== id ||
        parsed.data.checksum !== current.checksum
      )
        return null;
      return parsed.data;
    } catch {
      // This disposable presentation cache cannot authorize a request or block a fresh read.
      return null;
    }
  }
  cached(storeId: string, id: string) {
    return this.cachedIn(this.db, storeId, id);
  }
  async save(storeId: string, id: string, raw: CommercialProcessingReview) {
    const review = commercialProcessingReviewSchema.parse(raw);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const current = await source(tx, storeId, id);
      if (
        review.sourceDocumentId !== id ||
        review.checksum !== current.checksum
      )
        throw Error("COMMERCIAL_ANALYSIS_SCOPE_CHANGED");
      const old = await this.cachedIn(tx, storeId, id);
      if (old && old.observedAt > review.observedAt) return;
      await tx.runAsync(
        "INSERT INTO commercial_processing_cache(store_id,source_document_id,payload_json) VALUES(?,?,?) ON CONFLICT(store_id,source_document_id) DO UPDATE SET payload_json=excluded.payload_json",
        storeId,
        id,
        JSON.stringify(review),
      );
    });
  }
  async latest(storeId: string, ownerId: string, id: string) {
    return this.db.getFirstAsync<JobRow>(
      "SELECT id,payload_json,status,attempt_count,last_error FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.sourceDocumentId')=? ORDER BY rowid DESC LIMIT 1",
      storeId,
      ownerId,
      id,
    );
  }
  async queue(
    storeId: string,
    ownerId: string,
    id: string,
    basisHash: string,
    authority: { canResume(): boolean; signal?: AbortSignal },
    mode?: "RESTART",
  ) {
    const check = () => {
      authority.signal?.throwIfAborted();
      if (!authority.canResume()) throw Error("COMMERCIAL_ANALYSIS_FORBIDDEN");
    };
    check();
    let result = { jobId: "", queued: false };
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      check();
      const review = await this.cachedIn(tx, storeId, id);
      if (
        !review ||
        review.basisHash !== basisHash ||
        !(mode === "RESTART" ? review.canRestart : review.canResume)
      )
        throw Error("COMMERCIAL_ANALYSIS_REVIEW_CHANGED");
      const active = await tx.getAllAsync<JobRow>(
        "SELECT id,payload_json,status,attempt_count,last_error FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.sourceDocumentId')=? AND status IN ('PENDING','RETRY','RUNNING') ORDER BY rowid DESC LIMIT 2",
        storeId,
        ownerId,
        id,
      );
      if (active.length > 1)
        throw Error("COMMERCIAL_ANALYSIS_MULTIPLE_PENDING");
      const pending = active[0];
      const completed = pending
        ? null
        : await tx.getFirstAsync<JobRow>(
            "SELECT id,payload_json,status,attempt_count,last_error FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.sourceDocumentId')=? AND status='COMPLETED' ORDER BY rowid DESC LIMIT 1",
            storeId,
            ownerId,
            id,
          );
      if (pending || completed) {
        const existing = pending ?? completed!,
          payload = jobSchema.parse(JSON.parse(existing.payload_json));
        if (
          payload.storeId !== storeId ||
          payload.ownerId !== ownerId ||
          payload.sourceDocumentId !== id ||
          payload.checksum !== review.checksum
        )
          throw Error("COMMERCIAL_ANALYSIS_SCOPE_CHANGED");
        if (payload.basisHash === basisHash && payload.mode === mode) {
          check();
          result = { jobId: existing.id, queued: false };
          return;
        }
        if (pending) throw Error("COMMERCIAL_ANALYSIS_ALREADY_PENDING");
      }
      check();
      const jobId = this.id(),
        payload = jobSchema.parse({
          operationId: jobId,
          storeId,
          ownerId,
          sourceDocumentId: id,
          checksum: review.checksum,
          basisHash,
          ...(mode ? { mode } : {}),
        }),
        timestamp = this.now();
      await tx.runAsync(
        "UPDATE local_jobs SET status='SUPERSEDED' WHERE type='COMMERCIAL_ANALYSIS_RESUME' AND status='FAILED' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.sourceDocumentId')=?",
        storeId,
        ownerId,
        id,
      );
      await tx.runAsync(
        "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,created_at,updated_at) VALUES(?,'COMMERCIAL_ANALYSIS_RESUME',?,'PENDING',0,?,?)",
        jobId,
        JSON.stringify(payload),
        timestamp,
        timestamp,
      );
      check();
      result = { jobId, queued: true };
    });
    return result;
  }
}
export interface CommercialAnalysisRecoveryTransport {
  resume(
    storeId: string,
    id: string,
    input: CommercialProcessingResume,
  ): Promise<CommercialProcessingRequested>;
}
const activeCycles = new WeakMap<Database, Map<string, Promise<void>>>();
export class CommercialAnalysisRecoveryQueue {
  constructor(
    private readonly db: Database,
    private readonly transport: CommercialAnalysisRecoveryTransport,
    private readonly now = () => new Date().toISOString(),
  ) {}
  process(storeId: string, ownerId: string) {
    let cycles = activeCycles.get(this.db);
    if (!cycles) {
      cycles = new Map();
      activeCycles.set(this.db, cycles);
    }
    const key = `${storeId}/${ownerId}`,
      existing = cycles.get(key);
    if (existing) return existing;
    const run = this.run(storeId, ownerId).finally(() => {
      if (cycles.get(key) === run) cycles.delete(key);
    });
    cycles.set(key, run);
    return run;
  }
  private async run(storeId: string, ownerId: string) {
    await this.db.runAsync(
      "UPDATE local_jobs SET status='RETRY',next_attempt_at=NULL,last_error='COMMERCIAL_ANALYSIS_REQUEST_INTERRUPTED',updated_at=? WHERE type='COMMERCIAL_ANALYSIS_RESUME' AND status='RUNNING' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=?",
      this.now(),
      storeId,
      ownerId,
    );
    const jobs = await this.db.getAllAsync<JobRow>(
      "SELECT id,payload_json,status,attempt_count,last_error FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME' AND status IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? ORDER BY created_at,id LIMIT 20",
      this.now(),
      storeId,
      ownerId,
    );
    for (const job of jobs) {
      let receiptAccepted = false;
      let retryable = false,
        code = "COMMERCIAL_ANALYSIS_REQUEST_INVALID";
      try {
        const payload = jobSchema.parse(JSON.parse(job.payload_json));
        if (
          payload.operationId !== job.id ||
          payload.storeId !== storeId ||
          payload.ownerId !== ownerId
        )
          throw Error("scope");
        const current = await source(
          this.db,
          storeId,
          payload.sourceDocumentId,
        );
        if (current.checksum !== payload.checksum)
          throw Error("source changed");
        await this.db.runAsync(
          "UPDATE local_jobs SET status='RUNNING',attempt_count=attempt_count+1,updated_at=? WHERE id=?",
          this.now(),
          job.id,
        );
        const result = commercialProcessingRequestedSchema.parse(
          await this.transport.resume(storeId, payload.sourceDocumentId, {
            operationId: payload.operationId,
            basisHash: payload.basisHash,
            ...(payload.mode ? { mode: payload.mode } : {}),
          }),
        );
        if (
          result.operationId !== payload.operationId ||
          result.sourceDocumentId !== payload.sourceDocumentId
        )
          throw Error("response scope");
        receiptAccepted = true;
        await this.db.runAsync(
          "UPDATE local_jobs SET status='COMPLETED',next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=?",
          this.now(),
          job.id,
        );
        continue;
      } catch (error) {
        if (receiptAccepted) {
          retryable = true;
          code = "COMMERCIAL_ANALYSIS_RECEIPT_NOT_SAVED";
        }
        if (error instanceof ApiClientError) {
          retryable = error.status === 0 || error.response.retryable;
          code = error.response.code;
        }
      }
      if (!/^[A-Z][A-Z0-9_]{2,90}$/.test(code))
        code = "COMMERCIAL_ANALYSIS_REQUEST_FAILED";
      const next = new Date(
        Date.parse(this.now()) +
          Math.min(300_000, 5_000 * 2 ** Math.min(job.attempt_count, 6)),
      ).toISOString();
      await this.db.runAsync(
        "UPDATE local_jobs SET status=?,next_attempt_at=?,last_error=?,updated_at=? WHERE id=?",
        retryable ? "RETRY" : "FAILED",
        retryable ? next : null,
        code,
        this.now(),
        job.id,
      );
    }
  }
}
