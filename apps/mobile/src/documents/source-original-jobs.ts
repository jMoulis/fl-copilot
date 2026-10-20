import { z } from "zod";
import { ApiClientError } from "@fl-copilot/api-client";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  notifyOutboxChanged,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type {
  SourceOriginalSession,
  SourceOriginalTransfer,
} from "./source-original-transfer";
const payloadSchema = z.strictObject({
  storeId: z.uuid(),
  ownerId: z.uuid(),
  sourceDocumentId: z.uuid(),
});
type Database = AtomicMutationDatabase & OutboxDatabase;
type Job = {
  id: string;
  payload_json: string;
  status: string;
  attempt_count: number;
  updated_at: string;
  next_attempt_at: string | null;
  last_error: string | null;
};
/** Durable read jobs contain only authenticated scope and source identity, never read URLs. */
export class SourceOriginalJobs {
  private active = new Map<string, Promise<void>>();
  constructor(
    private db: Database,
    private transfer: Pick<SourceOriginalTransfer, "recover">,
    private session: () => SourceOriginalSession | null,
    private id: () => string,
    private now: () => Date = () => new Date(),
  ) {}
  private check(store: string, owner: string) {
    const s = this.session();
    if (s?.storeId !== store || s.userId !== owner)
      throw Error("SOURCE_ORIGINAL_SCOPE_CHANGED");
  }
  async request(sourceDocumentId: string, force = false) {
    const s = this.session();
    if (!s) throw Error("SOURCE_ORIGINAL_SESSION_REQUIRED");
    const payload = payloadSchema.parse({
      storeId: s.storeId,
      ownerId: s.userId,
      sourceDocumentId,
    });
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      this.check(payload.storeId, payload.ownerId);
      const prior = await tx.getFirstAsync<Job>(
        "SELECT * FROM local_jobs WHERE type='SOURCE_ORIGINAL_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.sourceDocumentId')=?",
        payload.storeId,
        payload.ownerId,
        sourceDocumentId,
      );
      if (
        prior &&
        (prior.status === "RUNNING" ||
          (!force && ["PENDING", "RETRY", "FAILED"].includes(prior.status)))
      )
        return;
      const at = this.now().toISOString();
      if (prior)
        await tx.runAsync(
          "UPDATE local_jobs SET status='PENDING',next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=?",
          at,
          prior.id,
        );
      else
        await tx.runAsync(
          "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,created_at,updated_at) VALUES(?,'SOURCE_ORIGINAL_TRANSFER',?,'PENDING',0,?,?)",
          z.uuid().parse(this.id()),
          JSON.stringify(payload),
          at,
          at,
        );
      this.check(payload.storeId, payload.ownerId);
    });
    notifyOutboxChanged();
  }
  async cancel(sourceId: string) {
    const s = this.session();
    if (!s) return;
    await this.db.runAsync(
      "UPDATE local_jobs SET status='CANCELLED',next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE type='SOURCE_ORIGINAL_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.sourceDocumentId')=? AND status IN ('PENDING','RETRY','RUNNING')",
      this.now().toISOString(),
      s.storeId,
      s.userId,
      z.uuid().parse(sourceId),
    );
    notifyOutboxChanged();
  }
  process(storeId: string, actorId: string) {
    this.check(storeId, actorId);
    const key = `${storeId}:${actorId}`,
      prior = this.active.get(key);
    if (prior) return prior;
    const task = this.batch(storeId, actorId);
    this.active.set(key, task);
    void task
      .finally(() => {
        if (this.active.get(key) === task) this.active.delete(key);
      })
      .catch(() => undefined);
    return task;
  }
  private async batch(store: string, owner: string) {
    for (let i = 0; i < 2; i++) {
      this.check(store, owner);
      const at = this.now().toISOString(),
        stale = new Date(this.now().getTime() - 5 * 60_000).toISOString();
      let claimed: Job | undefined;
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        this.check(store, owner);
        const row = await tx.getFirstAsync<Job>(
          "SELECT * FROM local_jobs WHERE type='SOURCE_ORIGINAL_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND ((status IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=?)) OR (status='RUNNING' AND updated_at<?)) ORDER BY created_at,id LIMIT 1",
          store,
          owner,
          at,
          stale,
        );
        if (!row) return;
        const change = await tx.runAsync(
          "UPDATE local_jobs SET status='RUNNING',attempt_count=attempt_count+1,updated_at=? WHERE id=? AND status=? AND updated_at=?",
          at,
          row.id,
          row.status,
          row.updated_at,
        );
        if (Number(change.changes) === 1)
          claimed = {
            ...row,
            status: "RUNNING",
            attempt_count: row.attempt_count + 1,
            updated_at: at,
          };
      });
      if (!claimed) break;
      const job = claimed;
      try {
        const payload = payloadSchema.parse(JSON.parse(job.payload_json));
        if (payload.storeId !== store || payload.ownerId !== owner)
          throw Error("SOURCE_ORIGINAL_JOB_INVALID");
        const authorize = async (tx: OutboxDatabase = this.db) => {
          this.check(store, owner);
          const live = await tx.getFirstAsync<Job>(
            "SELECT * FROM local_jobs WHERE id=? AND status='RUNNING' AND updated_at=?",
            job.id,
            job.updated_at,
          );
          if (!live || live.payload_json !== job.payload_json)
            throw Error("SOURCE_ORIGINAL_JOB_CHANGED");
        };
        await this.transfer.recover(payload.sourceDocumentId, authorize);
        await authorize();
        await this.db.runAsync(
          "UPDATE local_jobs SET status='COMPLETED',last_error=NULL,next_attempt_at=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND updated_at=?",
          this.now().toISOString(),
          job.id,
          job.updated_at,
        );
      } catch (error) {
        this.check(store, owner);
        const code =
          error instanceof ApiClientError
            ? error.response.code
            : error instanceof Error &&
                /^[A-Z][A-Z0-9_]{2,90}$/.test(error.message)
              ? error.message
              : "SOURCE_ORIGINAL_TRANSFER_INTERRUPTED";
        const permanent =
          error instanceof ApiClientError
            ? !error.response.retryable
            : error instanceof z.ZodError ||
              [
                "SOURCE_ORIGINAL_BINDING_INVALID",
                "SOURCE_ORIGINAL_FILE_INVALID",
                "SOURCE_ORIGINAL_UNAVAILABLE",
                "SOURCE_ORIGINAL_LOCAL_PENDING",
                "SOURCE_ORIGINAL_LOCAL_CHANGED",
                "SOURCE_ORIGINAL_CHANGED",
                "SOURCE_ORIGINAL_JOB_INVALID",
              ].includes(code);
        await this.db.runAsync(
          "UPDATE local_jobs SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=? AND status='RUNNING' AND updated_at=?",
          permanent ? "FAILED" : "RETRY",
          code,
          permanent
            ? null
            : new Date(
                this.now().getTime() +
                  Math.min(
                    3600_000,
                    60_000 * 2 ** Math.min(job.attempt_count - 1, 6),
                  ),
              ).toISOString(),
          this.now().toISOString(),
          job.id,
          job.updated_at,
        );
      }
    }
    notifyOutboxChanged();
  }
}
