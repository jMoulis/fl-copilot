import {
  copilotVisualKinds,
  copilotVisualMetadataSchemas,
  isCopilotVisualKind,
} from "./copilot-visual-library";
import { storeLayoutSchema } from "./store-layout";
import {
  catalogueConflictKinds,
  isCatalogueConflictKind,
} from "./product-master-conflict";
import {
  productSchema,
  productAliasSchema,
  productIdentifierSchema,
} from "./products";
import { commercialVersionDecisionSchema } from "./commercial-version-decision";
import { commercialExecutionTaskSchema } from "./commercial-execution-task";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { commercialWeekPreparationSchema } from "./commercial-week-preparation";
import { commercialWeekPlanSchema } from "./commercial-week-plan";
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
export const storeConflictV2InputSchema = z
  .strictObject({
    kind: z.enum(["FIELD_EVENT", "SETTINGS", ...needConflictKinds]),
    entityId: z.uuid().nullable(),
  })
  .refine((v) =>
    v.kind === "SETTINGS" ? v.entityId === null : v.entityId !== null,
  );
export const commercialConflictV3Kinds = [
  "COMMERCIAL_CHOICE",
  "COMMERCIAL_PREPARATION",
  "COMMERCIAL_PLAN",
] as const;
export const commercialDecisionConflictKinds = [
  "COMMERCIAL_REFERENCE",
  "COMMERCIAL_EXECUTION",
] as const;
export const commercialConflictKinds = [
  ...commercialConflictV3Kinds,
  ...commercialDecisionConflictKinds,
] as const;
export function isCommercialDecisionConflictKind(kind: string) {
  return (commercialDecisionConflictKinds as readonly string[]).includes(kind);
}
export function isCommercialConflictKind(kind: string) {
  return (commercialConflictKinds as readonly string[]).includes(kind);
}
export function storeConflictArtifactVersion(kind: string) {
  return isCopilotVisualKind(kind)
    ? 7
    : kind === "STORE_LAYOUT"
      ? 6
      : isCatalogueConflictKind(kind)
        ? 5
        : isCommercialDecisionConflictKind(kind)
          ? 4
          : isCommercialConflictKind(kind)
            ? 3
            : isNeedConflictKind(kind)
              ? 2
              : 1;
}
export const storeConflictV3InputSchema = z
  .strictObject({
    kind: z.enum([
      "FIELD_EVENT",
      "SETTINGS",
      ...needConflictKinds,
      ...commercialConflictV3Kinds,
    ]),
    entityId: z.uuid().nullable(),
  })
  .refine((v) =>
    v.kind === "SETTINGS" ? v.entityId === null : v.entityId !== null,
  );
export const storeConflictV4InputSchema = z
  .strictObject({
    kind: z.enum([
      "FIELD_EVENT",
      "SETTINGS",
      ...needConflictKinds,
      ...commercialConflictKinds,
    ]),
    entityId: z.uuid().nullable(),
  })
  .refine((v) =>
    v.kind === "SETTINGS" ? v.entityId === null : v.entityId !== null,
  );
export const storeConflictV5InputSchema = z
  .strictObject({
    kind: z.enum([
      "FIELD_EVENT",
      "SETTINGS",
      ...needConflictKinds,
      ...commercialConflictKinds,
      ...catalogueConflictKinds,
    ]),
    entityId: z.uuid().nullable(),
  })
  .refine((v) =>
    v.kind === "SETTINGS" ? v.entityId === null : v.entityId !== null,
  );
export const storeConflictV6InputSchema = z
  .strictObject({
    kind: z.enum([
      ...storeConflictV5InputSchema.shape.kind.options,
      "STORE_LAYOUT",
    ]),
    entityId: z.uuid().nullable(),
  })
  .refine((v) =>
    ["SETTINGS", "STORE_LAYOUT"].includes(v.kind)
      ? v.entityId === null
      : v.entityId !== null,
  );
export const storeConflictInputSchema = z
  .strictObject({
    kind: z.enum([
      ...storeConflictV6InputSchema.shape.kind.options,
      ...copilotVisualKinds,
    ]),
    entityId: z.uuid().nullable(),
  })
  .refine((v) =>
    ["SETTINGS", "STORE_LAYOUT"].includes(v.kind)
      ? v.entityId === null
      : v.entityId !== null,
  );
// A plan comparison's model-facing basis is metadata only. Its fingerprint
// still binds the complete canonical plan, reviewed on the device.
export const storeConflictLayoutBasisSchema = z.strictObject({
  id: z.uuid(),
  storeId: z.uuid(),
  version: z.number().int().positive(),
  revisionId: z.uuid(),
  referenceRevisionId: z.uuid().nullable(),
  action: storeLayoutSchema.shape.action,
});
export function storeConflictLayoutBasis(raw: unknown) {
  const p = storeLayoutSchema.parse(raw);
  return storeConflictLayoutBasisSchema.parse({
    id: p.id,
    storeId: p.storeId,
    version: p.version,
    revisionId: p.revisionId,
    referenceRevisionId: p.referenceRevisionId,
    action: p.action,
  });
}
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
  choice: commercialOfferChoiceSchema.optional(),
  preparation: commercialWeekPreparationSchema.optional(),
  plan: commercialWeekPlanSchema.optional(),
  reference: commercialVersionDecisionSchema.optional(),
  execution: commercialExecutionTaskSchema.optional(),
  product: productSchema.optional(),
  identifier: productIdentifierSchema.optional(),
  alias: productAliasSchema.optional(),
  layout: storeConflictLayoutBasisSchema.optional(),
  visualAsset: copilotVisualMetadataSchemas.VISUAL_ASSET.optional(),
  visualIdentity: copilotVisualMetadataSchemas.VISUAL_IDENTITY.optional(),
  productVisualLink:
    copilotVisualMetadataSchemas.PRODUCT_VISUAL_LINK.optional(),
});
export function validateStoreConflictBasis(
  storeId: string,
  rawInput: unknown,
  rawBasis: unknown,
) {
  const input = storeConflictInputSchema.parse(rawInput),
    basis = storeConflictBasisSchema.parse(rawBasis);
  const fields = {
    FIELD_EVENT: "event",
    SETTINGS: "settings",
    NEED: "need",
    MEMBERSHIP: "membership",
    SUBSTITUTION: "substitution",
    COMMERCIAL_CHOICE: "choice",
    COMMERCIAL_PREPARATION: "preparation",
    COMMERCIAL_PLAN: "plan",
    COMMERCIAL_REFERENCE: "reference",
    COMMERCIAL_EXECUTION: "execution",
    PRODUCT: "product",
    IDENTIFIER: "identifier",
    ALIAS: "alias",
    STORE_LAYOUT: "layout",
    VISUAL_ASSET: "visualAsset",
    VISUAL_IDENTITY: "visualIdentity",
    PRODUCT_VISUAL_LINK: "productVisualLink",
  } as const;
  const entity = basis[fields[input.kind]],
    present = Object.values(fields)
      .map((field) => basis[field])
      .filter(Boolean);
  if (
    basis.storeId !== storeId ||
    !entity ||
    present.length !== 1 ||
    entity.storeId !== storeId ||
    entity.id !== basis.entityId ||
    entity.version !== basis.remoteVersion ||
    (["SETTINGS", "STORE_LAYOUT"].includes(input.kind)
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
  schemaVersion: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
  ]),
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
    content.schemaVersion !== storeConflictArtifactVersion(content.input.kind)
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
  retainWithdrawn: z.boolean().optional(),
  activateProduct: z.boolean().optional(),
  acceptRemoteDeletion: z.boolean().optional(),
  confirmLocalDeletionChoice: z.boolean().optional(),
  confirmVisualRights: z.boolean().optional(),
});
export const storeConflictAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({
    canCaptureStoreEvents: z.boolean(),
    canManageStoreSettings: z.boolean(),
    canManageStoreLayout: z.boolean().default(false),
    canManageVisualLibrary: z.boolean().default(false),
    comparisonReviewed: z.boolean(),
    canManageProducts: z.boolean().default(false),
    canManageCommercialChoices: z.boolean().default(false),
    canPrepareCommercialWeek: z.boolean().default(false),
    canValidateCommercialPlan: z.boolean().default(false),
    canManageCommercialReferences: z.boolean().default(false),
    canDeclareCommercialExecution: z.boolean().default(false),
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
