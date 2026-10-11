import { z } from "zod";
import {
  storeProductEventSchema,
  storeEventCaptureSchema,
  closeStoreEventPayloadSchema,
} from "./store-product-event";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
export const fieldToolAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({ canCaptureStoreEvents: z.boolean() });
export type FieldToolAuthority = z.infer<typeof fieldToolAuthoritySchema>;
export const captureFieldEventInputSchema = z
  .strictObject({
    productId: z.string().uuid(),
    productVersion: z.number().int().positive(),
    type: storeEventCaptureSchema.shape.type,
    startedAt: storeEventCaptureSchema.shape.startedAt,
    endedAt: storeEventCaptureSchema.shape.endedAt,
    severity: storeEventCaptureSchema.shape.severity,
    comment: storeEventCaptureSchema.shape.comment,
  })
  .refine((v) => !v.endedAt || v.endedAt >= v.startedAt);
export const closeFieldEventInputSchema = z.strictObject({
  eventId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  endedAt: closeStoreEventPayloadSchema.shape.endedAt,
});
export const fieldToolRequestSchema = z.discriminatedUnion("tool", [
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("store.event.capture"),
    input: captureFieldEventInputSchema,
  }),
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("store.event.close"),
    input: closeFieldEventInputSchema,
  }),
]);
export function fieldToolIntent(raw: unknown) {
  return JSON.stringify(fieldToolRequestSchema.parse(raw));
}
const base = {
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  status: z.literal("COMPLETED"),
  appliedAt: z.string().datetime(),
  userMessageId: z.string().uuid(),
  message: z.string(),
  before: storeProductEventSchema.nullable(),
  after: storeProductEventSchema,
  commandId: z.string().uuid().nullable(),
  syncState: z.string(),
};
export const captureFieldEventResultSchema = z.strictObject({
  ...base,
  tool: z.literal("store.event.capture"),
});
export const closeFieldEventResultSchema = z.strictObject({
  ...base,
  tool: z.literal("store.event.close"),
});
export const fieldToolResultSchema = z.discriminatedUnion("tool", [
  captureFieldEventResultSchema,
  closeFieldEventResultSchema,
]);
export type FieldToolResult = z.infer<typeof fieldToolResultSchema>;
export const copilotFieldMutationRegistry = [
  {
    name: "store.event.capture",
    inputSchema: captureFieldEventInputSchema,
    outputSchema: captureFieldEventResultSchema,
    description:
      "Enregistrer une observation terrain confirmée : rupture, tension ou qualité. Cela ne met pas à jour un stock chiffré.",
    progress: "Enregistrement de l’observation…",
  },
  {
    name: "store.event.close",
    inputSchema: closeFieldEventInputSchema,
    outputSchema: closeFieldEventResultSchema,
    description:
      "Clôturer une observation USER avec sa version/date exacte. Une extraction commerciale ne devient pas une observation terrain.",
    progress: "Clôture de l’observation…",
  },
].map((t) => ({
  ...t,
  schemaVersion: 1 as const,
  effect: "WRITE" as const,
  runtime: "LOCAL" as const,
  confirmation: "REVIEWED_USER_INTENT" as const,
}));
