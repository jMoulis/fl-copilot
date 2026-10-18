import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  storeConflictInputSchema,
  readStoreConflictProposal,
} from "@fl-copilot/domain";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { receiptRecoveryFixture } from "../../../../scripts/test-receipt-recovery-fixtures";
import { storeConflictPreview } from "../../../../scripts/test-store-conflict-fixtures";
import { buildStoreConflictMessages } from "./store-conflict-messages";
it("requires a known event or scoped settings, with no model decision or permission", () => {
  for (const bad of [
    { kind: "FIELD_EVENT", entityId: null },
    { kind: "SETTINGS", entityId: randomUUID() },
    { kind: "SETTINGS", entityId: null, decision: "KEEP_LOCAL" },
    { kind: "SETTINGS", entityId: null, canManageStoreSettings: true },
  ])
    expect(storeConflictInputSchema.safeParse(bad).success).toBe(false);
});
it("binds a private deterministic artifact, replaces an earlier target snapshot and bounds comparisons", () => {
  const f = receiptRecoveryFixture(),
    settings = {
      ...storeContextFixture(),
      id: f.chat.storeId,
      storeId: f.chat.storeId,
    },
    preview = storeConflictPreview("SETTINGS", settings),
    card = buildStoreConflictMessages(f.assistant, [preview])[0]!;
  expect(readStoreConflictProposal(card).content.assistantMessageId).toBe(
    f.assistant.id,
  );
  expect(card.replyToMessageId).toBe(f.chat.message.id);
  expect(buildStoreConflictMessages(f.assistant, [preview])).toEqual([card]);
  const latest = storeConflictPreview("SETTINGS", { ...settings, version: 2 });
  expect(
    readStoreConflictProposal(
      buildStoreConflictMessages(f.assistant, [preview, latest])[0],
    ).content.basis.remoteVersion,
  ).toBe(2);
  expect(() =>
    buildStoreConflictMessages(f.assistant, [
      { ...preview, basis: { ...preview.basis, storeId: randomUUID() } },
    ]),
  ).toThrow();
  expect(() => readStoreConflictProposal({ ...card, role: "USER" })).toThrow();
  expect(() =>
    readStoreConflictProposal({ ...card, storeId: randomUUID() }),
  ).toThrow();
});

it.each(["NEED", "MEMBERSHIP", "SUBSTITUTION"] as const)(
  "binds new %s cards to version 2 without widening version 1",
  async (kind) => {
    const { nativeNeedConflictFixture } =
      await import("../../../../scripts/test-need-conflict-fixtures");
    const s = await nativeNeedConflictFixture(kind);
    try {
      const card = s.review.message,
        content = readStoreConflictProposal(card).content;
      expect(content.schemaVersion).toBe(2);
      expect(() =>
        readStoreConflictProposal({
          ...card,
          text: JSON.stringify({ ...content, schemaVersion: 1 }),
        }),
      ).toThrow("VERSION");
      expect(
        storeConflictInputSchema.safeParse({
          ...content.input,
          reactivateRejected: true,
        }).success,
      ).toBe(false);
    } finally {
      s.db.close();
    }
  },
);

it.each([
  "COMMERCIAL_CHOICE",
  "COMMERCIAL_PREPARATION",
  "COMMERCIAL_PLAN",
] as const)(
  "binds %s to artifact version 3 and rejects downgrade",
  async (kind) => {
    const { nativeCommercialConflictFixture } =
      await import("../../../../scripts/test-commercial-conflict-fixtures");
    const s = await nativeCommercialConflictFixture(kind);
    try {
      const { content } = readStoreConflictProposal(s.review.message);
      expect(content.schemaVersion).toBe(3);
      for (const schemaVersion of [1, 2])
        expect(() =>
          readStoreConflictProposal({
            ...s.review.message,
            text: JSON.stringify({ ...content, schemaVersion }),
          }),
        ).toThrow();
    } finally {
      s.db.close();
    }
  },
);
