import { describe, it, expect } from "vitest";
import type { WasteReceipt } from "@fl-copilot/domain";
import { receiptProcessingPresentation } from "./waste-receipt-processing";
const receipt: WasteReceipt = {
  id: "test",
  storeId: "store",
  processingStatus: "UPLOAD_PENDING",
  aiStatus: "PENDING",
  duplicateStatus: "NOT_DUPLICATE",
  version: 1,
  createdAt: "test",
  updatedAt: "test",
  syncState: "LOCAL_ONLY",
  dirty: true,
};
const job = {
  id: "job",
  status: "RETRY",
  lastError: "INTERNAL_ERROR",
  nextAttemptAt: "date",
  attemptCount: 1,
};
describe("Receipt processing UX", () => {
  it("explains offline capture, processing and actionable failures", () => {
    expect(receiptProcessingPresentation(receipt, job, 0, true).title).toBe(
      "En attente de connexion",
    );
    expect(
      receiptProcessingPresentation(
        { ...receipt, aiStatus: "PROCESSING" },
        { ...job, status: "RUNNING" },
        0,
        false,
      ),
    ).toMatchObject({ title: "Analyse en cours", canRetry: false });
    expect(
      receiptProcessingPresentation(
        { ...receipt, processingStatus: "FAILED", aiStatus: "FAILED" },
        job,
        0,
        false,
      ),
    ).toMatchObject({ title: "Traitement indisponible", canRetry: true });
  });
  it("never treats an empty successful extraction as a pending job or offers a retry for missing source files", () => {
    expect(
      receiptProcessingPresentation(
        { ...receipt, aiStatus: "COMPLETED" },
        job,
        0,
        false,
      ),
    ).toMatchObject({ title: "Aucune ligne détectée", canRetry: false });
    expect(
      receiptProcessingPresentation(
        receipt,
        { ...job, lastError: "SOURCE_UPLOAD_LOCAL_FILE_MISSING" },
        0,
        false,
      ),
    ).toMatchObject({ title: "Envoi impossible", canRetry: false });
  });
  it("shows validation and publication status even when the device is offline", () => {
    expect(
      receiptProcessingPresentation(
        { ...receipt, aiStatus: "COMPLETED" },
        job,
        4,
        true,
      ).title,
    ).toBe("À valider");
    expect(
      receiptProcessingPresentation(
        { ...receipt, processingStatus: "PUBLISHED", syncState: "SYNCED" },
        job,
        4,
        true,
      ),
    ).toMatchObject({
      title: "Casse synchronisée",
      status: "synced",
      canRetry: false,
    });
  });
});
