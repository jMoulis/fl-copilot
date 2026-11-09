import { z } from "zod";
import { commercialWeekPreparationSchema } from "./commercial-week-preparation";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
const {
  weekStart,
  weekEnd,
  status,
  tgCapacity,
  offerRefs,
  placements,
  note,
  physicalAllocation,
} = commercialWeekPreparationSchema.shape;
const draft = z.strictObject({
  weekStart,
  weekEnd,
  status,
  tgCapacity,
  offerRefs,
  placements,
  note,
  physicalAllocation,
});
export const preparationInputSchema = z.strictObject({
  expectedVersion: z.number().int().positive().nullable(),
  draft,
});
export const preparationRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.preparation.save"),
  input: preparationInputSchema,
});
export const preparationAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({ canPrepareCommercialWeek: z.boolean() });
export type PreparationAuthority = z.infer<typeof preparationAuthoritySchema>;
export function preparationIntent(raw: unknown) {
  return JSON.stringify(preparationRequestSchema.parse(raw));
}
export const preparationSurfaceEditsSchema = z
  .array(
    z.strictObject({
      placementId: z.uuid(),
      shares: z.array(z.number().int().min(1).max(100)).min(1).max(6),
    }),
  )
  .max(30)
  .refine((v) => new Set(v.map((x) => x.placementId)).size === v.length);
/** Native review may adjust proportions only; source cards and other business fields stay immutable. */
export function reviewPreparationSurfaceShares(raw: unknown, edits: unknown) {
  const request = preparationRequestSchema.parse(raw);
  const adjustments = preparationSurfaceEditsSchema.parse(edits);
  for (const edit of adjustments) {
    const placement = request.input.draft.placements.find(
      (p) => p.id === edit.placementId,
    );
    if (
      !placement?.presentation ||
      placement.presentation.zones.length !== edit.shares.length
    )
      throw Error("TG_PRESENTATION_REVIEW_INVALID");
    placement.presentation.zones.forEach(
      (z, i) => (z.sharePct = edit.shares[i]!),
    );
  }
  return preparationRequestSchema.parse(request);
}
export function readReviewedPreparationRequest(
  original: unknown,
  stored: unknown,
) {
  const request = preparationRequestSchema.parse(stored);
  const edits = request.input.draft.placements
    .filter((p) => p.presentation)
    .map((p) => ({
      placementId: p.id,
      shares: p.presentation!.zones.map((z) => z.sharePct),
    }));
  const expected = reviewPreparationSurfaceShares(original, edits);
  if (preparationIntent(expected) !== preparationIntent(request))
    throw Error("TG_PRESENTATION_REVIEW_INVALID");
  return request;
}
export const preparationResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.preparation.save"),
  status: z.literal("COMPLETED"),
  userMessageId: z.string().uuid(),
  appliedAt: z.string().datetime(),
  before: commercialWeekPreparationSchema.nullable(),
  after: commercialWeekPreparationSchema,
  commandId: z.string().uuid(),
  syncState: z.literal("PENDING"),
  message: z.string(),
});
export const copilotPreparationMutationRegistry = [
  {
    name: "commercial.preparation.save",
    schemaVersion: 1,
    effect: "WRITE",
    runtime: "LOCAL",
    confirmation: "REVIEWED_USER_INTENT",
    description:
      "Enregistrer un brouillon hebdomadaire complet validé, sans publier ni exécuter les offres.",
    progress: "Enregistrement du brouillon commercial…",
    inputSchema: preparationInputSchema,
    outputSchema: preparationResultSchema,
  },
] as const;

export const preparationReadInputSchema = z
  .strictObject({ weekStart: commercialWeekPreparationSchema.shape.weekStart })
  .refine((v) => new Date(v.weekStart + "T00:00:00Z").getUTCDay() === 1);
export const preparationReadRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.preparation.inspect"),
  input: preparationReadInputSchema,
});
export const preparationReadResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.preparation.inspect"),
  status: z.literal("COMPLETED"),
  observedAt: z.string().datetime(),
  message: z.string(),
  snapshot: z
    .strictObject({
      entity: commercialWeekPreparationSchema,
      syncState: z.string(),
      remoteVersion: z.number().int().positive().nullable(),
    })
    .nullable(),
});
export const preparationReadTool = {
  name: "commercial.preparation.inspect",
  schemaVersion: 1,
  effect: "READ",
  runtime: "LOCAL",
  confirmation: "NONE",
  description:
    "Consulter le brouillon d’une semaine explicite avec sa version et son état de synchronisation.",
  progress: "Lecture du brouillon commercial…",
  inputSchema: preparationReadInputSchema,
  outputSchema: preparationReadResultSchema,
} as const;
