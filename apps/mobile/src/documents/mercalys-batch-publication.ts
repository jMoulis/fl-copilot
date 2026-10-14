import {
  mercalysBatchPublicationPlanSchema,
  type MercalysBatchPublicationPlan,
} from "@fl-copilot/domain";
import type { MercalysBatchRepository } from "./mercalys-batch-repository";
import type { MercalysBatchPreparation } from "./mercalys-batch-preparation";
import {
  MercalysExactDuplicateError,
  MercalysOverlapReconciliationError,
  type MercalysImportPublicationRepository,
} from "./mercalys-import-publication";
import { MercalysImportValidationError } from "./mercalys-import-validation";
type Outcome = {
  itemId: string;
  filename: string;
  status: "PUBLISHED" | "DUPLICATE" | "BLOCKED" | "FAILED";
  publishedCount: number;
  remainingCount: number;
  code?: string;
};
/** Explicit native plan confirmation; no model/source-controlled writer or silent overlap approval. */
export class MercalysBatchPublication {
  private pending?: {
    plan: MercalysBatchPublicationPlan;
    proof: Map<string, { version: number; fingerprint: string }>;
  };
  constructor(
    private batches: MercalysBatchRepository,
    private preparation: MercalysBatchPreparation,
    private publication: Pick<
      MercalysImportPublicationRepository,
      "findExactDuplicate" | "analyzeOverlap" | "publish"
    >,
    private fingerprint: (text: string) => Promise<string>,
  ) {}
  private cancel(signal?: AbortSignal) {
    if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
  }
  async preview(batchId: string, signal?: AbortSignal) {
    this.pending = undefined;
    const header = await this.batches.header(batchId);
    await this.batches.assertConversation(header.conversationId);
    const items: MercalysBatchPublicationPlan["items"] = [];
    const reserved = new Set<string>();
    const proof = new Map<string, { version: number; fingerprint: string }>();
    let after = -1,
      more = true;
    while (more) {
      this.cancel(signal);
      const page = await this.batches.page(batchId, after);
      for (const selected of page.items) {
        this.cancel(signal);
        const base = {
          itemId: selected.id,
          filename: selected.filename,
          readyCount: 0,
          remainingCount: 0,
        };
        try {
          const { item, summary } = await this.preparation.readValidated(
            batchId,
            selected.id,
            signal,
          );
          const count = {
            readyCount: summary.readyCount,
            remainingCount: summary.productReviewCount + summary.errorCount,
          };
          if (
            await this.publication.findExactDuplicate(
              this.batches.storeId,
              summary.sourceType,
              item.checksum,
            )
          ) {
            items.push({ ...base, status: "DUPLICATE" });
            continue;
          }
          if (
            !summary.readyCount ||
            (await this.publication.analyzeOverlap(
              this.batches.storeId,
              summary,
            ))
          ) {
            items.push({
              ...base,
              ...count,
              status: "BLOCKED",
              code: summary.readyCount
                ? "MERCALYS_RECONCILIATION_REQUIRED"
                : "MERCALYS_NO_READY_LINES",
            });
            continue;
          }
          const keys = summary.lines
            .filter(
              (line) =>
                line.match.state === "AUTO_MATCH" &&
                line.match.matchedProductId,
            )
            .map(
              (line) =>
                `${summary.sourceType}/${line.match.matchedProductId}/${line.record.businessDate}`,
            );
          if (keys.some((key) => reserved.has(key))) {
            items.push({
              ...base,
              ...count,
              status: "BLOCKED",
              code: "MERCALYS_BATCH_OVERLAPPING_FILES",
            });
            continue;
          }
          const fingerprint = await this.fingerprint(JSON.stringify(summary));
          this.cancel(signal);
          keys.forEach((key) => reserved.add(key));
          proof.set(item.id, { version: item.version, fingerprint });
          items.push({ ...base, ...count, status: "READY" });
        } catch (reason) {
          this.cancel(signal);
          items.push({ ...base, status: "FAILED", code: safeCode(reason) });
        }
      }
      after = page.after;
      more = page.hasMore;
    }
    this.cancel(signal);
    const plan = mercalysBatchPublicationPlanSchema.parse({ batchId, items });
    plan.items.forEach(Object.freeze);
    Object.freeze(plan.items);
    Object.freeze(plan);
    this.pending = { plan, proof };
    return plan;
  }
  async confirm(plan: MercalysBatchPublicationPlan, signal?: AbortSignal) {
    if (!this.pending || this.pending.plan !== plan)
      throw Error("MERCALYS_BATCH_PLAN_UNAVAILABLE");
    const { proof } = this.pending;
    this.pending = undefined;
    const header = await this.batches.header(plan.batchId);
    await this.batches.assertConversation(header.conversationId);
    const results: Outcome[] = [];
    for (const selected of plan.items) {
      this.cancel(signal);
      await this.batches.assertConversation(header.conversationId);
      if (selected.status !== "READY") {
        results.push({
          ...selected,
          publishedCount: 0,
          status:
            selected.status === "DUPLICATE" ? "DUPLICATE" : selected.status,
        });
        continue;
      }
      const base = {
        itemId: selected.itemId,
        filename: selected.filename,
        publishedCount: 0,
        remainingCount: selected.remainingCount,
      };
      try {
        const { item, summary } = await this.preparation.readValidated(
          plan.batchId,
          selected.itemId,
          signal,
        );
        if (
          await this.publication.findExactDuplicate(
            this.batches.storeId,
            summary.sourceType,
            item.checksum,
          )
        ) {
          results.push({ ...base, status: "DUPLICATE" });
          continue;
        }
        const basis = proof.get(item.id);
        if (
          !basis ||
          item.version !== basis.version ||
          (await this.fingerprint(JSON.stringify(summary))) !==
            basis.fingerprint
        ) {
          results.push({
            ...base,
            status: "BLOCKED",
            code: "MERCALYS_BATCH_PLAN_CHANGED",
          });
          continue;
        }
        if (
          await this.publication.analyzeOverlap(this.batches.storeId, summary)
        ) {
          results.push({
            ...base,
            status: "BLOCKED",
            code: "MERCALYS_RECONCILIATION_REQUIRED",
          });
          continue;
        }
        this.cancel(signal);
        const result = await this.publication.publish({
          storeId: this.batches.storeId,
          filename: item.filename,
          localFileUri: item.localUri,
          sizeBytes: item.sizeBytes,
          checksum: item.checksum,
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          summary,
        });
        results.push({
          ...base,
          status: "PUBLISHED",
          publishedCount: result.publishedCount,
          remainingCount: result.remainingCount,
        });
      } catch (reason) {
        this.cancel(signal);
        results.push({
          ...base,
          status:
            reason instanceof MercalysExactDuplicateError
              ? "DUPLICATE"
              : reason instanceof MercalysOverlapReconciliationError
                ? "BLOCKED"
                : "FAILED",
          code: safeCode(reason),
        });
      }
    }
    return results;
  }
}
function safeCode(reason: unknown) {
  if (reason instanceof MercalysImportValidationError) return reason.code;
  if (reason instanceof MercalysOverlapReconciliationError)
    return "MERCALYS_RECONCILIATION_REQUIRED";
  if (reason instanceof MercalysExactDuplicateError)
    return "MERCALYS_EXACT_DUPLICATE";
  if (
    reason instanceof Error &&
    reason.message === "MERCALYS_BATCH_FILE_CHANGED"
  )
    return reason.message;
  return "MERCALYS_BATCH_PUBLICATION_FAILED";
}
