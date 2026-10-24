import { z } from "zod";
import { commercialValidatedOfferSchema } from "./commercial-validated-offer";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
import {
  commercialOriginalOfferSourceSchema,
  isCommercialOriginalSource,
  type CommercialOfferChoice,
} from "./commercial-offer-choice";
const selection = z
  .array(
    z.strictObject({
      choiceId: z.string().uuid(),
      choiceVersion: z.number().int().positive(),
      productVersion: z.number().int().positive(),
    }),
  )
  .min(1)
  .max(25)
  .refine((v) => new Set(v.map((r) => r.choiceId)).size === v.length);
export const offerValidationInputSchema = z.strictObject({ selection });
export const offerValidationRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.offer.validate"),
  input: offerValidationInputSchema,
});
export const offerValidationAuthoritySchema =
  productClassificationAuthoritySchema
    .omit({ canManageProducts: true })
    .extend({
      canValidateCommercialOffers: z.boolean(),
      reviewedSources: z
        .array(
          z.union([
            z.strictObject({
              choiceId: z.string().uuid(),
              choiceVersion: z.number().int().positive(),
              readingId: z.string().uuid(),
              checksum: z.string().min(1).max(256),
            }),
            z.strictObject({
              choiceId: z.uuid(),
              choiceVersion: z.number().int().positive(),
              source: commercialOriginalOfferSourceSchema,
            }),
          ]),
        )
        .min(1)
        .max(25),
    });
export type OfferValidationAuthority = z.infer<
  typeof offerValidationAuthoritySchema
>;
export function offerValidationSourceReviewed(
  choice: CommercialOfferChoice,
  review: OfferValidationAuthority["reviewedSources"][number],
) {
  if (review.choiceId !== choice.id || review.choiceVersion !== choice.version)
    return false;
  return isCommercialOriginalSource(choice.source)
    ? "source" in review &&
        JSON.stringify(review.source) === JSON.stringify(choice.source)
    : "readingId" in review &&
        review.readingId === choice.source.readingId &&
        review.checksum === choice.source.checksum;
}
export function offerValidationIntent(raw: unknown) {
  return JSON.stringify(offerValidationRequestSchema.parse(raw));
}
export const offerValidationResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.offer.validate"),
  status: z.literal("COMPLETED"),
  userMessageId: z.string().uuid(),
  appliedAt: z.string().datetime(),
  validations: z
    .array(
      z.strictObject({
        entity: commercialValidatedOfferSchema,
        commandId: z.string().uuid().nullable(),
        syncState: z.string(),
      }),
    )
    .min(1)
    .max(25),
  message: z.string(),
});
export const copilotOfferValidationRegistry = [
  {
    name: "commercial.offer.validate",
    schemaVersion: 1,
    effect: "WRITE",
    runtime: "LOCAL",
    confirmation: "REVIEWED_USER_INTENT",
    description:
      "Valider au plus 25 versions exactes d’offres retenues après revue explicite de leur source. La validation est immuable et distincte du plan et de son exécution.",
    progress: "Validation des offres commerciales…",
    inputSchema: offerValidationInputSchema,
    outputSchema: offerValidationResultSchema,
  },
] as const;
