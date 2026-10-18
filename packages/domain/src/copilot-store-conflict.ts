import { needUnitSchema } from "./need-unit";
import { needMembershipSchema } from "./need-membership";
import { productSubstitutionSchema } from "./product-substitution";
import { z } from "zod";
import { storeProductEventSchema } from "./store-product-event";
import { copilotVisibleStoreSettingsSchema } from "./copilot-store-settings-read";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { copilotMessageSchema } from "./copilot-conversation";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
export const storeConflictLegacyInputSchema = z
  .strictObject({
    kind: z.enum(["FIELD_EVENT", "SETTINGS"]),
    entityId: z.uuid().nullable(),
  })
  .refine((v) =>
    v.kind === "SETTINGS" ? v.entityId === null : v.entityId !== null,
  );
export const needConflictKinds = [
  "NEED",
  "MEMBERSHIP",
  "SUBSTITUTION",
] as const;
export function isNeedConflictKind(kind: string) {
  return (needConflictKinds as readonly string[]).includes(kind);
}
export const storeConflictInputSchema = z
  .strictObject({
    kind: z.enum(["FIELD_EVENT", "SETTINGS", ...needConflictKinds]),
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
  need: needUnitSchema.optional(),
  membership: needMembershipSchema.optional(),
  substitution: productSubstitutionSchema.optional(),
});
export function validateStoreConflictBasis(
  storeId: string,
  rawInput: unknown,
  rawBasis: unknown,
) {
  const input = storeConflictInputSchema.parse(rawInput),
    basis = storeConflictBasisSchema.parse(rawBasis);
  const entity =
    input.kind === "FIELD_EVENT"
      ? basis.event
      : input.kind === "SETTINGS"
        ? basis.settings
        : input.kind === "NEED"
          ? basis.need
          : input.kind === "MEMBERSHIP"
            ? basis.membership
            : basis.substitution;
  const present = [
    basis.event,
    basis.settings,
    basis.need,
    basis.membership,
    basis.substitution,
  ].filter(Boolean);
  if (
    basis.storeId !== storeId ||
    !entity ||
    present.length !== 1 ||
    entity.storeId !== storeId ||
    entity.id !== basis.entityId ||
    entity.version !== basis.remoteVersion ||
    (input.kind === "SETTINGS"
      ? entity.id !== storeId
      : input.entityId !== entity.id)
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
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
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
  if (
    content.schemaVersion !== (isNeedConflictKind(content.input.kind) ? 2 : 1)
  )
    throw Error("STORE_CONFLICT_PROPOSAL_VERSION");
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
  reactivateRejected: z.boolean().optional(),
});
export const storeConflictAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({
    canCaptureStoreEvents: z.boolean(),
    canManageStoreSettings: z.boolean(),
    comparisonReviewed: z.boolean(),
    canManageProducts: z.boolean().default(false),
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
