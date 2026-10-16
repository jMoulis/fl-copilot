import { z } from "zod";
import { productSchema } from "./products";
import { storeProductEventSchema } from "./store-product-event";
import { copilotVisibleStoreSettingsSchema } from "./copilot-store-settings-read";
import {
  settingsSaveInputSchema,
  settingsSaveRequestSchema,
} from "./copilot-store-settings";
import {
  fieldToolRequestSchema,
  captureFieldEventInputSchema,
} from "./copilot-field-tools";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
const observedInstant = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Number.isFinite(Date.parse(v)));
const action = z.enum(["INSPECT", "PREPARE"]);
export const copilotOperationsInputSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("FIELD_CAPTURE"),
      action: z.literal("PREPARE"),
      productId: z.uuid(),
      patch: z.strictObject({
        type: captureFieldEventInputSchema.shape.type.optional(),
        startedAt: observedInstant.optional(),
        endedAt: observedInstant.nullable().optional(),
        severity: captureFieldEventInputSchema.shape.severity.optional(),
        comment: captureFieldEventInputSchema.shape.comment.optional(),
      }),
    }),
    z.strictObject({
      kind: z.literal("FIELD_CLOSE"),
      action,
      eventId: z.uuid(),
      patch: z.strictObject({ endedAt: observedInstant.optional() }),
    }),
    z.strictObject({
      kind: z.literal("SETTINGS"),
      action,
      patch: z.strictObject({
        city: settingsSaveInputSchema.shape.city.optional(),
        postalCode: settingsSaveInputSchema.shape.postalCode.optional(),
        schoolZone: settingsSaveInputSchema.shape.schoolZone.optional(),
        location: settingsSaveInputSchema.shape.location.optional(),
      }),
    }),
  ])
  .superRefine((v, c) => {
    if (
      v.action === "INSPECT"
        ? Object.keys(v.patch).length > 0
        : Object.keys(v.patch).length === 0
    )
      c.addIssue({ code: "custom", message: "Invalid operations action" });
  });
export type OperationsInput = z.infer<typeof copilotOperationsInputSchema>;
/** No device point, GPS capture time or GPS-derived fingerprint. */
export const operationsBasisSchema = z.strictObject({
  product: productSchema.nullable(),
  event: storeProductEventSchema.nullable(),
  settings: copilotVisibleStoreSettingsSchema.nullable(),
});
export type OperationsBasis = z.infer<typeof operationsBasisSchema>;
export function validateOperationsBasis(
  storeId: string,
  input: OperationsInput,
  raw: unknown,
) {
  const b = operationsBasisSchema.parse(raw);
  if (
    [b.product, b.event, b.settings].some((e) => e && e.storeId !== storeId) ||
    (input.kind === "SETTINGS" &&
      (b.product || b.event || (b.settings && b.settings.id !== storeId))) ||
    (input.kind !== "SETTINGS" && (b.settings || !b.product)) ||
    (input.kind === "FIELD_CAPTURE" &&
      (b.event || b.product?.id !== input.productId)) ||
    (input.kind === "FIELD_CLOSE" &&
      (!b.event ||
        b.event.id !== input.eventId ||
        b.product?.id !== b.event.productId))
  )
    throw Error("OPERATIONS_PROPOSAL_SCOPE");
  return b;
}
export function prepareOperationsRequest(
  input: OperationsInput,
  b: OperationsBasis,
  operationId: string,
) {
  if (input.action !== "PREPARE") throw Error("OPERATIONS_READ_ONLY");
  const base = { operationId, schemaVersion: 1 };
  if (input.kind === "SETTINGS")
    return settingsSaveRequestSchema.parse({
      ...base,
      tool: "store.settings.save",
      input: {
        expectedVersion: b.settings?.version ?? null,
        city: b.settings?.city,
        postalCode: b.settings?.postalCode,
        schoolZone: b.settings?.schoolZone ?? null,
        location: "KEEP",
        ...input.patch,
      },
    });
  if (input.kind === "FIELD_CAPTURE")
    return fieldToolRequestSchema.parse({
      ...base,
      tool: "store.event.capture",
      input: {
        productId: input.productId,
        productVersion: b.product?.version,
        endedAt: null,
        severity: null,
        comment: null,
        ...input.patch,
      },
    });
  return fieldToolRequestSchema.parse({
    ...base,
    tool: "store.event.close",
    input: {
      eventId: input.eventId,
      expectedVersion: b.event?.version,
      ...input.patch,
    },
  });
}
export function operationsUnchanged(
  input: OperationsInput,
  b: OperationsBasis,
) {
  if (input.kind === "FIELD_CAPTURE") return false;
  if (input.kind === "FIELD_CLOSE") {
    const request = prepareOperationsRequest(
      input,
      b,
      "00000000-0000-4000-8000-000000000001",
    );
    return (
      request.tool === "store.event.close" &&
      b.event?.status === "CLOSED" &&
      b.event.endedAt === request.input.endedAt
    );
  }
  if (!b.settings) return false;
  const request = prepareOperationsRequest(
    input,
    b,
    "00000000-0000-4000-8000-000000000001",
  );
  if (request.tool !== "store.settings.save") return false;
  return (
    request.input.city === b.settings.city &&
    request.input.postalCode === b.settings.postalCode &&
    request.input.schoolZone === b.settings.schoolZone &&
    (request.input.location === "KEEP" || b.settings.locationMode === "CITY")
  );
}
export const copilotOperationsPreviewSchema = z.strictObject({
  input: copilotOperationsInputSchema,
  status: z.enum([
    "READY",
    "INSPECTED",
    "UNCHANGED",
    "UNAVAILABLE",
    "NEEDS_INFORMATION",
    "BLOCKED",
  ]),
  basis: operationsBasisSchema,
  missingFields: z.array(z.string().max(80)).max(10),
  evidence: z.array(copilotEvidenceSchema).min(1).max(2),
});
export const copilotOperationsProposalSchema = z.strictObject({
  kind: z.literal("STORE_OPERATIONS_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotOperationsInputSchema,
  basis: operationsBasisSchema,
});
export function readCopilotOperationsProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("OPERATIONS_PROPOSAL_INVALID");
  const content = copilotOperationsProposalSchema.parse(
    JSON.parse(message.text),
  );
  validateOperationsBasis(message.storeId, content.input, content.basis);
  const request = prepareOperationsRequest(
    content.input,
    content.basis,
    message.id,
  );
  return { message, content, request };
}
