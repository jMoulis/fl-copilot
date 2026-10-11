import { z } from "zod";
import {
  productSchema,
  productCategorySchema,
  productNatureSchema,
  salesUnitSchema,
} from "./products";
const classificationPatchSchema = z
  .strictObject({
    category: productCategorySchema.optional(),
    nature: productNatureSchema.optional(),
    salesUnit: salesUnitSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const productClassificationInputSchema = z
  .strictObject({
    changes: z
      .array(
        z.strictObject({
          productId: z.string().uuid(),
          expectedVersion: z.number().int().positive(),
          patch: classificationPatchSchema,
        }),
      )
      .min(1)
      .max(25),
    allowOverwriteConfirmed: z.boolean().default(false),
  })
  .refine(
    (v) => new Set(v.changes.map((c) => c.productId)).size === v.changes.length,
  );
export const productClassificationRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("product.classify"),
  input: productClassificationInputSchema,
});
/** Canonical request identity to bind a trusted user decision to these exact fields/versions. */
export function productClassificationIntent(raw: unknown) {
  return JSON.stringify(productClassificationRequestSchema.parse(raw));
}
export const productClassificationAuthoritySchema = z.strictObject({
  storeId: z.string().uuid(),
  ownerId: z.string().uuid(),
  conversationId: z.string().uuid(),
  deviceId: z.string().uuid(),
  canManageProducts: z.boolean(),
  userMessageId: z.string().uuid(),
  authorizedRequestJson: z.string().max(24000),
  decisionLevel: z.enum(["ROUTINE", "REVIEWED"]),
});
export type ProductClassificationAuthority = z.infer<
  typeof productClassificationAuthoritySchema
>;
export const productClassificationResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("product.classify"),
  status: z.literal("COMPLETED"),
  message: z.string(),
  appliedAt: z.string().datetime(),
  userMessageId: z.string().uuid(),
  recomputationJobId: z.string().uuid().nullable(),
  changes: z
    .array(
      z.strictObject({
        before: productSchema,
        after: productSchema,
        commandId: z.string().uuid().nullable(),
      }),
    )
    .min(1)
    .max(25),
});
export type ProductClassificationResult = z.infer<
  typeof productClassificationResultSchema
>;
export class ProductClassificationError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "FORBIDDEN"
      | "OPERATION_CONFLICT"
      | "PRODUCT_UNAVAILABLE"
      | "VERSION_CONFLICT"
      | "SYNC_CONFLICT"
      | "REVIEW_REQUIRED"
      | "CANCELLED"
      | "UNAVAILABLE"
      | "CHILD_CONFLICT"
      | "IDENTIFIER_CONFLICT"
      | "ALIAS_REFUSED",
    readonly details?: {
      productId: string;
      fields?: Array<"category" | "nature" | "salesUnit">;
      expectedVersion?: number;
      actualVersion?: number;
    },
  ) {
    super(
      {
        INVALID_INPUT: "La correction contient des informations invalides.",
        FORBIDDEN:
          "Cette correction n’est pas autorisée dans cette conversation.",
        OPERATION_CONFLICT:
          "Cette action correspond déjà à une autre correction.",
        PRODUCT_UNAVAILABLE:
          "Un produit n’est plus disponible dans ce magasin.",
        VERSION_CONFLICT:
          "Une fiche produit a changé. Relisez les produits avant de confirmer la correction.",
        SYNC_CONFLICT:
          "Résolvez le conflit de synchronisation du produit avant de le modifier.",
        REVIEW_REQUIRED:
          "La correction remplace une information déjà renseignée. Examinez les valeurs avant de confirmer.",
        CANCELLED: "La correction a été annulée.",
        CHILD_CONFLICT:
          "Les identifiants ou alias ont changé. Relisez la fiche avant de confirmer.",
        IDENTIFIER_CONFLICT:
          "Un identifiant appartient déjà à un autre produit. Choisissez la fiche concernée.",
        ALIAS_REFUSED:
          "Cet alias a déjà été refusé. La sauvegarde ne peut pas le réactiver.",
        UNAVAILABLE:
          "La correction n’a pas été enregistrée. Vous pouvez réessayer.",
      }[code],
    );
  }
}
export const copilotProductMutationRegistry = [
  {
    name: "product.classify",
    schemaVersion: 1 as const,
    effect: "WRITE" as const,
    runtime: "LOCAL" as const,
    confirmation: "USER_INTENT_AND_REVIEW_FOR_OVERWRITE" as const,
    inputSchema: productClassificationInputSchema,
    outputSchema: productClassificationResultSchema,
    description:
      "Corriger en lot catégorie, nature ou unité de produits identifiés, avec versions exactes et décision utilisateur. Ne crée ni identifiant ni alias.",
    progress: "Enregistrement des corrections…",
  },
];
