import { z } from "zod";
import { layoutIllustrationPreparationSchema } from "./layout-illustration";
const id = z.uuid(),
  money = z.number().int().positive().max(1_000_000_000);
/** Operator-selected estimate reservations, not an assertion about the provider invoice. */
export const layoutIllustrationGenerationPolicySchema = z
  .strictObject({
    id,
    textModel: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/),
    imageModel: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/),
    estimatedCostUsdMicros: money,
    storeDailyAttempts: z.number().int().min(1).max(100),
    ownerDailyAttempts: z.number().int().min(1).max(100),
    globalDailyAttempts: z.number().int().min(1).max(1000),
    storeDailyReservedUsdMicros: money,
    globalDailyReservedUsdMicros: money,
  })
  .refine(
    (p) =>
      p.storeDailyReservedUsdMicros >= p.estimatedCostUsdMicros &&
      p.globalDailyReservedUsdMicros >= p.estimatedCostUsdMicros,
    "One attempt must fit the estimate reservation",
  );
export type LayoutIllustrationGenerationPolicy = z.infer<
  typeof layoutIllustrationGenerationPolicySchema
>;
export const layoutIllustrationQuoteBodySchema = z
  .strictObject({
    id,
    preparation: layoutIllustrationPreparationSchema,
    policy: layoutIllustrationGenerationPolicySchema,
    format: z.literal("PNG_1536x1024_LOW_ONE"),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .refine(
    (q) => Date.parse(q.expiresAt) - Date.parse(q.issuedAt) === 300_000,
    "Quote lasts five minutes",
  );
export const layoutIllustrationQuoteSchema = z.strictObject({
  body: layoutIllustrationQuoteBodySchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
export type LayoutIllustrationQuote = z.infer<
  typeof layoutIllustrationQuoteSchema
>;
export const layoutIllustrationGenerationDecisionSchema = z
  .strictObject({
    id,
    storeId: id,
    ownerId: id,
    conversationId: id,
    preparationId: id,
    intent: z.literal("GENERATE_ONE_ILLUSTRATION"),
    quote: layoutIllustrationQuoteSchema,
    confirmedAt: z.iso.datetime(),
  })
  .refine(
    (d) =>
      d.storeId === d.quote.body.preparation.storeId &&
      d.ownerId === d.quote.body.preparation.ownerId &&
      d.conversationId === d.quote.body.preparation.conversationId &&
      d.preparationId === d.quote.body.preparation.id,
    "Generation decision scope mismatch",
  );
export type LayoutIllustrationGenerationDecision = z.infer<
  typeof layoutIllustrationGenerationDecisionSchema
>;
export const layoutIllustrationGenerationStatusSchema = z.enum([
  "QUEUED",
  "SUBMITTED",
  "SUCCEEDED",
  "NOT_SUBMITTED",
  "OUTCOME_UNKNOWN",
]);
export const layoutIllustrationGenerationRecordSchema = z
  .strictObject({
    id,
    storeId: id,
    ownerId: id,
    conversationId: id,
    preparationId: id,
    decision: layoutIllustrationGenerationDecisionSchema,
    version: z.number().int().positive(),
    status: layoutIllustrationGenerationStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    submittedAt: z.iso.datetime().nullable(),
    recoverAt: z.iso.datetime().nullable(),
    reason: z
      .enum([
        "DISABLED",
        "EXPIRED",
        "SOURCE_CHANGED",
        "RESULT_UNCERTAIN",
        "ARCHIVE_PENDING",
      ])
      .nullable(),
  })
  .superRefine((r, ctx) => {
    const validReason =
      r.status === "NOT_SUBMITTED"
        ? ["DISABLED", "EXPIRED", "SOURCE_CHANGED"].includes(r.reason ?? "")
        : r.status === "OUTCOME_UNKNOWN"
          ? ["RESULT_UNCERTAIN", "ARCHIVE_PENDING"].includes(r.reason ?? "")
          : r.reason === null;
    if (
      !validReason ||
      (r.status !== "QUEUED" && r.version < 2) ||
      (["SUCCEEDED", "OUTCOME_UNKNOWN"].includes(r.status) && r.version < 3)
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid generation status/reason/version",
      });
    const p = r.decision.quote.body.preparation;
    if (
      r.id !== r.decision.id ||
      r.storeId !== p.storeId ||
      r.ownerId !== p.ownerId ||
      r.conversationId !== p.conversationId ||
      r.preparationId !== p.id
    )
      ctx.addIssue({
        code: "custom",
        message: "Generation scope does not match its decision",
      });
    if (
      r.status === "QUEUED" || r.status === "NOT_SUBMITTED"
        ? r.submittedAt !== null || r.recoverAt !== null
        : !r.submittedAt || !r.recoverAt
    )
      ctx.addIssue({ code: "custom", message: "Invalid submission state" });
  });
export type LayoutIllustrationGenerationRecord = z.infer<
  typeof layoutIllustrationGenerationRecordSchema
>;
export const layoutIllustrationQuoteStateSchema = z.discriminatedUnion(
  "state",
  [
    z.strictObject({ state: z.literal("DISABLED") }),
    z.strictObject({
      state: z.literal("READY"),
      quote: layoutIllustrationQuoteSchema,
    }),
  ],
);
