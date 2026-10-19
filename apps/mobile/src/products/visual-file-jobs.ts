import { z } from "zod";
import { ApiClientError } from "@fl-copilot/api-client";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { joinedMutationDatabase } from "../sync/atomic-local-mutation";
import {
  notifyOutboxChanged,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { VisualFileCache } from "./visual-file-cache";
import { VisualLibraryRepository } from "./visual-library-repository";
import type {
  VisualFileTransfer,
  VisualFileSession,
} from "./visual-file-transfer";
const payloadSchema = z.strictObject({
  storeId: z.uuid(),
  ownerId: z.uuid(),
  assetId: z.uuid(),
  sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  variant: z.enum(["UPLOAD", "PREVIEW"]),
});
export type VisualFileJobPayload = z.infer<typeof payloadSchema>;
type Database = OutboxDatabase & AtomicMutationDatabase;
export interface VisualFileJob {
  id: string;
  payload_json: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  updated_at: string;
  next_attempt_at: string | null;
}
/** Call within the same transaction as the metadata and retained local source. */
export async function enqueueVisualFileJob(
  tx: OutboxDatabase,
  raw: VisualFileJobPayload,
  id: () => string,
  now: string,
  force = false,
) {
  const payload = payloadSchema.parse(raw);
  const prior = await tx.getFirstAsync<VisualFileJob>(
    "SELECT * FROM local_jobs WHERE type='VISUAL_FILE_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.assetId')=? AND json_extract(payload_json,'$.variant')=? ORDER BY rowid DESC LIMIT 1",
    payload.storeId,
    payload.ownerId,
    payload.assetId,
    payload.variant,
  );
  if (
    prior &&
    (((prior.status === "PENDING" ||
      prior.status === "RETRY" ||
      prior.status === "FAILED") &&
      !force) ||
      prior.status === "RUNNING")
  )
    return prior.id;
  if (prior) {
    await tx.runAsync(
      "UPDATE local_jobs SET payload_json=?,status='PENDING',next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=?",
      JSON.stringify(payload),
      now,
      prior.id,
    );
    return prior.id;
  }
  const jobId = z.uuid().parse(id());
  await tx.runAsync(
    "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,created_at,updated_at) VALUES(?,'VISUAL_FILE_TRANSFER',?,'PENDING',0,?,?)",
    jobId,
    JSON.stringify(payload),
    now,
    now,
  );
  return jobId;
}
export class VisualFileJobs {
  private active = new Map<
    string,
    Promise<{ completed: number; failed: number; retry: number }>
  >();
  constructor(
    private db: Database,
    private transfer: Pick<VisualFileTransfer, "send" | "fetchPreview">,
    private session: () => VisualFileSession | null,
    private id: () => string,
    private now: () => Date = () => new Date(),
  ) {}
  private check(storeId: string, ownerId: string) {
    const current = this.session();
    if (!current || current.storeId !== storeId || current.userId !== ownerId)
      throw Error("VISUAL_SCOPE_CHANGED");
    return current;
  }
  async requestPreview(
    storeId: string,
    ownerId: string,
    assetId: string,
    force = false,
  ) {
    this.check(storeId, ownerId);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      this.check(storeId, ownerId);
      const asset = await new VisualLibraryRepository(
        joinedMutationDatabase(tx),
      ).get("visual_asset", storeId, assetId);
      if (
        !asset ||
        asset.entity.deletedAt ||
        asset.entity.review.status !== "APPROVED" ||
        ["CONFLICT", "ERROR"].includes(asset.syncState)
      )
        throw Error("VISUAL_ASSET_UNAVAILABLE");
      await enqueueVisualFileJob(
        tx,
        {
          storeId,
          ownerId,
          assetId,
          sourceHash: asset.entity.contentHash,
          variant: "PREVIEW",
        },
        this.id,
        this.now().toISOString(),
        force,
      );
    });
    notifyOutboxChanged();
  }
  async retry(storeId: string, ownerId: string, assetId: string) {
    this.check(storeId, ownerId);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      this.check(storeId, ownerId);
      await tx.runAsync(
        "UPDATE local_jobs SET status='PENDING',next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE type='VISUAL_FILE_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.assetId')=? AND status IN ('RETRY','FAILED')",
        this.now().toISOString(),
        storeId,
        ownerId,
        assetId,
      );
    });
    notifyOutboxChanged();
  }
  process(storeId: string, ownerId: string) {
    const key = `${storeId}:${ownerId}`,
      prior = this.active.get(key);
    if (prior) return prior;
    const task = this.processBatch(storeId, ownerId);
    this.active.set(key, task);
    void task
      .finally(() => {
        if (this.active.get(key) === task) this.active.delete(key);
      })
      .catch(() => undefined);
    return task;
  }
  private async processBatch(storeId: string, ownerId: string) {
    const result = { completed: 0, failed: 0, retry: 0 };
    for (let i = 0; i < 3; i++) {
      this.check(storeId, ownerId);
      const time = this.now(),
        at = time.toISOString(),
        stale = new Date(time.getTime() - 5 * 60_000).toISOString();
      let claimed: VisualFileJob | undefined;
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        this.check(storeId, ownerId);
        const row = await tx.getFirstAsync<VisualFileJob>(
          "SELECT * FROM local_jobs WHERE type='VISUAL_FILE_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND ((status IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=?)) OR (status='RUNNING' AND updated_at<?)) ORDER BY created_at,id LIMIT 1",
          storeId,
          ownerId,
          at,
          stale,
        );
        if (!row) return;
        const updated = await tx.runAsync(
          "UPDATE local_jobs SET status='RUNNING',attempt_count=attempt_count+1,updated_at=? WHERE id=? AND status=? AND updated_at=?",
          at,
          row.id,
          row.status,
          row.updated_at,
        );
        if (Number(updated.changes) === 1)
          claimed = {
            ...row,
            status: "RUNNING",
            updated_at: at,
            attempt_count: row.attempt_count + 1,
          };
      });
      if (!claimed) break;
      const job = claimed;
      try {
        const payload = payloadSchema.parse(JSON.parse(job.payload_json));
        if (payload.storeId !== storeId || payload.ownerId !== ownerId)
          throw Error("VISUAL_JOB_INVALID");
        const asset = await new VisualLibraryRepository(this.db).get(
          "visual_asset",
          storeId,
          payload.assetId,
        );
        if (!asset || asset.entity.contentHash !== payload.sourceHash)
          throw Error("VISUAL_JOB_INVALID");
        if (payload.variant === "UPLOAD") {
          if (!this.check(storeId, ownerId).canWrite)
            throw Error("VISUAL_ACCESS_INVALID");
          const file = await new VisualFileCache(this.db).get(
            storeId,
            asset.entity,
            "SOURCE",
          );
          if (!file?.uploaded || !file.manifest)
            await this.transfer.send(payload.assetId);
        } else await this.transfer.fetchPreview(payload.assetId);
        this.check(storeId, ownerId);
        await this.db.withExclusiveTransactionAsync(async (tx) => {
          this.check(storeId, ownerId);
          const done = await tx.runAsync(
            "UPDATE local_jobs SET status='COMPLETED',next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND updated_at=?",
            this.now().toISOString(),
            job.id,
            job.updated_at,
          );
          if (Number(done.changes) !== 1) throw Error("VISUAL_JOB_CHANGED");
          if (payload.variant === "UPLOAD")
            await enqueueVisualFileJob(
              tx,
              { ...payload, variant: "PREVIEW" },
              this.id,
              this.now().toISOString(),
            );
        });
        result.completed++;
      } catch (error) {
        this.check(storeId, ownerId);
        const code =
          error instanceof ApiClientError
            ? error.response.code
            : error instanceof z.ZodError
              ? "VISUAL_JOB_INVALID"
              : error instanceof Error &&
                  /^[A-Z][A-Z0-9_]{2,90}$/.test(error.message)
                ? error.message
                : "VISUAL_TRANSFER_INTERRUPTED";
        const permanent =
          error instanceof ApiClientError
            ? !error.response.retryable
            : [
                "VISUAL_JOB_INVALID",
                "VISUAL_FILE_INVALID",
                "VISUAL_FILE_BINDING_INVALID",
                "VISUAL_SOURCE_FILE_MISSING",
                "VISUAL_ASSET_UNAVAILABLE",
                "VISUAL_ACCESS_INVALID",
              ].includes(code);
        await this.db.runAsync(
          "UPDATE local_jobs SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=? AND status='RUNNING' AND updated_at=?",
          permanent ? "FAILED" : "RETRY",
          code,
          permanent
            ? null
            : new Date(
                time.getTime() +
                  Math.min(
                    60 * 60_000,
                    60_000 * 2 ** Math.min(job.attempt_count - 1, 6),
                  ),
              ).toISOString(),
          this.now().toISOString(),
          job.id,
          job.updated_at,
        );
        if (permanent) result.failed++;
        else result.retry++;
      }
    }
    notifyOutboxChanged();
    return result;
  }
}
