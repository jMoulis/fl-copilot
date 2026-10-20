import { z } from "zod";
import {
  emailIntakeDecisionSchema,
  type EmailIntakeReceipt,
  type EmailIntakeReceiptRequest,
  type EmailIntakeOriginalRequest,
} from "@fl-copilot/sync-contracts";
import { inspectXlsxZip, inspectMercalysZip } from "@fl-copilot/import-core";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type {
  SourceOriginalJobs,
  EmailProcessingJob,
  EmailProcessingOutcome,
} from "../documents/source-original-jobs";
import type { ImportReport } from "../copilot/mercalys-import-controller";
import type {
  EmailIntakeCache,
  EmailIntakeScope,
  EmailIntakeSession,
} from "./email-intake-cache";
import type {
  EmailOriginalTransfer,
  EmailOriginalProof,
} from "./email-original-transfer";
import { readEmailAdmissionAuthority } from "./email-processing-basis";
type Authorize = (tx?: OutboxDatabase) => Promise<void>;
type SourceFormat = "MEDIA" | "XLSX" | "ZIP";
/** Container selection only. Every selected capture still verifies bytes/format before use. */
export function emailProcessingFormat(bytes: Uint8Array): SourceFormat {
  if (bytes[0] !== 80 || bytes[1] !== 75) return "MEDIA";
  try {
    inspectXlsxZip(bytes);
    return "XLSX";
  } catch {
    inspectMercalysZip(bytes);
    return "ZIP";
  }
}
type Dependencies = {
  session(): EmailIntakeSession | null;
  receipt(
    scope: EmailIntakeScope,
    ref: EmailIntakeReceiptRequest,
  ): Promise<EmailIntakeReceipt>;
  format(proof: EmailOriginalProof): Promise<SourceFormat>;
  mercalys: {
    attach(
      ref: EmailIntakeOriginalRequest,
      signal?: AbortSignal,
      authorize?: Authorize,
      format?: "XLSX" | "ZIP",
    ): Promise<
      | { status: "ATTACHED"; message: CopilotMessage }
      | { status: "RETRY"; failures?: Array<{ path: string; code: string }> }
    >;
  };
  media: {
    capture(
      ref: EmailIntakeOriginalRequest,
      purpose?: "WASTE_TICKET" | "STORE_PHOTO",
      signal?: AbortSignal,
      authorize?: Authorize,
    ): Promise<{ status: "CAPTURED" } | { status: "NEEDS_PURPOSE" }>;
  };
  runMercalys(
    message: CopilotMessage,
    authorize: Authorize,
    signal: AbortSignal,
  ): Promise<ImportReport>;
};
/** Application glue for existing jobs/captures. No new agent, timer, prompt or KPI engine. */
export class EmailIntakeProcessing {
  constructor(
    private cache: EmailIntakeCache,
    private originals: Pick<EmailOriginalTransfer, "recover">,
    private dependencies: Dependencies,
  ) {}
  private check(storeId: string, ownerId: string) {
    const s = this.dependencies.session();
    if (!s?.canWrite || s.storeId !== storeId || s.userId !== ownerId)
      throw Error("EMAIL_INTAKE_SCOPE_CHANGED");
  }
  async seed(
    storeId: string,
    ownerId: string,
    jobs: Pick<SourceOriginalJobs, "requestEmailProcessing">,
    limit = 20,
  ) {
    z.number().int().min(1).max(50).parse(limit);
    const session = this.dependencies.session();
    if (!session?.canWrite) return 0;
    this.check(storeId, ownerId);
    const rows = await this.cache.db.getAllAsync<{
      payload_json: string;
      file_id: string;
      processing_id: string;
    }>(
      `
      SELECT d.payload_json,json_extract(f.value,'$.fileId') AS file_id,json_extract(f.value,'$.processingId') AS processing_id
      FROM email_intake_decisions d JOIN json_each(d.payload_json,'$.files') f
      JOIN copilot_conversations c ON c.id=d.conversation_id AND c.store_id=d.store_id AND c.owner_id=d.owner_id
      WHERE d.store_id=? AND d.owner_id=? AND d.sync_state='SYNCED' AND d.dirty=0 AND d.remote_version=1
       AND d.remote_payload_json=d.payload_json AND json_extract(d.payload_json,'$.choice')='ADMIT'
       AND json_extract(c.payload_json,'$.status')='ACTIVE' AND json_extract(c.payload_json,'$.deletedAt') IS NULL
       AND NOT EXISTS(SELECT 1 FROM json_each(d.payload_json,'$.files') earlier
        WHERE json_extract(earlier.value,'$.processingId')=json_extract(f.value,'$.processingId') AND CAST(earlier.key AS INTEGER)<CAST(f.key AS INTEGER))
       AND NOT EXISTS(SELECT 1 FROM local_jobs j WHERE j.type='EMAIL_INTAKE_PROCESS'
        AND json_extract(j.payload_json,'$.storeId')=d.store_id AND json_extract(j.payload_json,'$.ownerId')=d.owner_id
        AND json_extract(j.payload_json,'$.conversationId')=d.conversation_id AND json_extract(j.payload_json,'$.receiptId')=d.id
        AND json_extract(j.payload_json,'$.actionId')=json_extract(d.payload_json,'$.actionId')
        AND json_extract(j.payload_json,'$.processingId')=json_extract(f.value,'$.processingId'))
      ORDER BY d.rowid,CAST(f.key AS INTEGER) LIMIT ?`,
      storeId,
      ownerId,
      limit,
    );
    let count = 0;
    for (const row of rows) {
      this.check(storeId, ownerId);
      const decision = emailIntakeDecisionSchema.parse(
        JSON.parse(row.payload_json),
      );
      if (
        decision.storeId !== storeId ||
        decision.ownerId !== ownerId ||
        decision.choice !== "ADMIT" ||
        !decision.files.some(
          (file) =>
            file.fileId === row.file_id &&
            file.processingId === row.processing_id,
        )
      )
        throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
      const scope = this.cache.scope(decision.conversationId);
      try {
        await this.cache.authorize(scope);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "EMAIL_INTAKE_CONVERSATION_UNAVAILABLE"
        )
          continue;
        throw error;
      }
      this.check(storeId, ownerId);
      await jobs.requestEmailProcessing({
        conversationId: decision.conversationId,
        receiptId: decision.receiptId,
        fileId: row.file_id,
        actionId: decision.actionId,
        processingId: row.processing_id,
      });
      this.check(storeId, ownerId);
      count++;
    }
    return count;
  }
  async process(
    input: EmailProcessingJob,
    lease: Authorize,
    signal: AbortSignal,
  ): Promise<EmailProcessingOutcome> {
    this.check(input.storeId, input.ownerId);
    const ref = {
        conversationId: input.conversationId,
        receiptId: input.receiptId,
        fileId: input.fileId,
      },
      scope = this.cache.scope(input.conversationId);
    const origin = {
      receiptId: input.receiptId,
      fileId: input.fileId,
      actionId: input.actionId,
      processingId: input.processingId,
    };
    const allowed = async (tx: OutboxDatabase = this.cache.db) => {
      this.check(input.storeId, input.ownerId);
      if (signal.aborted) throw Error("EMAIL_INTAKE_PROCESSING_INTERRUPTED");
      await lease(tx);
      await this.cache.authorize(scope, tx);
      await readEmailAdmissionAuthority(tx, scope, origin);
      this.check(input.storeId, input.ownerId);
      if (signal.aborted) throw Error("EMAIL_INTAKE_PROCESSING_INTERRUPTED");
    };
    await allowed();
    const admitted = await readEmailAdmissionAuthority(
      this.cache.db,
      scope,
      origin,
    );
    const selections = admitted.decision.files.filter(
      (file) => file.processingId === input.processingId,
    );
    let receipt = await this.cache.receipt(
      input.conversationId,
      input.receiptId,
    );
    const ready = () =>
      !!receipt &&
      selections.every((selection) =>
        receipt!.files.some(
          (file) =>
            file.id === selection.fileId &&
            ["READY", "APPLIED"].includes(file.status),
        ),
      );
    if (!ready()) {
      await allowed();
      const remote = await this.dependencies.receipt(scope, {
        conversationId: input.conversationId,
        receiptId: input.receiptId,
      });
      await allowed();
      if (remote.id !== input.receiptId)
        throw Error("EMAIL_INTAKE_IDENTITY_INVALID");
      await this.cache.storePage(scope, {
        bindings: [],
        receipts: [remote],
        nextCursor: null,
      });
      receipt = await this.cache.receipt(input.conversationId, input.receiptId);
    }
    await allowed();
    if (!receipt || ["DISMISSED", "QUARANTINED"].includes(receipt.status))
      throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
    if (
      selections.some(
        (selection) =>
          !receipt!.files.some((file) => file.id === selection.fileId),
      )
    )
      throw Error("EMAIL_INTAKE_IDENTITY_INVALID");
    if (
      selections.some((selection) =>
        receipt!.files.some(
          (file) =>
            file.id === selection.fileId &&
            ["UNSUPPORTED", "FAILED"].includes(file.status),
        ),
      )
    )
      throw Error("EMAIL_INTAKE_SOURCE_FAILED");
    if (!ready()) throw Error("EMAIL_INTAKE_SOURCE_WAITING");
    let first: EmailOriginalProof | undefined;
    for (const file of selections) {
      await allowed();
      const proof = await this.originals.recover(
        { ...ref, fileId: file.fileId },
        allowed,
        signal,
      );
      await allowed();
      if (file.fileId === input.fileId) first = proof;
    }
    if (!first) throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
    const format =
      admitted.selection.mode === "AUTO"
        ? await this.dependencies.format(first)
        : "MEDIA";
    await allowed();
    if (format === "MEDIA") {
      const result = await this.dependencies.media.capture(
        ref,
        input.purpose,
        signal,
        allowed,
      );
      await allowed();
      return result.status === "NEEDS_PURPOSE"
        ? { status: "WAITING_INPUT", code: "EMAIL_INTAKE_PURPOSE_REQUIRED" }
        : { status: "COMPLETED" };
    }
    if (input.purpose) throw Error("EMAIL_INTAKE_PURPOSE_ALREADY_RECORDED");
    const result = await this.dependencies.mercalys.attach(
      ref,
      signal,
      allowed,
      format,
    );
    await allowed();
    if (result.status === "RETRY") {
      if (
        result.failures?.some(
          (file) => file.code === "MERCALYS_ZIP_COPY_FAILED",
        )
      )
        throw Error("EMAIL_MERCALYS_MEMBERS_RETRY_REQUIRED");
      return {
        status: "WAITING_INPUT",
        code: "EMAIL_MERCALYS_PARTIAL_REVIEW_REQUIRED",
      };
    }
    await this.dependencies.runMercalys(result.message, allowed, signal);
    await allowed();
    return { status: "COMPLETED" };
  }
}
