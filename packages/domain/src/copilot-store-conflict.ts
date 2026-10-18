import { z } from "zod";
import { storeProductEventSchema } from "./store-product-event";
import { copilotVisibleStoreSettingsSchema } from "./copilot-store-settings-read";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { copilotMessageSchema } from "./copilot-conversation";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
export const storeConflictInputSchema = z
  .strictObject({
    kind: z.enum(["FIELD_EVENT", "SETTINGS"]),
    entityId: z.uuid().nullable(),
  })
  .refine((v) =>
    v.kind === "SETTINGS" ? v.entityId === null : v.entityId !== null,
  );
export const storeConflictBasisSchema = z.strictObject({
  storeId: z.uuid(),
  entityId: z.uuid(),
  remoteVersion: z.number().int().positive(),
  remoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  event: storeProductEventSchema.nullable(),
  settings: copilotVisibleStoreSettingsSchema.nullable(),
});
export function validateStoreConflictBasis(
  storeId: string,
  rawInput: unknown,
  rawBasis: unknown,
) {
  const input = storeConflictInputSchema.parse(rawInput),
    basis = storeConflictBasisSchema.parse(rawBasis);
  const entity = input.kind === "FIELD_EVENT" ? basis.event : basis.settings;
  if (
    basis.storeId !== storeId ||
    !entity ||
    entity.storeId !== storeId ||
    entity.id !== basis.entityId ||
    entity.version !== basis.remoteVersion ||
    (input.kind === "FIELD_EVENT"
      ? basis.settings !== null || input.entityId !== entity.id
      : basis.event !== null || entity.id !== storeId)
  )
    throw Error("STORE_CONFLICT_SCOPE_INVALID");
  return { input, basis };
}
export const storeConflictPreviewSchema = z.strictObject({
  input: storeConflictInputSchema,
  basis: storeConflictBasisSchema,
  evidence: z.array(copilotEvidenceSchema).length(1),
});
export const storeConflictProposalSchema = z.strictObject({
  kind: z.literal("STORE_CONFLICT_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: storeConflictInputSchema,
  basis: storeConflictBasisSchema,
});
export function readStoreConflictProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("STORE_CONFLICT_PROPOSAL_INVALID");
  const content = storeConflictProposalSchema.parse(JSON.parse(message.text));
  validateStoreConflictBasis(message.storeId, content.input, content.basis);
  return { message, content };
}
export const storeConflictDecisionSchema = z.enum([
  "KEEP_LOCAL",
  "ADOPT_REMOTE",
]);
export const storeConflictRequestSchema = z.strictObject({
  operationId: z.uuid(),
  conflictId: z.uuid(),
  entityId: z.uuid(),
  kind: storeConflictInputSchema.shape.kind,
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: storeConflictDecisionSchema,
});
export const storeConflictAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({
    canCaptureStoreEvents: z.boolean(),
    canManageStoreSettings: z.boolean(),
    comparisonReviewed: z.boolean(),
  });
export type StoreConflictAuthority = z.infer<
  typeof storeConflictAuthoritySchema
>;
export const storeConflictResultSchema = storeConflictRequestSchema.extend({
  userMessageId: z.uuid(),
  appliedAt: z.iso.datetime(),
  commandId: z.uuid(),
  beforeVersion: z.number().int().positive(),
  afterVersion: z.number().int().positive(),
  syncState: z.enum(["PENDING", "SYNCED"]),
});
