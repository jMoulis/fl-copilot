import { it, expect } from "vitest";
import type { LocalWasteReceiptSummary } from "./waste-receipt-repository";
import {
  filterReceipts,
  receiptListPresentation,
} from "./receipt-list-presentation";
import type { MercalysBatchItem } from "@fl-copilot/domain";
import {
  batchPublicationLabel,
  filterBatchItems,
  matchingBatchPublication,
} from "./mercalys-batch-presentation";
const at = "2026-10-19T12:00:00.000Z";
function receipt(
  patch: Partial<LocalWasteReceiptSummary["receipt"]> = {},
): LocalWasteReceiptSummary {
  return {
    receipt: {
      id: "11111111-1111-4111-8111-111111111111",
      storeId: "22222222-2222-4222-8222-222222222222",
      processingStatus: "UPLOAD_PENDING",
      aiStatus: "PENDING",
      duplicateStatus: "UNIQUE",
      version: 1,
      createdAt: at,
      updatedAt: at,
      syncState: "PENDING",
      dirty: true,
      ...patch,
    },
    localFileUri: null,
    lineCount: 0,
    uploadJob: null,
  };
}
it("distinguishes receipt business date, proposed date and capture date, preserving cashier zeroes and explicit clearing", () => {
  const r = receipt({
    detectedReceiptDate: "2026-10-10",
    confirmedWasteDate: "2026-10-11",
    detectedCashierNumber: "000317",
  });
  expect(receiptListPresentation(r, false)).toMatchObject({
    heading: "Casse du 11/10/2026",
    cashierLabel: "Caissier 000317 · à confirmer",
    date: "2026-10-11",
  });
  expect(
    receiptListPresentation(
      receipt({ detectedReceiptDate: "2026-10-10" }),
      false,
    ).heading,
  ).toBe("Date proposée : 10/10/2026");
  expect(receiptListPresentation(receipt(), false).heading).toBe(
    "Date de casse à confirmer",
  );
  const cleared = {
    ...r,
    receipt: {
      ...r.receipt,
      cashierNumberConfirmedAt: at,
      confirmedCashierNumber: null,
    },
  };
  expect(receiptListPresentation(cleared, false).cashierLabel).toBeNull();
  expect(filterReceipts([r, cleared], "000317", "ALL", false)).toEqual([r]);
  expect(filterReceipts([r], "2026-10-11", "ALL", false)).toEqual([r]);
});
it("keeps local publication separate from pending sync and does not send confirmed duplicates back for review", () => {
  const published = receipt({
    processingStatus: "PUBLISHED",
    syncState: "PENDING",
  });
  const done = receipt({
    duplicateStatus: "CONFIRMED_DUPLICATE",
    aiStatus: "COMPLETED",
  });
  const review = receipt({
    aiStatus: "COMPLETED",
    processingStatus: "TO_VALIDATE",
  });
  const conflict = receipt({
    processingStatus: "PUBLISHED",
    syncState: "CONFLICT",
  });
  expect(
    filterReceipts([published, done, review, conflict], "", "PUBLISHED", false),
  ).toEqual([published, conflict]);
  expect(
    filterReceipts([published, done, review, conflict], "", "REVIEW", false),
  ).toEqual([review, conflict]);
  expect(
    filterReceipts([published, done, review, conflict], "", "PENDING", false),
  ).toEqual([published]);
  expect(receiptListPresentation(conflict, false).processing).toMatchObject({
    status: "conflict",
    canRetry: false,
  });
  expect(
    receiptListPresentation(receipt({ syncState: "ERROR" }), false).processing,
  ).toMatchObject({ status: "error", canRetry: false });
});
function batchItem(patch: Partial<MercalysBatchItem> = {}): MercalysBatchItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    batchId: "22222222-2222-4222-8222-222222222222",
    filename: "Imports/casse/été.xlsx",
    localUri: "file:///example.xlsx",
    sizeBytes: 1,
    checksum: `sha256:${"a".repeat(64)}`,
    position: 0,
    version: 1,
    updatedAt: at,
    result: {
      status: "REVIEW",
      sourceType: "MERCALYS_WASTE",
      parserVersion: "test",
      businessPeriodStart: "2026-10-11",
      businessPeriodEnd: "2026-10-11",
      readyCount: 10,
      productReviewCount: 3,
      errorCount: 0,
      overlap: false,
    },
    ...patch,
  };
}
it("uses committed publication counts, not an old validation result, when filtering a completed file", () => {
  const item = batchItem(),
    p = {
      checksum: item.checksum,
      source_type: "MERCALYS_WASTE",
      published_count: 13,
      remaining_count: 0,
    };
  expect(filterBatchItems([item], [p], "ete", "PUBLISHED")).toEqual([item]);
  expect(filterBatchItems([item], [p], "", "REVIEW")).toEqual([]);
  const partial = { ...p, published_count: 10, remaining_count: 3 };
  expect(filterBatchItems([item], [partial], "", "PUBLISHED")).toEqual([item]);
  expect(filterBatchItems([item], [partial], "", "REVIEW")).toEqual([item]);
  expect(batchPublicationLabel(item, [partial])).toContain(
    "3 lignes non publiées",
  );
  expect(filterBatchItems([item], [], "", "PUBLISHED")).toEqual([]);
});
it("does not infer a publication from an ambiguous checksum or treat queued and failed files alike", () => {
  const queued = batchItem({ result: { status: "QUEUED" } }),
    failed = batchItem({
      result: { status: "FAILED", code: "FORMAT_UNRECOGNIZED" },
    });
  const p = {
    checksum: queued.checksum,
    source_type: "MERCALYS_WASTE",
    published_count: 1,
    remaining_count: 0,
  };
  expect(
    matchingBatchPublication(queued, [
      p,
      { ...p, source_type: "MERCALYS_SALES" },
    ]),
  ).toBeUndefined();
  expect(filterBatchItems([queued, failed], [], "", "QUEUED")).toEqual([
    queued,
  ]);
  expect(filterBatchItems([queued, failed], [], "", "REVIEW")).toEqual([
    failed,
  ]);
  expect(filterBatchItems([failed], [p], "", "REVIEW")).toEqual([failed]);
  expect(filterBatchItems([queued, failed], [], "missing", "ALL")).toEqual([]);
});
