import { it, expect } from "vitest";
import type { WasteLine } from "@fl-copilot/domain";
import {
  receiptLineValues,
  receiptLineDirtyFields,
  updateReceiptLineEdit,
  withoutReceiptLineEdit,
} from "./receipt-editor-state";
const line = {
  id: "00000000-0000-4000-8000-000000000001",
  rawLabel: "FIGUE VRAC",
  weight: "0.5",
  quantity: null,
  quantityUnit: "KG",
  unitPrice: "2",
  totalPrice: "1",
  version: 1,
} as WasteLine;
it("preserves edited values and their original version across a new source label/group and keeps unrelated line drafts", () => {
  const edits = updateReceiptLineEdit({}, line, {
    weight: "",
    totalPrice: "0",
  });
  const newer = { ...line, rawLabel: "FIGUES", version: 2 };
  expect(receiptLineValues(newer).rawLabel).toBe("FIGUES");
  expect(edits[line.id]!.values).toMatchObject({
    rawLabel: "FIGUE VRAC",
    weight: "",
    totalPrice: "0",
  });
  const next = updateReceiptLineEdit(edits, newer, { quantity: "3" });
  expect(next[line.id]!.baseline.version).toBe(1);
  expect(receiptLineDirtyFields(line, next[line.id]!.values)).toEqual([
    "weight",
    "quantity",
    "totalPrice",
  ]);
  const other = { ...line, id: "00000000-0000-4000-8000-000000000002" };
  const both = updateReceiptLineEdit(next, other, { rawLabel: "Autre saisie" });
  const reset = withoutReceiptLineEdit(both, line.id);
  expect(reset[line.id]).toBeUndefined();
  expect(reset[other.id]!.values.rawLabel).toBe("Autre saisie");
  expect(edits[line.id]!.values.weight).toBe("");
});
it("drops an unchanged draft only while its original version is still current", () => {
  const edits = updateReceiptLineEdit({}, line, { rawLabel: "Corrigé" });
  expect(
    updateReceiptLineEdit(edits, line, { rawLabel: line.rawLabel }),
  ).toEqual({});
  const stale = updateReceiptLineEdit(
    edits,
    { ...line, version: 2 },
    { rawLabel: line.rawLabel },
  );
  expect(stale[line.id]!.baseline.version).toBe(1);
});

it("keeps a deliberately blank cashier separate from both the OCR proposal and a confirmed clear", async () => {
  const { receiptHeaderValues } = await import("./receipt-editor-state");
  const receipt = {
    detectedCashierNumber: "000317",
    confirmedCashierNumber: null,
    cashierNumberConfirmedAt: null,
    confirmedWasteDate: "2026-10-01",
    detectedReceiptDate: "2026-09-30",
  } as unknown as import("@fl-copilot/domain").WasteReceipt;
  expect(receiptHeaderValues(receipt).cashierNumber).toBe("000317");
  expect(receiptHeaderValues(receipt, undefined, "")).toMatchObject({
    cashierNumber: "",
    dirty: true,
  });
  const saved = {
    ...receipt,
    cashierNumberConfirmedAt: "2026-10-20T12:00:00.000Z",
  };
  expect(receiptHeaderValues(saved)).toMatchObject({
    cashierNumber: "",
    dirty: false,
  });
  expect(receiptHeaderValues(saved, "2026-10-02").date).toBe("2026-10-02");
  expect(
    receiptHeaderValues(
      { ...saved, confirmedWasteDate: "2026-10-03" },
      "2026-10-02",
    ).date,
  ).toBe("2026-10-02");
});
