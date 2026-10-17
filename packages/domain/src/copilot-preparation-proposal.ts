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
    create: z
      .strictObject({
        choiceIds: z
          .array(z.uuid())
          .max(100)
          .refine((ids) => new Set(ids).size === ids.length),
      })
      .optional(),
    patch: z.strictObject({
      refreshChoiceIds: z.array(z.uuid()).min(1).max(100).optional(),
      offerSelection: z
        .strictObject({
          addChoiceIds: z.array(z.uuid()).min(1).max(100).optional(),
          removeChoiceIds: z.array(z.uuid()).min(1).max(100).optional(),
        })
        .refine((v) => Object.keys(v).length > 0)
        .superRefine((v, c) => {
          const add = v.addChoiceIds ?? [],
            remove = v.removeChoiceIds ?? [];
          if (
            new Set(add).size !== add.length ||
            new Set(remove).size !== remove.length ||
            add.some((id) => remove.includes(id))
          )
            c.addIssue({
              code: "custom",
              message:
                "Une offre ne peut être sélectionnée plusieurs fois, ni ajoutée et retirée ensemble.",
            });
        })
        .optional(),
      tgCapacity: commercialWeekPreparationSchema.shape.tgCapacity.optional(),
      note: commercialWeekPreparationSchema.shape.note.optional(),
      tgAdditions: z
        .array(
          z.strictObject({
            label: placement.label,
            theme: placement.theme,
            offerIds: placement.offerIds,
          }),
        )
        .min(1)
        .max(30)
        .optional(),
      tgRemovals: z.array(z.uuid()).min(1).max(30).optional(),
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
    }),
  })
  .superRefine((v, c) => {
    if (!v.create && Object.keys(v.patch).length === 0)
      c.addIssue({
        code: "custom",
        path: ["patch"],
        message: "Précisez la modification demandée.",
      });
    if (
      v.create &&
      (v.patch.tgUpdates !== undefined ||
        v.patch.tgRemovals !== undefined ||
        v.patch.offerSelection !== undefined ||
        v.patch.refreshChoiceIds !== undefined)
    )
      c.addIssue({
        code: "custom",
        path: ["patch"],
        message:
          "Une nouvelle semaine ne contient pas de TG à modifier ou retirer.",
      });
    const refresh = v.patch.refreshChoiceIds ?? [];
    if (
      new Set(refresh).size !== refresh.length ||
      refresh.some((id) =>
        [
          ...(v.patch.offerSelection?.addChoiceIds ?? []),
          ...(v.patch.offerSelection?.removeChoiceIds ?? []),
        ].includes(id),
      )
    )
      c.addIssue({
        code: "custom",
        path: ["patch", "refreshChoiceIds"],
        message:
          "Une référence ne peut être actualisée deux fois, ajoutée ou retirée ensemble.",
      });
    const ids = v.patch.tgUpdates?.map((p) => p.placementId) ?? [];
    const removals = v.patch.tgRemovals ?? [];
    if (
      new Set(removals).size !== removals.length ||
      removals.some((id) => ids.includes(id))
    )
      c.addIssue({
        code: "custom",
        path: ["patch", "tgRemovals"],
        message:
          "Une TG ne peut être retirée deux fois ou modifiée et retirée ensemble.",
      });
    if (new Set(ids).size !== ids.length)
      c.addIssue({
        code: "custom",
        path: ["patch", "tgUpdates"],
        message: "Une TG ne peut être modifiée deux fois.",
      });
  });
/** Legacy capable clients can still edit; they cannot review additions/removals. */
export const copilotPreparationEditPatchSchema = z
  .strictObject({
    weekStart: copilotPreparationPatchSchema.shape.weekStart,
    patch: z
      .strictObject({
        tgCapacity: copilotPreparationPatchSchema.shape.patch.shape.tgCapacity,
        note: copilotPreparationPatchSchema.shape.patch.shape.note,
        tgUpdates: copilotPreparationPatchSchema.shape.patch.shape.tgUpdates,
      })
      .refine((v) => Object.keys(v).length > 0),
  })
  .refine((v) => copilotPreparationPatchSchema.safeParse(v).success);
const previousPreparationPatchSchema = z
  .strictObject(copilotPreparationPatchSchema.shape.patch.shape)
  .omit({ offerSelection: true, refreshChoiceIds: true });
export const copilotPreparationLayoutPatchSchema = z
  .strictObject({
    weekStart: copilotPreparationPatchSchema.shape.weekStart,
    patch: previousPreparationPatchSchema,
  })
  .refine((v) => copilotPreparationPatchSchema.safeParse(v).success);
export const copilotPreparationCreatePatchSchema = z
  .strictObject({
    weekStart: copilotPreparationPatchSchema.shape.weekStart,
    create: copilotPreparationPatchSchema.shape.create,
    patch: previousPreparationPatchSchema,
  })
  .refine((v) => copilotPreparationPatchSchema.safeParse(v).success);
const selectionOnlyPatch = z
  .strictObject(copilotPreparationPatchSchema.shape.patch.shape)
  .omit({ refreshChoiceIds: true });
export const copilotPreparationRetainedSelectionPatchSchema = z
  .strictObject({
    weekStart: copilotPreparationPatchSchema.shape.weekStart,
    create: copilotPreparationPatchSchema.shape.create,
    patch: selectionOnlyPatch,
  })
  .refine((v) => copilotPreparationPatchSchema.safeParse(v).success);
export const copilotPreparationRefreshPatchSchema = z
  .strictObject({
    weekStart: copilotPreparationPatchSchema.shape.weekStart,
    patch: copilotPreparationPatchSchema.shape.patch,
  })
  .refine((v) => copilotPreparationPatchSchema.safeParse(v).success);
export const copilotPreparationSelectionPatchSchema = z
  .strictObject({
    weekStart: copilotPreparationPatchSchema.shape.weekStart,
    patch: selectionOnlyPatch,
  })
  .refine((v) => copilotPreparationPatchSchema.safeParse(v).success);
export function hasPreparationLayoutChange(
  input: z.infer<typeof copilotPreparationPatchSchema>,
) {
  return (
    input.patch.tgAdditions !== undefined ||
    input.patch.tgRemovals !== undefined
  );
}
/** IDs belong to the trusted persisted operation, never to model arguments. */
export function preparationAdditionId(operationId: string, index: number) {
  z.uuid().parse(operationId);
  z.number().int().min(0).max(29).parse(index);
  const suffix = (
    (parseInt(operationId.slice(-12), 16) + index + 1) %
    0x1000000000000
  )
    .toString(16)
    .padStart(12, "0");
  return operationId.slice(0, -12) + suffix;
}
export const preparationBasisSchema = z.strictObject({
  preparation: commercialWeekPreparationSchema.nullable(),
  creationStoreId: z.uuid().optional(),
  choices: z.array(commercialOfferChoiceSchema).max(200),
});
export function validatePreparationBasis(
  storeId: string,
  input: z.infer<typeof copilotPreparationPatchSchema>,
  raw: unknown,
) {
  z.uuid().parse(storeId);
  const b = preparationBasisSchema.parse(raw),
    p = b.preparation;
  const ids = [
    ...new Set([
      ...(input.create?.choiceIds ?? p?.offerRefs.map((r) => r.choiceId) ?? []),
      ...(input.patch.offerSelection?.addChoiceIds ?? []),
    ]),
  ];
  const required = ids.filter(
    (id) => !(input.patch.offerSelection?.removeChoiceIds ?? []).includes(id),
  );
  if (
    (input.create
      ? p !== null || b.creationStoreId !== storeId
      : !p ||
        p.storeId !== storeId ||
        p.weekStart !== input.weekStart ||
        b.creationStoreId !== undefined) ||
    b.choices.some((c) => c.storeId !== storeId || !ids.includes(c.id)) ||
    new Set(b.choices.map((c) => c.id)).size !== b.choices.length ||
    required.some((id) => !b.choices.some((c) => c.id === id))
  )
    throw Error("PREPARATION_PROPOSAL_SCOPE");
  return b;
}
export function prepareWeekPatch(
  input: z.infer<typeof copilotPreparationPatchSchema>,
  raw: z.infer<typeof preparationBasisSchema>,
  operationId: string,
) {
  const b = validatePreparationBasis(
    raw.preparation?.storeId ?? raw.creationStoreId!,
    input,
    raw,
  );
  // Validation-only shape; the canonical local writer owns actual identity and timestamps.
  const p =
    b.preparation ??
    commercialWeekPreparationSchema.parse({
      id: operationId,
      storeId: b.creationStoreId,
      weekStart: input.weekStart,
      weekEnd: new Date(
        Date.parse(input.weekStart + "T00:00:00Z") + 6 * 86400000,
      )
        .toISOString()
        .slice(0, 10),
      status: "DRAFT",
      tgCapacity: null,
      note: "",
      placements: [],
      offerRefs: input.create!.choiceIds.map((choiceId) => ({
        choiceId,
        choiceVersion: b.choices.find((c) => c.id === choiceId)!.version,
      })),
      version: 1,
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
    });
  const selection = input.patch.offerSelection,
    selected = p.offerRefs.map((r) => r.choiceId);
  if (selection?.removeChoiceIds?.some((id) => !selected.includes(id)))
    throw Error("PREPARATION_OFFER_UNAVAILABLE");
  if (
    input.patch.refreshChoiceIds?.some(
      (id) =>
        !selected.includes(id) ||
        b.choices.find((c) => c.id === id)!.version <
          p.offerRefs.find((r) => r.choiceId === id)!.choiceVersion,
    )
  )
    throw Error("PREPARATION_OFFER_REFRESH_INVALID");
  const refreshedRefs = p.offerRefs.map((r) =>
    input.patch.refreshChoiceIds?.includes(r.choiceId)
      ? {
          choiceId: r.choiceId,
          choiceVersion: b.choices.find((c) => c.id === r.choiceId)!.version,
        }
      : r,
  );
  const offerRefs = selection
    ? [
        ...refreshedRefs.filter(
          (r) => !selection.removeChoiceIds?.includes(r.choiceId),
        ),
        ...(selection.addChoiceIds ?? [])
          .filter((id) => !selected.includes(id))
          .map((choiceId) => ({
            choiceId,
            choiceVersion: b.choices.find((c) => c.id === choiceId)!.version,
          })),
      ]
    : refreshedRefs;
  const updates = input.patch.tgUpdates ?? [];
  const removals = input.patch.tgRemovals ?? [];
  if (
    updates.some((u) => !p.placements.some((t) => t.id === u.placementId)) ||
    removals.some((id) => !p.placements.some((t) => t.id === id))
  )
    throw Error("PREPARATION_TG_UNAVAILABLE");
  const after = commercialWeekPreparationSchema.parse({
    ...p,
    offerRefs,
    ...(input.patch.tgCapacity !== undefined
      ? { tgCapacity: input.patch.tgCapacity }
      : {}),
    ...(input.patch.note !== undefined ? { note: input.patch.note } : {}),
    placements: [
      ...p.placements
        .filter((t) => !removals.includes(t.id))
        .map((t) => {
          const u = updates.find((u) => u.placementId === t.id);
          if (!u) return t;
          const { placementId, ...patch } = u;
          void placementId;
          return { ...t, ...patch };
        }),
      ...(input.patch.tgAdditions ?? []).map((addition, index) => ({
        ...addition,
        id: preparationAdditionId(operationId, index),
        sourceIdea: null,
      })),
    ],
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
    input: { expectedVersion: b.preparation?.version ?? null, draft },
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
    "ALREADY_EXISTS",
  ]),
  basis: preparationBasisSchema.nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(2),
});
export const copilotPreparationProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_PREPARATION_PROPOSAL"),
  schemaVersion: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
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
  if (
    Boolean(content.input.patch.refreshChoiceIds) !==
    (content.schemaVersion === 5)
  )
    throw Error("PREPARATION_PROPOSAL_VERSION");
  if (
    content.schemaVersion !== 5 &&
    Boolean(content.input.patch.offerSelection) !==
      (content.schemaVersion === 4)
  )
    throw Error("PREPARATION_PROPOSAL_VERSION");
  if (Boolean(content.input.create) !== (content.schemaVersion === 3))
    throw Error("PREPARATION_PROPOSAL_VERSION");
  if (content.schemaVersion === 1 && hasPreparationLayoutChange(content.input))
    throw Error("PREPARATION_PROPOSAL_VERSION");
  const request = prepareWeekPatch(content.input, content.basis, message.id);
  return { message, content, request };
}
