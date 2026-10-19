import type { LocalWasteReceiptSummary } from "./waste-receipt-repository";
import { receiptProcessingPresentation } from "./waste-receipt-processing";
import { normalizeProductLabel } from "@fl-copilot/domain";
const captureFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
export type ReceiptListFilter = "ALL" | "REVIEW" | "PENDING" | "PUBLISHED";
export function receiptListPresentation(
  row: LocalWasteReceiptSummary,
  offline: boolean,
) {
  const r = row.receipt;
  const date = r.confirmedWasteDate ?? r.detectedReceiptDate;
  const title = r.confirmedWasteDate
    ? `Casse du ${frenchDate(r.confirmedWasteDate)}`
    : r.detectedReceiptDate
      ? `Date proposée : ${frenchDate(r.detectedReceiptDate)}`
      : "Date de casse à confirmer";
  const captured = r.captureDate ?? r.createdAt;
  const captureDate = new Date(captured);
  const capture = Number.isNaN(captureDate.getTime())
    ? "Date de capture indisponible"
    : `Capturé le ${captureFormatter.format(captureDate)}`;
  const cashier = r.cashierNumberConfirmedAt
    ? r.confirmedCashierNumber
    : (r.confirmedCashierNumber ?? r.detectedCashierNumber);
  const cashierLabel = cashier
    ? `Caissier ${cashier}${r.cashierNumberConfirmedAt ? "" : " · à confirmer"}`
    : null;
  return {
    heading: title,
    capture,
    cashierLabel,
    date: date ?? null,
    processing: receiptProcessingPresentation(
      r,
      row.uploadJob,
      row.lineCount,
      offline,
    ),
  };
}
export function filterReceipts(
  rows: LocalWasteReceiptSummary[],
  query: string,
  filter: ReceiptListFilter,
  offline: boolean,
) {
  const term = normalizeProductLabel(query);
  return rows.filter((row) => {
    const p = receiptListPresentation(row, offline),
      r = row.receipt;
    const review =
      ["error", "conflict"].includes(p.processing.status) ||
      r.processingStatus === "FAILED" ||
      r.aiStatus === "FAILED" ||
      (r.duplicateStatus !== "CONFIRMED_DUPLICATE" &&
        p.processing.status === "incomplete") ||
      (r.aiStatus === "COMPLETED" &&
        r.processingStatus !== "PUBLISHED" &&
        r.duplicateStatus !== "CONFIRMED_DUPLICATE");
    return (
      (!term ||
        [
          p.heading,
          p.processing.title,
          p.capture,
          p.cashierLabel,
          p.date,
          r.note,
        ].some(
          (value) => value && normalizeProductLabel(value).includes(term),
        )) &&
      (filter === "ALL" ||
        (filter === "REVIEW" && review) ||
        (filter === "PENDING" && p.processing.status === "pending") ||
        (filter === "PUBLISHED" && r.processingStatus === "PUBLISHED"))
    );
  });
}
function frenchDate(value: string) {
  return value.split("-").reverse().join("/");
}
