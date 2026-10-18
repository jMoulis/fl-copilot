import { randomUUID } from "node:crypto";
import {
  productSchema,
  productAliasSchema,
  productIdentifierSchema,
  copilotMessageSchema,
  identityReviewPreviewSchema,
} from "../packages/domain/src/index";
import { chatFixture } from "./test-chat-fixtures";
export function identityFixture(
  kind: "ALIAS" | "IDENTIFIER" = "ALIAS",
  status: "TO_REVIEW" | "VALIDATED" | "REJECTED" = "TO_REVIEW",
) {
  const chat = chatFixture(randomUUID),
    time = chat.message.createdAt;
  chat.message.attachments = [];
  chat.message.text = "Confirme cette correspondance pour la banane.";
  const product = productSchema.parse({
    id: randomUUID(),
    storeId: chat.storeId,
    label: "BANANE VRAC",
    category: "UNKNOWN",
    nature: "UNKNOWN",
    salesUnit: "UNKNOWN",
    packaging: null,
    familyId: null,
    subfamilyId: null,
    status: "ACTIVE",
    version: 4,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  });
  const common = {
    id: randomUUID(),
    storeId: chat.storeId,
    productId: product.id,
    source: "AI_PROPOSED",
    status,
    version: 3,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  };
  const entry =
    kind === "ALIAS"
      ? productAliasSchema.parse({
          ...common,
          alias: "Bananes jaunes",
          normalizedAlias: "BANANES JAUNES",
          confidence: 0.63,
        })
      : productIdentifierSchema.parse({
          ...common,
          type: "PLU",
          value: "00042",
        });
  const input = {
      kind,
      productId: product.id,
      entryId: entry.id,
      decision: "VALIDATE" as const,
    },
    before = { product, entry };
  const assistant = copilotMessageSchema.parse({
    ...chat.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: chat.message.id,
    text: "Voici la décision à confirmer.",
    createdAt: "2026-10-11T12:01:00.000Z",
  });
  const preview = identityReviewPreviewSchema.parse({
    input,
    status: status === "VALIDATED" ? "UNCHANGED" : "READY",
    before,
    evidence: [
      {
        id: `identity-review/${entry.id}`,
        sourceType: "DATA_QUALITY",
        sourceId: entry.id,
        sourceVersion: entry.version,
        label: "Correspondance",
        value: "Décision préparée, pas enregistrée.",
        factKind: "QUALITY",
      },
    ],
  });
  return { chat, product, entry, input, before, assistant, preview };
}
