import type { WasteLine } from "@fl-copilot/domain";
import type { WastePublicationField } from "./waste-publication-validation";
export function receiptLineValues(line: WasteLine) {
  return {
    rawLabel: line.rawLabel,
    weight: line.weight ?? "",
    quantity: line.quantity ?? "",
    quantityUnit: line.quantityUnit ?? "UNKNOWN",
    unitPrice: line.unitPrice ?? "",
    totalPrice: line.totalPrice ?? "",
  };
}
export type ReceiptLineValues = ReturnType<typeof receiptLineValues>;
export type ReceiptLineEdits = Record<
  string,
  { baseline: WasteLine; values: ReceiptLineValues }
>;
/** Screen-owned edits survive regrouping/collapsing of the same stable line UUID. */
export function updateReceiptLineEdit(
  edits: ReceiptLineEdits,
  line: WasteLine,
  patch: Partial<ReceiptLineValues>,
): ReceiptLineEdits {
  const baseline = edits[line.id]?.baseline ?? line;
  const values = {
    ...(edits[line.id]?.values ?? receiptLineValues(line)),
    ...patch,
  };
  const next = { ...edits };
  if (
    line.version === baseline.version &&
    !receiptLineDirtyFields(baseline, values).length
  )
    delete next[line.id];
  else next[line.id] = { baseline, values };
  return next;
}
export function receiptLineDirtyFields(
  baseline: WasteLine,
  values: ReceiptLineValues,
): WastePublicationField[] {
  const base = receiptLineValues(baseline);
  return (Object.keys(base) as (keyof ReceiptLineValues)[]).filter(
    (k) => base[k] !== values[k],
  );
}
export function withoutReceiptLineEdit(edits: ReceiptLineEdits, id: string) {
  const next = { ...edits };
  delete next[id];
  return next;
}

/** Undefined means untouched; an explicit blank must never reuse an OCR proposal. */
export function receiptHeaderValues(
  receipt: import("@fl-copilot/domain").WasteReceipt | undefined,
  dateDraft?: string,
  cashierDraft?: string,
) {
  const savedDate =
    receipt?.confirmedWasteDate ?? receipt?.detectedReceiptDate ?? "";
  const savedCashierNumber = receipt?.cashierNumberConfirmedAt
    ? (receipt.confirmedCashierNumber ?? "")
    : (receipt?.detectedCashierNumber ?? "");
  return {
    date: dateDraft ?? savedDate,
    cashierNumber: cashierDraft ?? savedCashierNumber,
    savedCashierNumber,
    dirty:
      (dateDraft !== undefined && dateDraft !== receipt?.confirmedWasteDate) ||
      (cashierDraft !== undefined &&
        cashierDraft.trim() !== savedCashierNumber),
  };
}
