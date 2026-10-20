import { MAX_MERCALYS_BATCH_FILE_BYTES } from "@fl-copilot/domain";
import type {
  MercalysBatchResult,
  ProductMatchCatalog,
} from "@fl-copilot/domain";
import { MercalysBatchRepository } from "./mercalys-batch-repository";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";
import {
  validateMercalysImport,
  MercalysImportValidationError,
} from "./mercalys-import-validation";
import type { MercalysImportPublicationRepository } from "./mercalys-import-publication";
/** One retained file at a time. Prepare/review does not publish or confirm product identities. */
export class MercalysBatchPreparation {
  constructor(
    private batches: MercalysBatchRepository,
    private dependencies: {
      read(uri: string): Promise<Uint8Array<ArrayBuffer>>;
      checksum(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
      catalog(): Promise<ProductMatchCatalog>;
      publication: Pick<
        MercalysImportPublicationRepository,
        "findExactDuplicate" | "analyzeOverlap"
      >;
    },
  ) {}
  async readValidated(batchId: string, itemId: string, signal?: AbortSignal) {
    const cancel = () => {
      if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
    };
    cancel();
    const item = await this.batches.get(batchId, itemId);
    const location = await this.batches.retainedLocation(batchId, itemId);
    cancel();
    const bytes = await this.dependencies.read(location);
    cancel();
    if (
      !bytes.byteLength ||
      bytes.byteLength > MAX_MERCALYS_BATCH_FILE_BYTES ||
      bytes.byteLength !== item.sizeBytes ||
      (await this.dependencies.checksum(bytes)) !== item.checksum
    )
      throw Error("MERCALYS_BATCH_FILE_CHANGED");
    cancel();
    const workbook = new SheetJsSpreadsheetParser().parse(bytes);
    const summary = validateMercalysImport(
      workbook,
      this.batches.storeId,
      await this.dependencies.catalog(),
    );
    cancel();
    return { item, summary, localUri: location };
  }
  async prepare(batchId: string, itemId: string, signal?: AbortSignal) {
    const cancel = () => {
      if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
    };
    cancel();
    const item = await this.batches.get(batchId, itemId);
    if (!["QUEUED", "FAILED"].includes(item.result.status)) return item;
    let result: MercalysBatchResult;
    try {
      const { summary } = await this.readValidated(batchId, itemId, signal);
      const duplicate = await this.dependencies.publication.findExactDuplicate(
        this.batches.storeId,
        summary.sourceType,
        item.checksum,
      );
      cancel();
      if (duplicate)
        result = {
          status: "DUPLICATE",
          sourceDocumentId: duplicate.sourceDocumentId,
          sourceType: summary.sourceType,
        };
      else {
        const overlap = await this.dependencies.publication.analyzeOverlap(
          this.batches.storeId,
          summary,
        );
        cancel();
        result = {
          status: "REVIEW",
          sourceType: summary.sourceType,
          parserVersion: summary.parserVersion,
          businessPeriodStart: summary.businessPeriodStart,
          businessPeriodEnd: summary.businessPeriodEnd,
          readyCount: summary.readyCount,
          productReviewCount: summary.productReviewCount,
          errorCount: summary.errorCount,
          overlap: !!overlap,
        };
      }
    } catch (reason) {
      cancel();
      // Never persist arbitrary library exceptions, local paths or credential-bearing messages.
      result = {
        status: "FAILED",
        code:
          reason instanceof MercalysImportValidationError
            ? reason.code
            : reason instanceof Error &&
                [
                  "MERCALYS_BATCH_FILE_CHANGED",
                  "MERCALYS_BATCH_MEMBER_COPY_REQUIRED",
                ].includes(reason.message)
              ? reason.message
              : "MERCALYS_BATCH_PREPARATION_FAILED",
      };
    }
    cancel();
    return this.batches.finish(batchId, itemId, item.version, result);
  }
  async preparePending(batchId: string, signal?: AbortSignal) {
    let after = -1;
    let hasMore = true;
    while (hasMore) {
      if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
      const page = await this.batches.page(batchId, after);
      for (const item of page.items)
        await this.prepare(batchId, item.id, signal);
      after = page.after;
      hasMore = page.hasMore;
    }
  }
}
