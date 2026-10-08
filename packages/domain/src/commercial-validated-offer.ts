import { z } from "zod";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import {
  commercialVisualFieldSchema,
  commercialVisualEvidenceSchema,
} from "./commercial-visual-reading";
/** Immutable validation of one selected choice revision; execution is separate. */
export const commercialValidatedOfferSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    choice: commercialOfferChoiceSchema,
    status: z.literal("VALIDATED"),
    sourceFields: z.array(commercialVisualFieldSchema).max(60),
    evidence: z.array(commercialVisualEvidenceSchema).min(1).max(16),
    sourceReviewed: z.literal(true),
    version: z.literal(1),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (v) => v.choice.storeId === v.storeId && v.choice.status === "RETAINED",
    "La validation doit concerner une offre retenue dans ce magasin.",
  );
export type CommercialValidatedOffer = z.infer<
  typeof commercialValidatedOfferSchema
>;
