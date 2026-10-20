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
export const emailProcessingJobSchema = emailPayloadSchema.extend({
  actionId: z.uuid(),
  processingId: z.uuid(),
  purpose: z.enum(["WASTE_TICKET", "STORE_PHOTO"]).optional(),
  attemptBase: z.number().int().nonnegative().default(0),
});
export type EmailProcessingJob = z.infer<typeof emailProcessingJobSchema>;
type EmailProcessingInput = EmailIntakeOriginalRequest & {
  actionId: string;
  processingId: string;
};
const processingOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("COMPLETED") }),
  z.strictObject({
    status: z.literal("WAITING_INPUT"),
    code: z.enum([
      "EMAIL_INTAKE_PURPOSE_REQUIRED",
      "EMAIL_MERCALYS_PARTIAL_REVIEW_REQUIRED",
      "EMAIL_INTAKE_ADMISSION_REQUIRED",
    ]),
  }),
]);
export type EmailProcessingOutcome = z.infer<typeof processingOutcomeSchema>;
export type EmailProcessingHandler = (
  input: EmailProcessingJob,
  authorize: (tx?: OutboxDatabase) => Promise<void>,
  signal: AbortSignal,
) => Promise<EmailProcessingOutcome>;
type Payload =
  | z.infer<typeof payloadSchema>
  | z.infer<typeof emailPayloadSchema>
  | EmailProcessingJob;
type JobType =
  | "SOURCE_ORIGINAL_TRANSFER"
  | "EMAIL_ORIGINAL_TRANSFER"
  | "EMAIL_INTAKE_PROCESS";
function target(type: JobType, payload: Payload) {
  const keys =
    " AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=?";
  if ("processingId" in payload)
    return {
      where: `type=?${keys} AND json_extract(payload_json,'$.conversationId')=? AND json_extract(payload_json,'$.receiptId')=? AND json_extract(payload_json,'$.actionId')=? AND json_extract(payload_json,'$.processingId')=?`,
      values: [
        type,
        payload.storeId,
        payload.ownerId,
        payload.conversationId,
        payload.receiptId,
        payload.actionId,
        payload.processingId,
      ],
    };
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
/** Shared durable source work; a processing stage requires an accepted admission identity.
 * Job completion is local handoff, never a claim of server publication or analysis. */
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
    private emailWork?: {
      process?: EmailProcessingHandler;
      allowed?(): boolean;
    },
  ) {}
  private get processEmail() {
    return this.emailWork?.process;
  }
  private emailAllowed() {
    return this.emailWork?.allowed?.() !== false;
  }
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
  async requestEmailProcessing(input: EmailProcessingInput, force = false) {
    const s = this.session();
    if (!s || !this.processEmail) throw Error("EMAIL_INTAKE_SESSION_REQUIRED");
    return this.enqueue(
      "EMAIL_INTAKE_PROCESS",
      emailProcessingJobSchema.parse({
        ...input,
        storeId: s.storeId,
        ownerId: s.userId,
      }),
      force,
    );
  }
  async emailProcessingState(input: EmailProcessingInput) {
    const s = this.session();
    if (!s || !this.processEmail) throw Error("EMAIL_INTAKE_SESSION_REQUIRED");
    const payload = emailProcessingJobSchema.parse({
        ...input,
        storeId: s.storeId,
        ownerId: s.userId,
      }),
      key = target("EMAIL_INTAKE_PROCESS", payload);
    const row = await this.db.getFirstAsync<Job>(
      `SELECT * FROM local_jobs WHERE ${key.where}`,
      ...key.values,
    );
    this.check(s.storeId, s.userId);
    if (!row) return null;
    emailProcessingJobSchema.parse(JSON.parse(row.payload_json));
    return {
      status: row.status,
      attempts: row.attempt_count,
      code:
        row.last_error && /^[A-Z][A-Z0-9_]{2,90}$/.test(row.last_error)
          ? row.last_error
          : null,
      nextAttemptAt: row.next_attempt_at,
    };
  }
  async provideEmailPurpose(
    input: EmailProcessingInput,
    purpose: "WASTE_TICKET" | "STORE_PHOTO",
  ) {
    const s = this.session();
    if (!s || !this.processEmail) throw Error("EMAIL_INTAKE_SESSION_REQUIRED");
    z.enum(["WASTE_TICKET", "STORE_PHOTO"]).parse(purpose);
    const key = target(
      "EMAIL_INTAKE_PROCESS",
      emailProcessingJobSchema.parse({
        ...input,
        storeId: s.storeId,
        ownerId: s.userId,
      }),
    );
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      this.check(s.storeId, s.userId);
      const prior = await tx.getFirstAsync<Job>(
        `SELECT * FROM local_jobs WHERE ${key.where}`,
        ...key.values,
      );
      if (!prior) throw Error("EMAIL_INTAKE_PROCESSING_UNAVAILABLE");
      const payload = emailProcessingJobSchema.parse(
        JSON.parse(prior.payload_json),
      );
      if (payload.purpose) {
        if (payload.purpose === purpose) return;
        throw Error("EMAIL_INTAKE_PURPOSE_ALREADY_RECORDED");
      }
      if (
        prior.status !== "WAITING_INPUT" ||
        prior.last_error !== "EMAIL_INTAKE_PURPOSE_REQUIRED"
      )
        throw Error("EMAIL_INTAKE_INPUT_NOT_EXPECTED");
      await tx.runAsync(
        "UPDATE local_jobs SET payload_json=?,status='PENDING',last_error=NULL,next_attempt_at=NULL,updated_at=? WHERE id=?",
        JSON.stringify({
          ...payload,
          purpose,
          attemptBase: prior.attempt_count,
        }),
        this.now().toISOString(),
        prior.id,
      );
      this.check(s.storeId, s.userId);
    });
    notifyOutboxChanged();
  }
  private async enqueue(type: JobType, payload: Payload, force: boolean) {
    const key = target(type, payload);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      this.check(payload.storeId, payload.ownerId);
      const prior = await tx.getFirstAsync<Job>(
        `SELECT * FROM local_jobs WHERE ${key.where}`,
        ...key.values,
      );
      if (prior && type === "EMAIL_INTAKE_PROCESS" && !force) return;
      if (
        prior &&
        (prior.status === "RUNNING" ||
          (!force && ["PENDING", "RETRY", "FAILED"].includes(prior.status)))
      )
        return;
      const at = this.now().toISOString();
      if (prior) {
        const priorPayload =
          type === "EMAIL_INTAKE_PROCESS"
            ? emailProcessingJobSchema.parse(JSON.parse(prior.payload_json))
            : null;
        await tx.runAsync(
          "UPDATE local_jobs SET status='PENDING',next_attempt_at=NULL,last_error=NULL,updated_at=?,payload_json=? WHERE id=?",
          at,
          priorPayload
            ? JSON.stringify({
                ...priorPayload,
                attemptBase: prior.attempt_count,
              })
            : prior.payload_json,
          prior.id,
        );
      } else
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
  async cancelEmailProcessing(input: EmailProcessingInput) {
    const s = this.session();
    if (!s) return;
    return this.cancelTarget(
      "EMAIL_INTAKE_PROCESS",
      emailProcessingJobSchema.parse({
        ...input,
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
        `UPDATE local_jobs SET status='CANCELLED',next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE ${key.where} AND status IN ('PENDING','RETRY','RUNNING','WAITING_INPUT')`,
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
  process(storeId: string, actorId: string, limit = 2) {
    z.number().int().min(1).max(20).parse(limit);
    this.check(storeId, actorId);
    const key = `${storeId}:${actorId}`,
      prior = this.active.get(key);
    if (prior) return prior;
    const task = this.batch(storeId, actorId, limit);
    this.active.set(key, task);
    void task
      .finally(() => {
        if (this.active.get(key) === task) this.active.delete(key);
      })
      .catch(() => undefined);
    return task;
  }
  private async batch(store: string, owner: string, limit: number) {
    for (let i = 0; i < limit; i++) {
      this.check(store, owner);
      const at = this.now().toISOString(),
        stale = new Date(this.now().getTime() - 5 * 60_000).toISOString();
      let claimed: Job | undefined;
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        this.check(store, owner);
        const row = await tx.getFirstAsync<Job>(
          "SELECT * FROM local_jobs WHERE (type='SOURCE_ORIGINAL_TRANSFER' OR (type='EMAIL_ORIGINAL_TRANSFER' AND ?=1) OR (type='EMAIL_INTAKE_PROCESS' AND ?=1)) AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND ((status IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=?)) OR (status='RUNNING' AND updated_at<?)) ORDER BY created_at,id LIMIT 1",
          this.email && this.emailAllowed() ? 1 : 0,
          this.processEmail && this.emailAllowed() ? 1 : 0,
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
          job.type === "EMAIL_INTAKE_PROCESS"
            ? emailProcessingJobSchema
            : job.type === "EMAIL_ORIGINAL_TRANSFER"
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
        let completion: EmailProcessingOutcome = { status: "COMPLETED" };
        if (job.type === "EMAIL_INTAKE_PROCESS") {
          if (!this.processEmail) throw Error("EMAIL_ORIGINAL_JOB_INVALID");
          completion = processingOutcomeSchema.parse(
            await this.processEmail(
              emailProcessingJobSchema.parse(payload),
              authorize,
              controller.signal,
            ),
          );
        } else if ("sourceDocumentId" in payload) {
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
          "UPDATE local_jobs SET status=?,last_error=?,next_attempt_at=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND updated_at=? AND attempt_count=?",
          completion.status,
          completion.status === "WAITING_INPUT" ? completion.code : null,
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
        let exhausted = false,
          retryAttempt = job.attempt_count;
        if (job.type === "EMAIL_INTAKE_PROCESS") {
          try {
            const processing = emailProcessingJobSchema.safeParse(
              JSON.parse(job.payload_json),
            );
            exhausted =
              !processing.success ||
              job.attempt_count - processing.data.attemptBase >= 6;
            if (processing.success)
              retryAttempt = job.attempt_count - processing.data.attemptBase;
          } catch {
            exhausted = true;
          }
        }
        const permanent =
          exhausted ||
          (error instanceof ApiClientError
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
                "EMAIL_INTAKE_PROCESSING_FORBIDDEN",
                "EMAIL_INTAKE_CANONICAL_SOURCE_CHANGED",
                "EMAIL_INTAKE_ORIGINAL_CHANGED",
                "EMAIL_INTAKE_IMAGE_INVALID",
                "EMAIL_INTAKE_FILE_SIZE_INVALID",
                "EMAIL_INTAKE_PURPOSE_ALREADY_RECORDED",
                "EMAIL_INTAKE_FILE_FORMAT_INVALID",
                "EMAIL_INTAKE_SOURCE_FAILED",
                "EMAIL_MERCALYS_ARCHIVE_INVALID",
                "COMMERCIAL_PDF_INVALID",
                "MERCALYS_ZIP_INVALID",
                "MERCALYS_ZIP_LIMIT",
                "MERCALYS_ZIP_UNSUPPORTED",
                "MERCALYS_ZIP_UNSAFE_PATH",
                "MERCALYS_ZIP_DUPLICATE_PATH",
                "MERCALYS_ZIP_CORRUPT",
              ].includes(code));
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
                    60_000 * 2 ** Math.min(Math.max(retryAttempt - 1, 0), 6),
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
