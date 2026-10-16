import { z } from "zod";
import { commercialWeekPreparationSchema } from "./commercial-week-preparation";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { copilotPlanReadInputSchema } from "./copilot-commercial-plan-read";
import { preparationRequestSchema } from "./copilot-commercial-preparation";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
const placement =
  commercialWeekPreparationSchema.shape.placements.element.shape;
export const copilotPreparationPatchSchema = z
  .strictObject({
    weekStart: copilotPlanReadInputSchema.shape.weekStart,
    patch: z
      .strictObject({
        tgCapacity: commercialWeekPreparationSchema.shape.tgCapacity.optional(),
        note: commercialWeekPreparationSchema.shape.note.optional(),
        tgUpdates: z
          .array(
            z
              .strictObject({
                placementId: z.uuid(),
                label: placement.label.optional(),
                theme: placement.theme.optional(),
                offerIds: placement.offerIds.optional(),
              })
              .refine((v) => Object.keys(v).length > 1),
          )
          .min(1)
          .max(30)
          .optional(),
      })
      .refine((v) => Object.keys(v).length > 0),
  })
  .superRefine((v, c) => {
    const ids = v.patch.tgUpdates?.map((p) => p.placementId) ?? [];
    if (new Set(ids).size !== ids.length)
      c.addIssue({
        code: "custom",
        path: ["patch", "tgUpdates"],
        message: "Une TG ne peut être modifiée deux fois.",
      });
  });
export const preparationBasisSchema = z.strictObject({
  preparation: commercialWeekPreparationSchema,
  choices: z.array(commercialOfferChoiceSchema).max(100),
});
export function validatePreparationBasis(
  storeId: string,
  input: z.infer<typeof copilotPreparationPatchSchema>,
  raw: unknown,
) {
  const b = preparationBasisSchema.parse(raw),
    p = b.preparation;
  if (
    p.storeId !== storeId ||
    p.weekStart !== input.weekStart ||
    b.choices.some(
      (c) =>
        c.storeId !== storeId || !p.offerRefs.some((r) => r.choiceId === c.id),
    ) ||
    new Set(b.choices.map((c) => c.id)).size !== b.choices.length ||
    b.choices.length !== p.offerRefs.length
  )
    throw Error("PREPARATION_PROPOSAL_SCOPE");
  return b;
}
export function prepareWeekPatch(
  input: z.infer<typeof copilotPreparationPatchSchema>,
  raw: z.infer<typeof preparationBasisSchema>,
  operationId: string,
) {
  const { preparation: p } = validatePreparationBasis(
    raw.preparation.storeId,
    input,
    raw,
  );
  const updates = input.patch.tgUpdates ?? [];
  if (updates.some((u) => !p.placements.some((t) => t.id === u.placementId)))
    throw Error("PREPARATION_TG_UNAVAILABLE");
  const after = commercialWeekPreparationSchema.parse({
    ...p,
    ...(input.patch.tgCapacity !== undefined
      ? { tgCapacity: input.patch.tgCapacity }
      : {}),
    ...(input.patch.note !== undefined ? { note: input.patch.note } : {}),
    placements: p.placements.map((t) => {
      const u = updates.find((u) => u.placementId === t.id);
      if (!u) return t;
      const { placementId, ...patch } = u;
      void placementId;
      return { ...t, ...patch };
    }),
  });
  const { id, storeId, version, createdAt, updatedAt, ...draft } = after;
  void id;
  void storeId;
  void version;
  void createdAt;
  void updatedAt;
  return preparationRequestSchema.parse({
    operationId,
    schemaVersion: 1,
    tool: "commercial.preparation.save",
    input: { expectedVersion: p.version, draft },
  });
}
export const copilotPreparationPreviewSchema = z.strictObject({
  input: copilotPreparationPatchSchema,
  status: z.enum([
    "READY",
    "UNCHANGED",
    "UNAVAILABLE",
    "BLOCKED",
    "LIMIT_EXCEEDED",
  ]),
  basis: preparationBasisSchema.nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(2),
});
export const copilotPreparationProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_PREPARATION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotPreparationPatchSchema,
  basis: preparationBasisSchema,
});
export function readCopilotPreparationProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("PREPARATION_PROPOSAL_INVALID");
  const content = copilotPreparationProposalSchema.parse(
    JSON.parse(message.text),
  );
  validatePreparationBasis(message.storeId, content.input, content.basis);
  const request = prepareWeekPatch(content.input, content.basis, message.id);
  return { message, content, request };
}
