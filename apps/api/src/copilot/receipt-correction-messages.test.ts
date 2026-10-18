import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { receiptCorrectionFixture } from "../../../../scripts/test-receipt-correction-fixtures";
import {
  receiptCorrectionInputSchema,
  readReceiptCorrectionProposal,
} from "@fl-copilot/domain";
import { buildReceiptCorrectionMessages } from "./receipt-correction-messages";
it("accepts only bounded explicit partial changes, preserves cashier zeroes and distinguishes null from zero", () => {
  const f = receiptCorrectionFixture();
  expect(receiptCorrectionInputSchema.parse(f.input).patch.cashierNumber).toBe(
    "000123",
  );
  const parse = (patch: unknown) =>
    receiptCorrectionInputSchema.safeParse({
      sourceDocumentId: f.source.sourceDocumentId,
      patch,
    }).success;
  for (const patch of [
    {},
    { lines: [] },
    { lines: [{ lineId: f.p.lines[0]!.id }] },
    { lines: [{ lineId: f.p.lines[0]!.id, values: {} }] },
    {
      lines: Array.from({ length: 11 }, () => ({
        lineId: randomUUID(),
        excluded: true,
      })),
    },
    { lines: [f.input.patch.lines![0], f.input.patch.lines![0]] },
    { wasteDate: "2026-02-30" },
    { lines: [{ lineId: f.p.lines[0]!.id, values: { totalPrice: "-1" } }] },
  ])
    expect(parse(patch)).toBe(false);
  expect(
    parse({
      lines: [
        { lineId: f.p.lines[0]!.id, values: { quantity: "0", weight: null } },
      ],
    }),
  ).toBe(true);
  for (const extra of [
    { storeId: randomUUID() },
    { correctionReviewed: true },
    { version: 1 },
  ])
    expect(
      receiptCorrectionInputSchema.safeParse({ ...f.input, ...extra }).success,
    ).toBe(false);
});
it("persists only the latest complete correction card per source and rejects scope/role mismatches", () => {
  const f = receiptCorrectionFixture(),
    cards = buildReceiptCorrectionMessages(f.assistant, [f.preview, f.preview]);
  expect(cards).toHaveLength(1);
  expect(buildReceiptCorrectionMessages(f.assistant, [f.preview])).toEqual(
    cards,
  );
  expect(readReceiptCorrectionProposal(cards[0]).content.input).toEqual(
    f.input,
  );
  for (const status of ["READ_ONLY", "NOT_READY", "LIMIT_EXCEEDED"])
    expect(
      buildReceiptCorrectionMessages(f.assistant, [
        f.preview,
        { ...f.preview, status },
      ]),
    ).toEqual([]);
  expect(() =>
    readReceiptCorrectionProposal({ ...cards[0], role: "USER" }),
  ).toThrow();
  expect(() =>
    buildReceiptCorrectionMessages(f.assistant, [
      { ...f.preview, source: { ...f.source, storeId: randomUUID() } },
    ]),
  ).toThrow();
  expect(() =>
    buildReceiptCorrectionMessages(f.assistant, [
      { ...f.preview, input: { ...f.input, sourceDocumentId: randomUUID() } },
    ]),
  ).toThrow();
});
it("does not silently truncate more than three requested source cards", () => {
  const f = receiptCorrectionFixture(),
    many = Array.from({ length: 4 }, () => {
      const other = receiptCorrectionFixture();
      return {
        ...other.preview,
        source: { ...other.source, storeId: f.source.storeId },
      };
    });
  expect(() => buildReceiptCorrectionMessages(f.assistant, many)).toThrow(
    "LIMIT",
  );
});
