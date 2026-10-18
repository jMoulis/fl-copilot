import { z } from "zod";
import { isPublicResearchUrl } from "./copilot-web-research";
export const retailExpertiseTopicSchema = z.enum([
  "SHOPPER_CHOICE",
  "SHOPPING_NEEDS",
  "ASSOCIATIONS",
  "SUBSTITUTION",
  "VISIBILITY",
  "SEASONALITY",
  "WASTE_DIAGNOSIS",
]);
export const retailExpertiseInputSchema = z
  .strictObject({
    topics: z.array(retailExpertiseTopicSchema).min(1).max(2),
  })
  .refine((v) => new Set(v.topics).size === v.topics.length);
const publicationDate = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])(?:-\d{2})?$/)
  .refine((v) => z.iso.date().safeParse(v.length === 7 ? `${v}-01` : v).success)
  .nullable();
export const retailExpertiseSourceSchema = z.strictObject({
  title: z.string().min(1).max(160),
  publisher: z.string().min(1).max(80),
  url: z.string().max(600).refine(isPublicResearchUrl),
  publishedOn: publicationDate,
  scope: z.string().min(1).max(500),
});
export const retailExpertiseCitationSchema = z
  .strictObject({
    kind: z.literal("RETAIL_EXPERTISE"),
    referenceId: z.string().regex(/^[a-z][a-z-]{1,70}$/),
    version: z.number().int().positive(),
    reviewedOn: z.iso.date(),
    reviewAfterOn: z.iso.date(),
    sources: z.array(retailExpertiseSourceSchema).min(1).max(2),
  })
  .refine(
    (v) =>
      v.reviewedOn < v.reviewAfterOn &&
      v.sources.every((s) => !s.publishedOn || s.publishedOn <= v.reviewedOn),
  );
export const retailExpertiseCardSchema = z.strictObject({
  topic: retailExpertiseTopicSchema,
  title: z.string().min(1).max(160),
  citation: retailExpertiseCitationSchema,
  sourceFinding: z.string().min(1).max(650),
  // Application-authored investigation guidance, explicitly not a finding of the cited study.
  applicationHypothesis: z.string().min(1).max(500),
  discriminatingQuestions: z.array(z.string().min(1).max(240)).min(1).max(3),
  checks: z
    .array(
      z.enum([
        "ANALYTICS",
        "PRODUCT",
        "STORE_EVENTS",
        "SUBSTITUTIONS",
        "COMMERCIAL_DOCUMENTS",
        "EXECUTION",
        "STORE_CONTEXT",
        "FIELD_OBSERVATION",
      ]),
    )
    .min(1)
    .max(5),
  limits: z.array(z.string().min(1).max(300)).min(1).max(4),
  measurement: z.string().min(1).max(400),
});
export type RetailExpertiseCard = z.infer<typeof retailExpertiseCardSchema>;
export function retailExpertiseFreshness(
  raw: unknown,
  asOf: string,
): "CURRENT" | "NOT_YET_REVIEWED" | "REVALIDATION_REQUIRED" {
  const citation = retailExpertiseCitationSchema.parse(raw);
  const day = z.iso.datetime().parse(asOf).slice(0, 10);
  return day < citation.reviewedOn
    ? "NOT_YET_REVIEWED"
    : day >= citation.reviewAfterOn
      ? "REVALIDATION_REQUIRED"
      : "CURRENT";
}
