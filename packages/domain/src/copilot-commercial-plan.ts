import { z } from "zod";
import { commercialWeekPlanSchema } from "./commercial-week-plan";
import { preparationReadInputSchema } from "./copilot-commercial-preparation";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
export const planPreviewRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.plan.preview"),
  input: preparationReadInputSchema.safeExtend({
    groupOfferReview: z.boolean().optional(),
  }),
});
/** Review metadata, never a persisted offer approval. Older cards omit it. */
export const commercialPlanReviewBasisSchema = z.strictObject({
  offerRefs: z
    .array(
      z.strictObject({
        choiceId: z.uuid(),
        choiceVersion: z.number().int().positive(),
      }),
    )
    .max(100),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  storeSettingsVersion: z.number().int().positive().nullable(),
});
export type CommercialPlanReviewBasis = z.infer<
  typeof commercialPlanReviewBasisSchema
>;
export const planPreviewResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.plan.preview"),
  status: z.literal("COMPLETED"),
  observedAt: z.string().datetime(),
  message: z.string(),
  expectedPlanVersion: z.number().int().positive().nullable(),
  candidate: commercialWeekPlanSchema.nullable(),
  reviewBasis: commercialPlanReviewBasisSchema.optional(),
  issues: z.array(
    z.strictObject({
      code: z.string(),
      messageFr: z.string(),
      choiceId: z.string().uuid().optional(),
      placementId: z.string().uuid().optional(),
    }),
  ),
});
export const planPreviewTool = {
  name: "commercial.plan.preview",
  schemaVersion: 1,
  effect: "READ",
  runtime: "LOCAL",
  confirmation: "NONE",
  description:
    "Préparer un aperçu déterministe du plan hebdomadaire, ou exposer les points bloquants. L’aperçu n’est pas enregistré ni exécuté.",
  progress: "Préparation de l’aperçu commercial…",
  inputSchema: planPreviewRequestSchema.shape.input,
  outputSchema: planPreviewResultSchema,
} as const;
export const planValidateInputSchema = z.strictObject({
  previewOperationId: z.string().uuid(),
});
export const planValidateRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.plan.validate"),
  input: planValidateInputSchema,
});
export const planValidateAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({ canValidateCommercialPlan: z.boolean() });
export type PlanValidateAuthority = z.infer<typeof planValidateAuthoritySchema>;
export function planValidateIntent(raw: unknown) {
  return JSON.stringify(planValidateRequestSchema.parse(raw));
}
export const planValidateResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.plan.validate"),
  status: z.literal("COMPLETED"),
  userMessageId: z.string().uuid(),
  appliedAt: z.string().datetime(),
  previewOperationId: z.string().uuid(),
  before: commercialWeekPlanSchema.nullable(),
  after: commercialWeekPlanSchema,
  commandId: z.string().uuid(),
  syncState: z.literal("PENDING"),
  message: z.string(),
});
export const copilotPlanMutationRegistry = [
  {
    name: "commercial.plan.validate",
    schemaVersion: 1,
    effect: "WRITE",
    runtime: "LOCAL",
    confirmation: "REVIEWED_USER_INTENT",
    description:
      "Enregistrer l’aperçu commercial explicitement accepté dans cette conversation, après revalidation des données. N’enregistre pas une exécution en rayon.",
    progress: "Validation du plan commercial…",
    inputSchema: planValidateInputSchema,
    outputSchema: planValidateResultSchema,
  },
] as const;
