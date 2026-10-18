import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  readReceiptRecoveryProposal,
  receiptRecoveryInputSchema,
} from "@fl-copilot/domain";
import { receiptRecoveryFixture } from "../../../../scripts/test-receipt-recovery-fixtures";
import { buildReceiptRecoveryMessages } from "./receipt-recovery-messages";

describe("private receipt recovery proposals", () => {
  it("keeps model input narrow and rejects unknown actions or authority", () => {
    const f = receiptRecoveryFixture();
    expect(receiptRecoveryInputSchema.parse(f.input)).toEqual(f.input);
    for (const extra of [
      { storeId: randomUUID() },
      { recoveryReviewed: true },
      { action: "PUBLISH" },
    ])
      expect(
        receiptRecoveryInputSchema.safeParse({ ...f.input, ...extra }).success,
      ).toBe(false);
  });
  it("persists a deterministic private card bound to the same reply and immutable original", () => {
    const f = receiptRecoveryFixture();
    const first = buildReceiptRecoveryMessages(f.assistant, [f.preview])[0]!;
    expect(buildReceiptRecoveryMessages(f.assistant, [f.preview])).toEqual([
      first,
    ]);
    expect(readReceiptRecoveryProposal(first).content).toMatchObject({
      assistantMessageId: f.assistant.id,
      input: f.input,
      source: f.source,
    });
    expect(first.replyToMessageId).toBe(f.chat.message.id);
    expect(() =>
      readReceiptRecoveryProposal({ ...first, role: "ASSISTANT" }),
    ).toThrow();
    expect(() =>
      readReceiptRecoveryProposal({ ...first, storeId: randomUUID() }),
    ).toThrow();
    expect(
      buildReceiptRecoveryMessages({ ...f.assistant, id: randomUUID() }, [
        f.preview,
      ])[0]!.id,
    ).not.toBe(first.id);
  });
  it("uses only the latest result for a source and suppresses a now published ticket", () => {
    const f = receiptRecoveryFixture();
    const changed = {
      ...f.preview,
      input: { ...f.input, action: "KEEP_BOTH" as const },
    };
    const cards = buildReceiptRecoveryMessages(f.assistant, [
      f.preview,
      changed,
    ]);
    expect(cards).toHaveLength(1);
    expect(readReceiptRecoveryProposal(cards[0]).content.input.action).toBe(
      "KEEP_BOTH",
    );
    expect(
      buildReceiptRecoveryMessages(f.assistant, [
        f.preview,
        { ...f.preview, status: "READ_ONLY" },
      ]),
    ).toEqual([]);
  });
  it("rejects foreign sources and bounds cards without silently dropping decisions", () => {
    const f = receiptRecoveryFixture();
    expect(() =>
      buildReceiptRecoveryMessages(f.assistant, [
        { ...f.preview, source: { ...f.source, storeId: randomUUID() } },
      ]),
    ).toThrow("SCOPE");
    const previews = Array.from({ length: 4 }, () => {
      const id = randomUUID();
      return {
        ...f.preview,
        input: { ...f.input, sourceDocumentId: id },
        source: { ...f.source, sourceDocumentId: id },
      };
    });
    expect(() => buildReceiptRecoveryMessages(f.assistant, previews)).toThrow(
      "LIMIT",
    );
  });
});
