import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
const id = z.string().uuid(),
  time = z
    .string()
    .datetime()
    .transform((v) => new Date(v).toISOString());
export const recommendationTrackingInputSchema = z.strictObject({
  sourceMessageId: id,
  quote: z.string().trim().min(1).max(1200),
});
export const recommendationTrackingBasisSchema = z.strictObject({
  sourceMessageId: id,
  sourceCreatedAt: time,
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  quote: recommendationTrackingInputSchema.shape.quote,
});
export const recommendationTrackingPreviewSchema = z
  .strictObject({
    input: recommendationTrackingInputSchema,
    status: z.enum(["READY", "SOURCE_UNAVAILABLE"]),
    basis: recommendationTrackingBasisSchema.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(1),
  })
  .superRefine((r, c) => {
    if (
      (r.status === "READY") !== !!r.basis ||
      (r.basis &&
        (r.basis.sourceMessageId !== r.input.sourceMessageId ||
          r.basis.quote !== r.input.quote))
    )
      c.addIssue({ code: "custom", message: "Invalid recommendation source" });
  });
export const recommendationTrackingCardSchema = z.strictObject({
  kind: z.literal("RECOMMENDATION_TRACKING"),
  schemaVersion: z.literal(1),
  assistantMessageId: id,
  recommendationId: id,
  basis: recommendationTrackingBasisSchema,
});
export function readRecommendationTrackingCard(raw: unknown) {
  const message = copilotMessageSchema.parse(raw),
    content = recommendationTrackingCardSchema.parse(JSON.parse(message.text));
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length ||
    message.id === content.basis.sourceMessageId ||
    content.assistantMessageId === content.basis.sourceMessageId
  )
    throw Error("RECOMMENDATION_CARD_INVALID");
  return { message, content };
}
export const recommendationChoiceSchema = z
  .strictObject({
    type: z.enum(["ACCEPT", "MODIFY", "POSTPONE", "REJECT"]),
    modifiedAction: z.string().trim().min(1).max(1200).nullable(),
    postponeUntil: z.string().date().nullable(),
    reason: z.string().trim().min(1).max(600).nullable(),
  })
  .superRefine((v, c) => {
    if (
      (v.type === "MODIFY") !== !!v.modifiedAction ||
      (v.type === "POSTPONE") !== !!v.postponeUntil
    )
      c.addIssue({
        code: "custom",
        message:
          "Précisez l’action modifiée ou la date du report, uniquement pour le choix correspondant.",
      });
  });
export const recommendationDecisionRevisionSchema =
  recommendationChoiceSchema.safeExtend({
    proposalMessageId: id,
    version: z.number().int().min(1).max(50),
    decidedAt: time,
  });
export const recommendationDecisionSchema = z
  .strictObject({
    id,
    storeId: id,
    ownerId: id,
    conversationId: id,
    recommendationId: id,
    proposalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.number().int().min(1).max(50),
    createdAt: time,
    updatedAt: time,
    revisions: z.array(recommendationDecisionRevisionSchema).min(1).max(50),
  })
  .superRefine((r, c) => {
    if (
      r.id !== r.recommendationId ||
      r.version !== r.revisions.length ||
      r.createdAt > r.revisions[0]!.decidedAt ||
      r.updatedAt !== r.revisions.at(-1)!.decidedAt ||
      r.revisions.some(
        (v, i) =>
          v.version !== i + 1 ||
          (i > 0 && v.decidedAt < r.revisions[i - 1]!.decidedAt),
      )
    )
      c.addIssue({ code: "custom", message: "Invalid decision history" });
  });
export type RecommendationDecision = z.infer<
  typeof recommendationDecisionSchema
>;
export type RecommendationChoice = z.infer<typeof recommendationChoiceSchema>;
export function sameRecommendationDecisionIdentity(
  a: RecommendationDecision,
  b: RecommendationDecision,
) {
  return (
    [
      "id",
      "storeId",
      "ownerId",
      "conversationId",
      "recommendationId",
      "proposalDigest",
      "createdAt",
    ] as const
  ).every((k) => a[k] === b[k]);
}

export function recommendationTrackingIdentityPayload(
  scope: { storeId: string; ownerId: string; conversationId: string },
  basis: unknown,
) {
  return JSON.stringify([
    z.uuid().parse(scope.storeId),
    z.uuid().parse(scope.ownerId),
    z.uuid().parse(scope.conversationId),
    recommendationTrackingBasisSchema.parse(basis),
  ]);
}
export function recommendationIdFromDigest(hex: string) {
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(hex);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const recommendationDecisionReadInputSchema = z.strictObject({
  conversationId: id.nullable(),
  recommendationId: id.nullable(),
  afterId: id.nullable(),
  limit: z.number().int().min(1).max(10),
});
export const recommendationDecisionReadResultSchema = z
  .strictObject({
    input: recommendationDecisionReadInputSchema,
    status: z.enum(["READY", "CONVERSATION_UNAVAILABLE"]),
    entries: z
      .array(
        z.strictObject({
          id,
          conversationId: id,
          version: z.number().int().positive(),
          createdAt: time,
          updatedAt: time,
          latest: recommendationDecisionRevisionSchema,
          historyCount: z.number().int().positive(),
          basis: recommendationTrackingBasisSchema.nullable(),
          sourceState: z.enum(["ACTIVE", "INACTIVE_SOURCE", "UNAVAILABLE"]),
        }),
      )
      .max(10),
    hasMore: z.boolean(),
    nextAfterId: id.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(11),
  })
  .superRefine((v, c) => {
    if (
      v.hasMore !== !!v.nextAfterId ||
      (v.status !== "READY" && (v.entries.length || v.hasMore)) ||
      v.entries.some(
        (e) =>
          e.version !== e.latest.version ||
          e.version !== e.historyCount ||
          (v.input.conversationId &&
            e.conversationId !== v.input.conversationId) ||
          (v.input.recommendationId && e.id !== v.input.recommendationId) ||
          (v.input.afterId && e.id <= v.input.afterId),
      )
    )
      c.addIssue({ code: "custom", message: "Invalid decision coverage" });
  });
