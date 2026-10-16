import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { storeEventFixture } from "../../../../scripts/test-store-event-fixtures";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  copilotOperationsInputSchema,
  copilotOperationsPreviewSchema,
  prepareOperationsRequest,
  readCopilotOperationsProposal,
  operationsUnchanged,
} from "@fl-copilot/domain";
import { buildOperationsProposalMessages } from "./operations-proposal-messages";
const blank = { product: null, event: null, settings: null };
it("rejects coordinates, actor/version/stock injection and keeps capture timestamps representable in tool JSON schema", async () => {
  const { asSchema } = await import("ai");
  const f = storeEventFixture();
  const raw = {
    kind: "FIELD_CAPTURE",
    action: "PREPARE",
    productId: f.product.id,
    patch: { type: "OUT_OF_STOCK", startedAt: "2026-10-09T11:30:00+02:00" },
  };
  expect(await asSchema(copilotOperationsInputSchema).jsonSchema).toBeDefined();
  for (const extra of [
    { quantity: 0 },
    { productVersion: 99 },
    { source: "COMMERCIAL_PDF" },
  ])
    expect(
      copilotOperationsInputSchema.safeParse({
        ...raw,
        patch: { ...raw.patch, ...extra },
      }).success,
    ).toBe(false);
  expect(
    copilotOperationsInputSchema.safeParse({
      kind: "SETTINGS",
      action: "PREPARE",
      patch: { city: "Lyon", position: { latitude: 48, longitude: 2 } },
    }).success,
  ).toBe(false);
  const input = copilotOperationsInputSchema.parse(raw),
    r = prepareOperationsRequest(
      input,
      { ...blank, product: f.product },
      randomUUID(),
    );
  expect(r.input).toMatchObject({
    productVersion: 1,
    startedAt: "2026-10-09T09:30:00.000Z",
  });
});
it("builds stable private cards with scope checks and no action for inspected/unchanged results", () => {
  const settings = storeContextFixture(),
    { position, ...visible } = settings;
  void position;
  const chat = chatFixture(randomUUID),
    assistant = {
      ...chat.message,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      storeId: settings.storeId,
      replyToMessageId: chat.message.id,
      attachments: [],
    };
  const input = copilotOperationsInputSchema.parse({
      kind: "SETTINGS",
      action: "PREPARE",
      patch: { schoolZone: "B" },
    }),
    basis = { ...blank, settings: visible };
  const value = copilotOperationsPreviewSchema.parse({
    input,
    status: "READY",
    basis,
    missingFields: [],
    evidence: [
      {
        id: "settings-preview",
        sourceType: "DATA_QUALITY",
        sourceId: settings.id,
        sourceVersion: 1,
        label: "Réglages",
        value: "À confirmer.",
        factKind: "QUALITY",
      },
    ],
  });
  const cards = buildOperationsProposalMessages(assistant, [value, value]);
  expect(cards).toHaveLength(1);
  expect(buildOperationsProposalMessages(assistant, [value])).toEqual(cards);
  expect(readCopilotOperationsProposal(cards[0]).request.input).toMatchObject({
    city: settings.city,
    postalCode: settings.postalCode,
    schoolZone: "B",
    location: "KEEP",
    expectedVersion: 1,
  });
  expect(
    buildOperationsProposalMessages(assistant, [
      value,
      { ...value, status: "UNCHANGED" },
    ]),
  ).toEqual([]);
  expect(() =>
    buildOperationsProposalMessages(assistant, [
      {
        ...value,
        basis: { ...basis, settings: { ...visible, storeId: randomUUID() } },
      },
    ]),
  ).toThrow();
  expect(
    operationsUnchanged(
      copilotOperationsInputSchema.parse({
        kind: "SETTINGS",
        action: "PREPARE",
        patch: { schoolZone: "C" },
      }),
      basis,
    ),
  ).toBe(true);
});
it("compares closed dates as instants rather than raw offset strings", () => {
  const f = storeEventFixture();
  const event = {
    ...f.event,
    status: "CLOSED" as const,
    endedAt: "2026-10-09T09:45:00.000Z",
  };
  const input = copilotOperationsInputSchema.parse({
    kind: "FIELD_CLOSE",
    action: "PREPARE",
    eventId: event.id,
    patch: { endedAt: "2026-10-09T11:45:00+02:00" },
  });
  expect(
    operationsUnchanged(input, { ...blank, product: f.product, event }),
  ).toBe(true);
});

it("deduplicates two preparations of the same observed instant expressed with different UTC offsets", () => {
  const f = storeEventFixture(),
    chat = chatFixture(randomUUID),
    assistant = {
      ...chat.message,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      storeId: f.event.storeId,
      replyToMessageId: chat.message.id,
      attachments: [],
    };
  const raw = {
    kind: "FIELD_CAPTURE",
    action: "PREPARE",
    productId: f.product.id,
    patch: { type: "OUT_OF_STOCK", startedAt: "2026-10-09T11:30:00+02:00" },
  };
  const value = copilotOperationsPreviewSchema.parse({
    input: raw,
    status: "READY",
    basis: { ...blank, product: f.product },
    missingFields: [],
    evidence: [
      {
        id: "capture-preview",
        sourceType: "DATA_QUALITY",
        sourceId: f.product.id,
        sourceVersion: 1,
        label: "Constat",
        value: "À confirmer.",
        factKind: "QUALITY",
      },
    ],
  });
  const normalized = {
    ...value,
    input: copilotOperationsInputSchema.parse({
      ...raw,
      patch: { ...raw.patch, startedAt: "2026-10-09T09:30:00Z" },
    }),
  };
  expect(
    buildOperationsProposalMessages(assistant, [value, normalized]),
  ).toHaveLength(1);
});
