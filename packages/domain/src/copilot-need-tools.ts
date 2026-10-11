import { z } from "zod";
import { needUnitSchema } from "./need-unit";
import { needMembershipSchema } from "./need-membership";
import { productSubstitutionSchema } from "./product-substitution";
const id = z.string().uuid(),
  version = z.number().int().positive(),
  level = z.number().finite().min(0).max(1);
export const needSaveInputSchema = z
  .strictObject({
    mode: z.enum(["CREATE", "UPDATE"]),
    needUnitId: id.nullable(),
    expectedVersion: version.nullable(),
    code: needUnitSchema.shape.code,
    name: needUnitSchema.shape.name,
    description: needUnitSchema.shape.description,
    status: needUnitSchema.shape.status,
  })
  .refine((v) =>
    v.mode === "CREATE"
      ? v.needUnitId === null && v.expectedVersion === null
      : v.needUnitId !== null && v.expectedVersion !== null,
  );
const association = {
  productId: id,
  productVersion: version,
  needUnitId: id,
  needVersion: version,
  expectedVersion: version.nullable(),
  decision: z.enum(["VALIDATED", "REJECTED"]),
  allowReactivateRejected: z.boolean().default(false),
};
export const membershipSaveInputSchema = z
  .strictObject({
    ...association,
    strength: level,
    primary: z.boolean(),
    declaredConfidence: level.nullable(),
  })
  .refine((v) => v.expectedVersion !== null || v.declaredConfidence !== null);
export const substitutionSaveInputSchema = z
  .strictObject({
    ...association,
    substituteProductId: id,
    substituteProductVersion: version,
    needCompatibility: level,
    usageCompatibility: level,
    priceCompatibility: level.nullable(),
    packagingCompatibility: level.nullable(),
  })
  .refine((v) => v.productId !== v.substituteProductId);
export const needToolRequestSchema = z.discriminatedUnion("tool", [
  z.strictObject({
    operationId: id,
    schemaVersion: z.literal(1),
    tool: z.literal("need.save"),
    input: needSaveInputSchema,
  }),
  z.strictObject({
    operationId: id,
    schemaVersion: z.literal(1),
    tool: z.literal("need.membership"),
    input: membershipSaveInputSchema,
  }),
  z.strictObject({
    operationId: id,
    schemaVersion: z.literal(1),
    tool: z.literal("substitution.save"),
    input: substitutionSaveInputSchema,
  }),
]);
export function needToolIntent(raw: unknown) {
  return JSON.stringify(needToolRequestSchema.parse(raw));
}
const base = {
  operationId: id,
  schemaVersion: z.literal(1),
  status: z.literal("COMPLETED"),
  appliedAt: z.string().datetime(),
  userMessageId: id,
  message: z.string(),
  commandId: id,
  syncState: z.literal("PENDING"),
};
export const needSaveResultSchema = z.strictObject({
  ...base,
  tool: z.literal("need.save"),
  before: needUnitSchema.nullable(),
  after: needUnitSchema,
});
export const membershipSaveResultSchema = z.strictObject({
  ...base,
  tool: z.literal("need.membership"),
  before: needMembershipSchema.nullable(),
  after: needMembershipSchema,
});
export const substitutionSaveResultSchema = z.strictObject({
  ...base,
  tool: z.literal("substitution.save"),
  before: productSubstitutionSchema.nullable(),
  after: productSubstitutionSchema,
});
export const needToolResultSchema = z.discriminatedUnion("tool", [
  needSaveResultSchema,
  membershipSaveResultSchema,
  substitutionSaveResultSchema,
]);
export type NeedToolResult = z.infer<typeof needToolResultSchema>;
export const copilotNeedMutationRegistry = [
  {
    name: "need.save",
    inputSchema: needSaveInputSchema,
    outputSchema: needSaveResultSchema,
    description:
      "Créer ou modifier un besoin client, ou le désactiver par statut. Un besoin n’est pas une quantité à commander.",
    progress: "Enregistrement du besoin…",
  },
  {
    name: "need.membership",
    inputSchema: membershipSaveInputSchema,
    outputSchema: membershipSaveResultSchema,
    description:
      "Enregistrer une association produit/besoin avec validation ou refus explicite, sans effacer une décision précédente.",
    progress: "Enregistrement de l’association…",
  },
  {
    name: "substitution.save",
    inputSchema: substitutionSaveInputSchema,
    outputSchema: substitutionSaveResultSchema,
    description:
      "Valider ou refuser une relation dirigée de substitution et ses compatibilités déclarées. Aucun score appris ne peut être écrit.",
    progress: "Enregistrement de la relation…",
  },
].map((t) => ({
  ...t,
  schemaVersion: 1 as const,
  effect: "WRITE" as const,
  runtime: "LOCAL" as const,
  confirmation: "REVIEWED_USER_INTENT" as const,
}));

export const needListInputSchema = z.strictObject({
  afterId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(25).default(25),
});
export const needListRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("need.list"),
  input: needListInputSchema,
});
export const needListResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("need.list"),
  status: z.literal("COMPLETED"),
  message: z.string(),
  observedAt: z.string().datetime(),
  needs: z
    .array(z.strictObject({ entity: needUnitSchema, syncState: z.string() }))
    .max(25),
  hasMore: z.boolean(),
  nextAfterId: z.string().uuid().nullable(),
});
export const needListTool = {
  name: "need.list",
  schemaVersion: 1 as const,
  effect: "READ" as const,
  runtime: "LOCAL" as const,
  confirmation: "NONE" as const,
  inputSchema: needListInputSchema,
  outputSchema: needListResultSchema,
  description:
    "Consulter les besoins clients, leurs codes, versions, statuts et état de synchronisation, y compris ceux désactivés.",
  progress: "Lecture des besoins…",
};
