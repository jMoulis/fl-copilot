import { z } from "zod";
import {
  productCategorySchema,
  productNatureSchema,
  salesUnitSchema,
  packagingUnitSchema,
  productIdentifierTypeSchema,
  productSchema,
  normalizeProductLabel,
} from "./products";
import { inspectProductResultSchema } from "./copilot-tools";
const children = z
  .array(
    z.strictObject({
      id: z.string().uuid(),
      version: z.number().int().nonnegative(),
    }),
  )
  .max(20)
  .refine((v) => new Set(v.map((c) => c.id)).size === v.length);
export const productEditorDraftSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(240),
    category: productCategorySchema,
    nature: productNatureSchema,
    salesUnit: salesUnitSchema,
    packagingQuantity: z
      .string()
      .trim()
      .max(32)
      .refine(
        (v) =>
          v === "" ||
          (/^\d+(?:[.,]\d+)?$/.test(v) && Number(v.replace(",", ".")) > 0),
      ),
    packagingUnit: packagingUnitSchema,
    packagingSourceLabel: z.string().trim().max(240),
    identifiers: z
      .array(
        z.strictObject({
          id: z.string().uuid().optional(),
          type: productIdentifierTypeSchema,
          value: z.string().trim().min(1).max(80),
        }),
      )
      .max(20),
    aliases: z
      .array(
        z.strictObject({
          id: z.string().uuid().optional(),
          alias: z.string().trim().min(1).max(240),
        }),
      )
      .max(20),
  })
  .superRefine((v, c) => {
    for (const a of [v.identifiers, v.aliases]) {
      const ids = a.map((e) => e.id).filter(Boolean);
      if (new Set(ids).size !== ids.length)
        c.addIssue({ code: "custom", message: "Repeated child ID" });
    }
    if (
      new Set(v.aliases.map((a) => normalizeProductLabel(a.alias))).size !==
      v.aliases.length
    )
      c.addIssue({ code: "custom", message: "Repeated normalized alias" });
    if (
      new Set(v.identifiers.map((e) => `${e.type}:${e.value}`)).size !==
      v.identifiers.length
    )
      c.addIssue({ code: "custom", message: "Repeated identifier" });
  });
export const productSaveInputSchema = z
  .strictObject({
    mode: z.enum(["CREATE", "UPDATE"]),
    productId: z.string().uuid().nullable(),
    expectedVersion: z.number().int().positive().nullable(),
    expectedChildren: z.strictObject({
      identifiers: children,
      aliases: children,
    }),
    draft: productEditorDraftSchema,
  })
  .superRefine((v, c) => {
    if (
      v.mode === "CREATE"
        ? v.productId !== null ||
          v.expectedVersion !== null ||
          v.expectedChildren.identifiers.length > 0 ||
          v.expectedChildren.aliases.length > 0 ||
          v.draft.identifiers.some((e) => e.id) ||
          v.draft.aliases.some((e) => e.id)
        : v.productId === null || v.expectedVersion === null
    )
      c.addIssue({
        code: "custom",
        message: "Invalid creation/update identity",
      });
  });
export const productRetireInputSchema = z.strictObject({
  productId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
});
export const productCatalogueRequestSchema = z.discriminatedUnion("tool", [
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("product.save"),
    input: productSaveInputSchema,
  }),
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("product.retire"),
    input: productRetireInputSchema,
  }),
]);
export function productCatalogueIntent(raw: unknown) {
  return JSON.stringify(productCatalogueRequestSchema.parse(raw));
}
const base = {
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  status: z.literal("COMPLETED"),
  userMessageId: z.string().uuid(),
  appliedAt: z.string().datetime(),
  message: z.string(),
  recomputationJobId: z.string().uuid().nullable(),
  commandIds: z.array(z.string().uuid()).max(100),
};
const snapshot = inspectProductResultSchema.shape.snapshot.unwrap();
export const productSaveResultSchema = z.strictObject({
  ...base,
  tool: z.literal("product.save"),
  before: snapshot.nullable(),
  after: snapshot,
});
export const productRetireResultSchema = z.strictObject({
  ...base,
  tool: z.literal("product.retire"),
  before: productSchema,
  after: productSchema,
});
export const productCatalogueResultSchema = z.discriminatedUnion("tool", [
  productSaveResultSchema,
  productRetireResultSchema,
]);
export type ProductCatalogueResult = z.infer<
  typeof productCatalogueResultSchema
>;
export const copilotCatalogueMutationRegistry = [
  {
    name: "product.save",
    inputSchema: productSaveInputSchema,
    outputSchema: productSaveResultSchema,
    description:
      "Créer ou modifier une fiche complète et ses identifiants/alias avec décision utilisateur et versions exactes des enfants.",
    progress: "Enregistrement de la fiche…",
  },
  {
    name: "product.retire",
    inputSchema: productRetireInputSchema,
    outputSchema: productRetireResultSchema,
    description:
      "Retirer un produit par la suppression logique existante, en conservant son historique.",
    progress: "Retrait du produit…",
  },
].map((t) => ({
  ...t,
  schemaVersion: 1 as const,
  effect: "WRITE" as const,
  runtime: "LOCAL" as const,
  confirmation: "REVIEWED_USER_INTENT" as const,
}));
