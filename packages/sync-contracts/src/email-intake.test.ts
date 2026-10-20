let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import { expect, it } from "vitest";
import {
  emailIntakeBindingRequestSchema,
  emailIntakeBindingSchema,
  emailIntakeReceiptSchema,
  emailIntakeDecisionSchema,
} from "./email-intake";
it("keeps authority out of setup requests and normalizes the allowed mailbox", () => {
  const input = {
    id: randomUUID(),
    conversationId: randomUUID(),
    allowedSender: "Manager@Example.test",
  };
  expect(emailIntakeBindingRequestSchema.parse(input).allowedSender).toBe(
    "manager@example.test",
  );
  for (const extra of [
    { storeId: randomUUID() },
    { ownerId: randomUUID() },
    { recipient: "attacker@example.test" },
    { active: true },
  ])
    expect(
      emailIntakeBindingRequestSchema.safeParse({ ...input, ...extra }).success,
    ).toBe(false);
});
it("keeps credentials, download capabilities and provider bodies outside public intake DTOs", () => {
  const binding = {
    id: randomUUID(),
    storeId: randomUUID(),
    ownerId: randomUUID(),
    conversationId: randomUUID(),
    recipient: "fl-private@unit.resend.app",
    allowedSender: "manager@example.test",
    createdAt: "2026-10-20T12:00:00Z",
    revokedAt: null,
  };
  expect(emailIntakeBindingSchema.parse(binding)).toEqual(binding);
  expect(
    emailIntakeBindingSchema.safeParse({
      ...binding,
      webhookSecret: "test-only",
    }).success,
  ).toBe(false);
  const receipt = {
    id: randomUUID(),
    storeId: binding.storeId,
    ownerId: binding.ownerId,
    conversationId: binding.conversationId,
    bindingId: binding.id,
    providerEmailId: randomUUID(),
    sender: binding.allowedSender,
    subject: "Documents",
    receivedAt: binding.createdAt,
    updatedAt: binding.createdAt,
    version: 1,
    status: "AWAITING_CONFIRMATION",
    files: [
      {
        id: randomUUID(),
        providerAttachmentId: randomUUID(),
        filename: "ventes.zip",
        mediaType: "application/zip",
        status: "PENDING",
        sourceDocumentId: null,
      },
    ],
  };
  expect(emailIntakeReceiptSchema.safeParse(receipt).success).toBe(true);
  for (const extra of [
    { html: "<b>source</b>" },
    { text: "source" },
    { url: "https://example.test/private" },
  ])
    expect(
      emailIntakeReceiptSchema.safeParse({ ...receipt, ...extra }).success,
    ).toBe(false);
  expect(
    emailIntakeReceiptSchema.safeParse({
      ...receipt,
      files: [receipt.files[0], receipt.files[0]],
    }).success,
  ).toBe(false);
});

it("binds immutable human decisions to one receipt and represents pending preservation without inventing proof", () => {
  const id = randomUUID(),
    file = {
      fileId: randomUUID(),
      processingId: randomUUID(),
      mode: "AUTO" as const,
      manifestHash: null,
      checksum: null,
    };
  const decision = {
    id,
    receiptId: id,
    actionId: randomUUID(),
    storeId: randomUUID(),
    ownerId: randomUUID(),
    conversationId: randomUUID(),
    version: 1,
    policyVersion: 1,
    receiptVersion: 2,
    choice: "ADMIT",
    files: [file],
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
  };
  expect(emailIntakeDecisionSchema.safeParse(decision).success).toBe(true);
  for (const change of [
    { receiptId: randomUUID() },
    { version: 2 },
    { policyVersion: 2 },
    { choice: "DISMISS" },
    { files: [] },
    { files: [file, file] },
    { files: [{ ...file, checksum: `sha256:${"a".repeat(64)}` }] },
    {
      files: Array.from({ length: 2 }, () => ({
        ...file,
        fileId: randomUUID(),
      })),
    },
    {
      files: Array.from({ length: 6 }, () => ({
        ...file,
        fileId: randomUUID(),
        mode: "WASTE_TICKET",
      })),
    },
    { updatedAt: "2026-10-20T12:01:00.000Z" },
    {
      createdAt: `2026-10-20T12:00:00.${"0".repeat(2000)}Z`,
      updatedAt: `2026-10-20T12:00:00.${"0".repeat(2000)}Z`,
    },
    { html: "<b>publish</b>" },
  ])
    expect(
      emailIntakeDecisionSchema.safeParse({ ...decision, ...change }).success,
    ).toBe(false);
  expect(
    emailIntakeDecisionSchema.safeParse({
      ...decision,
      files: Array.from({ length: 5 }, () => ({
        ...file,
        fileId: randomUUID(),
        mode: "WASTE_TICKET",
      })),
    }).success,
  ).toBe(true);
});
