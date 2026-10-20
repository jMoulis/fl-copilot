import { z } from "zod";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { copilotMessageSchema } from "./copilot-conversation";
const cm = z
  .number()
  .finite()
  .min(0)
  .max(10000)
  .refine(
    (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-7,
    "Indiquez des centimètres avec une décimale au maximum.",
  )
  .nullable();
const label = z.string().trim().min(1).max(120);
const base = { expectedRevisionId: z.uuid() };
/** The model supplies a requested patch, never identities of new records, authority or measurement quality. */
export const legacyCopilotLayoutEditInputSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      ...base,
      action: z.literal("EDIT"),
      targetId: z.uuid().nullable(),
      patch: z
        .strictObject({
          label: label.optional(),
          widthCm: cm.optional(),
          depthCm: cm.optional(),
          heightCm: cm.optional(),
          xCm: cm.optional(),
          yCm: cm.optional(),
          rotation: z
            .union([
              z.literal(0),
              z.literal(90),
              z.literal(180),
              z.literal(270),
            ])
            .nullable()
            .optional(),
          clearanceBelowCm: cm.optional(),
          maxLoadKg: z
            .number()
            .finite()
            .min(0)
            .max(100000)
            .nullable()
            .optional(),
        })
        .refine((p) => Object.keys(p).length > 0),
    }),
    z.strictObject({
      ...base,
      action: z.literal("ADD_MOBILE"),
      label,
      hostId: z.uuid().nullable(),
      patch: z
        .strictObject({
          widthCm: cm.optional(),
          depthCm: cm.optional(),
          heightCm: cm.optional(),
          xCm: cm.optional(),
          yCm: cm.optional(),
          rotation: z
            .union([
              z.literal(0),
              z.literal(90),
              z.literal(180),
              z.literal(270),
            ])
            .nullable()
            .optional(),
        })
        .optional(),
    }),
    z.strictObject({
      ...base,
      action: z.literal("ASSOCIATE_MOBILE"),
      targetId: z.uuid(),
      hostId: z.uuid().nullable(),
    }),
    z.strictObject({
      ...base,
      action: z.literal("REMOVE_MOBILE"),
      targetId: z.uuid(),
    }),
  ],
);
const slot = z.strictObject({
  assemblyId: z.uuid(),
  face: z.enum(["A", "B"]),
  order: z.number().int().min(1).max(64),
});
export const copilotLayoutInventoryInputSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({ ...base, action: z.literal("ADD_ASSEMBLY"), label }),
    z.strictObject({ ...base, action: z.literal("ADD_TG"), label }),
    z.strictObject({
      ...base,
      action: z.literal("ADD_FIXED"),
      label,
      ...slot.shape,
    }),
    z.strictObject({
      ...base,
      action: z.literal("ADD_TG_SURFACE"),
      furnitureId: z.uuid(),
      label,
      surfaceKind: z.enum(["BAC", "UPPER_SHELF", "OTHER"]),
    }),
    z.strictObject({
      ...base,
      action: z.literal("COPY_ASSEMBLY"),
      targetId: z.uuid(),
      label,
      copyDimensions: z.boolean(),
    }),
    z.strictObject({
      ...base,
      action: z.literal("COPY_FURNITURE"),
      targetId: z.uuid(),
      label,
      copyDimensions: z.boolean(),
      slot: slot.nullable(),
    }),
    z.strictObject({
      ...base,
      action: z.literal("REMOVE_ASSEMBLY"),
      targetId: z.uuid(),
    }),
    z.strictObject({
      ...base,
      action: z.literal("REMOVE_FURNITURE"),
      targetId: z.uuid(),
    }),
    z.strictObject({
      ...base,
      action: z.literal("REMOVE_TG_SURFACE"),
      targetId: z.uuid(),
    }),
  ],
);
export const copilotLayoutEditInputSchema = z.discriminatedUnion("action", [
  ...legacyCopilotLayoutEditInputSchema.options,
  ...copilotLayoutInventoryInputSchema.options,
]);
export type CopilotLayoutEditInput = z.infer<
  typeof copilotLayoutEditInputSchema
>;
export const layoutEditBasisSchema = z.strictObject({
  storeId: z.uuid(),
  revisionId: z.uuid(),
  version: z.number().int().positive(),
  sourceRevisionId: z.uuid(),
});
export const layoutCreatedIdsSchema = z
  .strictObject({ furnitureId: z.uuid(), surfaceId: z.uuid() })
  .refine((v) => v.furnitureId !== v.surfaceId);
/** At most half the bounded inventory can be copied into the same plan (64 furniture + 192 surfaces + island). */
export const layoutInventoryCreatedIdsSchema = z.strictObject({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(257)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const layoutProposalCreatedIdsSchema = z.union([
  layoutCreatedIdsSchema,
  layoutInventoryCreatedIdsSchema,
]);
export type CopilotLayoutCreatedIds = z.infer<
  typeof layoutProposalCreatedIdsSchema
>;
export const copilotLayoutEditPreviewSchema = z.strictObject({
  input: copilotLayoutEditInputSchema,
  status: z.enum(["READY", "UNCHANGED", "ABSENT", "STALE", "BLOCKED"]),
  basis: layoutEditBasisSchema.nullable(),
  created: layoutProposalCreatedIdsSchema.nullable(),
  changes: z
    .array(
      z.strictObject({
        key: z.string().max(160),
        label: z.string().max(300),
        before: z.string().max(1500),
        after: z.string().max(1500),
      }),
    )
    .max(2000),
  geometry: z
    .strictObject({
      status: z.enum(["CHECKED", "INCOMPLETE", "BLOCKED"]),
      blocking: z.number().int().nonnegative(),
      missing: z.number().int().nonnegative(),
    })
    .nullable(),
  message: z.string().min(1).max(1200),
  evidence: z.array(copilotEvidenceSchema).min(1).max(1),
});
export const copilotLayoutEditProposalSchema = z
  .strictObject({
    kind: z.literal("STORE_LAYOUT_EDIT_PROPOSAL"),
    schemaVersion: z.literal(1),
    assistantMessageId: z.uuid(),
    input: copilotLayoutEditInputSchema,
    basis: layoutEditBasisSchema,
    created: layoutProposalCreatedIdsSchema.nullable(),
  })
  .superRefine((v, c) => {
    const createsInventory =
      v.input.action.startsWith("ADD_") || v.input.action.startsWith("COPY_");
    const validCreated =
      v.input.action === "ADD_MOBILE"
        ? layoutCreatedIdsSchema.safeParse(v.created).success
        : createsInventory
          ? layoutInventoryCreatedIdsSchema.safeParse(v.created).success
          : v.created === null;
    if (v.input.expectedRevisionId !== v.basis.revisionId || !validCreated)
      c.addIssue({
        code: "custom",
        message: "Proposition physique incohérente.",
      });
  });
export function readCopilotLayoutEditProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("LAYOUT_PROPOSAL_INVALID");
  const content = copilotLayoutEditProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (content.basis.storeId !== message.storeId)
    throw Error("LAYOUT_PROPOSAL_SCOPE");
  return { message, content };
}
export const layoutEditResultSchema = z.strictObject({
  operationId: z.uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("store.layout.save_draft"),
  status: z.literal("COMPLETED"),
  userMessageId: z.uuid(),
  appliedAt: z.string().datetime(),
  revisionId: z.uuid(),
  referenceRevisionId: z.uuid().nullable(),
  commandId: z.uuid(),
  syncState: z.literal("PENDING"),
  message: z.string(),
});
