import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { receiptPublicationChatFixture } from "../../../../scripts/test-receipt-publication-fixtures";
import {
  receiptPublicationInputSchema,
  readReceiptPublicationProposal,
} from "@fl-copilot/domain";
import { buildReceiptPublicationMessages } from "./receipt-publication-messages";
it("accepts only an exact source ID, with no model corrections, amounts or review authority", () => {
  const f = receiptPublicationChatFixture();
  for (const extra of [
    { storeId: randomUUID() },
    { receiptReviewed: true },
    { basisHash: "a".repeat(64) },
    { confirmedWasteDate: "2026-10-12" },
    { totalPrice: "3" },
  ])
    expect(
      receiptPublicationInputSchema.safeParse({ ...f.preview.input, ...extra })
        .success,
    ).toBe(false);
});
it("persists only the latest local-review proposal with stable private identity", () => {
  const f = receiptPublicationChatFixture(),
    cards = buildReceiptPublicationMessages(f.assistant, [
      f.preview,
      f.preview,
    ]);
  expect(cards).toHaveLength(1);
  expect(buildReceiptPublicationMessages(f.assistant, [f.preview])).toEqual(
    cards,
  );
  expect(readReceiptPublicationProposal(cards[0]).content.source).toEqual(
    f.source,
  );
  for (const status of ["ALREADY_PUBLISHED", "NOT_READY", "LIMIT_EXCEEDED"])
    expect(
      buildReceiptPublicationMessages(f.assistant, [
        f.preview,
        { ...f.preview, status },
      ]),
    ).toEqual([]);
  expect(() =>
    readReceiptPublicationProposal({ ...cards[0], role: "USER" }),
  ).toThrow();
  expect(() =>
    buildReceiptPublicationMessages(f.assistant, [
      { ...f.preview, input: { sourceDocumentId: randomUUID() } },
    ]),
  ).toThrow();
  expect(() =>
    buildReceiptPublicationMessages({ ...f.assistant, storeId: randomUUID() }, [
      f.preview,
    ]),
  ).toThrow();
});
it("bounds complete proposal cards without truncating a requested set", () => {
  const f = receiptPublicationChatFixture(),
    previews = Array.from({ length: 4 }, () => {
      const other = receiptPublicationChatFixture();
      return {
        ...other.preview,
        source: { ...other.source, storeId: f.chat.storeId },
      };
    });
  expect(() => buildReceiptPublicationMessages(f.assistant, previews)).toThrow(
    "LIMIT",
  );
});
