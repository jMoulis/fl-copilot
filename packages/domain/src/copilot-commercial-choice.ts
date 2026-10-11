import { z } from "zod";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
const {
  source,
  operationKind,
  operationLabel,
  rawProductLabel,
  productId,
  saleStart,
  saleEnd,
  mechanism,
  applicabilityConfirmed,
  criticalFieldsConfirmed,
  status,
  note,
} = commercialOfferChoiceSchema.shape;
export const choiceSaveInputSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive().nullable(),
    productVersion: z.number().int().positive().nullable(),
    draft: z.strictObject({
      source,
      operationKind,
      operationLabel,
      rawProductLabel,
      productId,
      saleStart,
      saleEnd,
      mechanism,
      applicabilityConfirmed,
      criticalFieldsConfirmed,
      status,
      note,
    }),
  })
  .refine((v) => v.draft.status !== "RETAINED" || v.productVersion !== null);
export const choiceSaveRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.choice.save"),
  input: choiceSaveInputSchema,
});
export const choiceSaveAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({ canManageCommercialChoices: z.boolean() });
export type ChoiceSaveAuthority = z.infer<typeof choiceSaveAuthoritySchema>;
export function choiceSaveIntent(raw: unknown) {
  return JSON.stringify(choiceSaveRequestSchema.parse(raw));
}
export const choiceSaveResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.choice.save"),
  status: z.literal("COMPLETED"),
  userMessageId: z.string().uuid(),
  appliedAt: z.string().datetime(),
  before: commercialOfferChoiceSchema.nullable(),
  after: commercialOfferChoiceSchema,
  commandId: z.string().uuid(),
  syncState: z.literal("PENDING"),
  message: z.string(),
});
export const copilotChoiceMutationRegistry = [
  {
    name: "commercial.choice.save",
    schemaVersion: 1,
    effect: "WRITE",
    runtime: "LOCAL",
    confirmation: "REVIEWED_USER_INTENT",
    description:
      "Retenir, modifier ou retirer un choix commercial confirmé et lié à une offre du document original. Ne publie ni n’exécute un plan.",
    progress: "Enregistrement du choix commercial…",
    inputSchema: choiceSaveInputSchema,
    outputSchema: choiceSaveResultSchema,
  },
] as const;

export const choiceInspectInputSchema = z.strictObject({
  choiceId: z.string().uuid(),
});
export const choiceInspectRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.choice.inspect"),
  input: choiceInspectInputSchema,
});
export const choiceInspectResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.choice.inspect"),
  status: z.literal("COMPLETED"),
  observedAt: z.string().datetime(),
  message: z.string(),
  snapshot: z
    .strictObject({
      entity: commercialOfferChoiceSchema,
      syncState: z.string(),
      remoteVersion: z.number().int().positive().nullable(),
    })
    .nullable(),
});
export const choiceInspectTool = {
  name: "commercial.choice.inspect",
  schemaVersion: 1,
  effect: "READ",
  runtime: "LOCAL",
  confirmation: "NONE",
  description:
    "Consulter un choix commercial par identifiant, y compris un choix retiré, avec sa version et son état local.",
  progress: "Lecture du choix commercial…",
  inputSchema: choiceInspectInputSchema,
  outputSchema: choiceInspectResultSchema,
} as const;
