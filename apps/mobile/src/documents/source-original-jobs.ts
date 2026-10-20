import { z } from "zod";
import { ApiClientError } from "@fl-copilot/api-client";
import {
  emailIntakeOriginalRequestSchema,
  type EmailIntakeOriginalRequest,
} from "@fl-copilot/sync-contracts";
import type { EmailOriginalTransfer } from "../intake/email-original-transfer";
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
const emailPayloadSchema = emailIntakeOriginalRequestSchema.extend({
  storeId: z.uuid(),
  ownerId: z.uuid(),
});
type Payload =
  z.infer<typeof payloadSchema> | z.infer<typeof emailPayloadSchema>;
type JobType = "SOURCE_ORIGINAL_TRANSFER" | "EMAIL_ORIGINAL_TRANSFER";
function target(type: JobType, payload: Payload) {
  const keys =
    " AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=?";
  return "sourceDocumentId" in payload
    ? {
        where: `type=?${keys} AND json_extract(payload_json,'$.sourceDocumentId')=?`,
        values: [
          type,
          payload.storeId,
          payload.ownerId,
          payload.sourceDocumentId,
        ],
      }
    : {
        where: `type=?${keys} AND json_extract(payload_json,'$.conversationId')=? AND json_extract(payload_json,'$.receiptId')=? AND json_extract(payload_json,'$.fileId')=?`,
        values: [
          type,
          payload.storeId,
          payload.ownerId,
          payload.conversationId,
          payload.receiptId,
          payload.fileId,
        ],
      };
}
type Database = AtomicMutationDatabase & OutboxDatabase;
type Job = {
  type: JobType;
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
  private controllers = new Map<
    string,
    { store: string; owner: string; controller: AbortController }
  >();
  private active = new Map<string, Promise<void>>();
  constructor(
    private db: Database,
    private transfer: Pick<SourceOriginalTransfer, "recover">,
    private session: () => SourceOriginalSession | null,
    private id: () => string,
    private now: () => Date = () => new Date(),
    private email?: Pick<EmailOriginalTransfer, "recover">,
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
    return this.enqueue("SOURCE_ORIGINAL_TRANSFER", payload, force);
  }
  async requestEmail(ref: EmailIntakeOriginalRequest, force = false) {
    const s = this.session();
    if (!s || !this.email) throw Error("EMAIL_INTAKE_SESSION_REQUIRED");
    const payload = emailPayloadSchema.parse({
      ...ref,
      storeId: s.storeId,
      ownerId: s.userId,
    });
    return this.enqueue("EMAIL_ORIGINAL_TRANSFER", payload, force);
  }
  private async enqueue(type: JobType, payload: Payload, force: boolean) {
    const key = target(type, payload);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      this.check(payload.storeId, payload.ownerId);
      const prior = await tx.getFirstAsync<Job>(
        `SELECT * FROM local_jobs WHERE ${key.where}`,
        ...key.values,
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
          "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,created_at,updated_at) VALUES(?,?,?,'PENDING',0,?,?)",
          z.uuid().parse(this.id()),
          type,
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
    return this.cancelTarget(
      "SOURCE_ORIGINAL_TRANSFER",
      payloadSchema.parse({
        storeId: s.storeId,
        ownerId: s.userId,
        sourceDocumentId: sourceId,
      }),
    );
  }
  async cancelEmail(ref: EmailIntakeOriginalRequest) {
    const s = this.session();
    if (!s) return;
    return this.cancelTarget(
      "EMAIL_ORIGINAL_TRANSFER",
      emailPayloadSchema.parse({
        ...ref,
        storeId: s.storeId,
        ownerId: s.userId,
      }),
    );
  }
  private async cancelTarget(type: JobType, payload: Payload) {
    const key = target(type, payload);
    let jobId: string | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      this.check(payload.storeId, payload.ownerId);
      const running = await tx.getFirstAsync<{ id: string }>(
        `SELECT id FROM local_jobs WHERE ${key.where}`,
        ...key.values,
      );
      this.check(payload.storeId, payload.ownerId);
      await tx.runAsync(
        `UPDATE local_jobs SET status='CANCELLED',next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE ${key.where} AND status IN ('PENDING','RETRY','RUNNING')`,
        this.now().toISOString(),
        ...key.values,
      );
      this.check(payload.storeId, payload.ownerId);
      jobId = running?.id;
    });
    if (jobId) this.controllers.get(jobId)?.controller.abort();
    notifyOutboxChanged();
  }
  interrupt(store?: string, owner?: string) {
    for (const item of this.controllers.values())
      if (item.store === store && item.owner === owner) item.controller.abort();
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
          "SELECT * FROM local_jobs WHERE type IN ('SOURCE_ORIGINAL_TRANSFER','EMAIL_ORIGINAL_TRANSFER') AND (?=1 OR type='SOURCE_ORIGINAL_TRANSFER') AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND ((status IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=?)) OR (status='RUNNING' AND updated_at<?)) ORDER BY created_at,id LIMIT 1",
          this.email ? 1 : 0,
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
      const controller = new AbortController();
      this.controllers.set(job.id, { store, owner, controller });
      try {
        const payload = (
          job.type === "EMAIL_ORIGINAL_TRANSFER"
            ? emailPayloadSchema
            : payloadSchema
        ).parse(JSON.parse(job.payload_json));
        if (payload.storeId !== store || payload.ownerId !== owner)
          throw Error("SOURCE_ORIGINAL_JOB_INVALID");
        const authorize = async (tx: OutboxDatabase = this.db) => {
          this.check(store, owner);
          const live = await tx.getFirstAsync<Job>(
            "SELECT * FROM local_jobs WHERE id=? AND status='RUNNING' AND updated_at=? AND attempt_count=?",
            job.id,
            job.updated_at,
            job.attempt_count,
          );
          if (
            !live ||
            live.type !== job.type ||
            live.attempt_count !== job.attempt_count ||
            live.payload_json !== job.payload_json
          )
            throw Error("SOURCE_ORIGINAL_JOB_CHANGED");
        };
        if ("sourceDocumentId" in payload) {
          await this.transfer.recover(
            payload.sourceDocumentId,
            authorize,
            controller.signal,
          );
        } else {
          if (!this.email) throw Error("EMAIL_ORIGINAL_JOB_INVALID");
          const { conversationId, receiptId, fileId } = payload;
          await this.email.recover(
            { conversationId, receiptId, fileId },
            authorize,
            controller.signal,
          );
        }
        await authorize();
        await this.db.runAsync(
          "UPDATE local_jobs SET status='COMPLETED',last_error=NULL,next_attempt_at=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND updated_at=? AND attempt_count=?",
          this.now().toISOString(),
          job.id,
          job.updated_at,
          job.attempt_count,
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
                "EMAIL_ORIGINAL_BINDING_INVALID",
                "EMAIL_ORIGINAL_FILE_INVALID",
                "EMAIL_ORIGINAL_UNAVAILABLE",
                "EMAIL_ORIGINAL_JOB_INVALID",
                "EMAIL_INTAKE_SESSION_REQUIRED",
                "EMAIL_INTAKE_CONVERSATION_UNAVAILABLE",
                "EMAIL_INTAKE_IDENTITY_INVALID",
              ].includes(code);
        await this.db.runAsync(
          "UPDATE local_jobs SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=? AND status='RUNNING' AND updated_at=? AND attempt_count=?",
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
          job.attempt_count,
        );
      } finally {
        if (this.controllers.get(job.id)?.controller === controller)
          this.controllers.delete(job.id);
      }
    }
    notifyOutboxChanged();
  }
}
