import { z } from "zod";

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const versionSchema = z.number().int().nonnegative();
const nullableIdSchema = idSchema.nullable().optional();

export const productCategorySchema = z.enum([
  "FRUIT",
  "VEGETABLE",
  "OTHER",
  "UNKNOWN",
]);
export const productNatureSchema = z.enum(["BULK", "PACKAGED", "UNKNOWN"]);
export const salesUnitSchema = z.enum(["KG", "PIECE", "PACK", "UNKNOWN"]);
export const packagingUnitSchema = z.enum([
  "KG",
  "G",
  "PIECE",
  "PACK",
  "BAG",
  "TRAY",
  "NET",
  "OTHER",
]);
export const productStatusSchema = z.enum(["ACTIVE", "INACTIVE", "TO_REVIEW"]);
export const productIdentifierTypeSchema = z.enum(["ITM8", "EAN", "PLU"]);
export const productIdentifierSourceSchema = z.enum([
  "MERCALYS",
  "COMMERCIAL_PDF",
  "USER",
  "AI_PROPOSED",
]);
export const productIdentifierStatusSchema = z.enum(["VALIDATED", "TO_REVIEW"]);
export const productAliasSourceSchema = z.enum([
  "MERCALYS",
  "WASTE_RECEIPT",
  "COMMERCIAL_PDF",
  "USER",
  "AI_PROPOSED",
]);
export const productAliasStatusSchema = z.enum([
  "VALIDATED",
  "TO_REVIEW",
  "REJECTED",
]);

export const packagingSchema = z.object({
  quantity: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .refine(
      (value) => Number(value) > 0,
      "Packaging quantity must be positive.",
    ),
  unit: packagingUnitSchema,
  sourceLabel: z.string().trim().min(1).nullable().optional(),
});

export const productSchema = z.object({
  id: idSchema,
  storeId: idSchema,
  label: z.string().trim().min(1).max(240),
  category: productCategorySchema,
  nature: productNatureSchema,
  salesUnit: salesUnitSchema,
  packaging: packagingSchema.nullable().optional(),
  familyId: nullableIdSchema,
  subfamilyId: nullableIdSchema,
  status: productStatusSchema,
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable().optional(),
});

export const productIdentifierSchema = z.object({
  id: idSchema,
  storeId: idSchema,
  productId: idSchema,
  type: productIdentifierTypeSchema,
  value: z.string().trim().min(1).max(80),
  source: productIdentifierSourceSchema,
  status: productIdentifierStatusSchema,
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable().optional(),
});

const productAliasBaseSchema = z.object({
  id: idSchema,
  storeId: idSchema,
  productId: idSchema,
  alias: z.string().trim().min(1).max(240),
  normalizedAlias: z.string().trim().min(1).max(240),
  source: productAliasSourceSchema,
  status: productAliasStatusSchema,
  confidence: z.number().min(0).max(1).nullable().optional(),
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable().optional(),
});

export const productAliasSchema = productAliasBaseSchema.superRefine(
  (alias, context) => {
    if (alias.normalizedAlias !== normalizeProductLabel(alias.alias)) {
      context.addIssue({
        code: "custom",
        path: ["normalizedAlias"],
        message: "Normalized alias does not match its source alias.",
      });
    }
  },
);

export const createProductSchema = productSchema.omit({
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export const updateProductSchema = createProductSchema
  .omit({ id: true, storeId: true })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "No product changes supplied.",
  );
export const createProductIdentifierSchema = productIdentifierSchema.omit({
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export const updateProductIdentifierSchema = createProductIdentifierSchema
  .omit({ id: true, storeId: true, productId: true })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "No identifier changes supplied.",
  );
export const createProductAliasSchema = productAliasBaseSchema.omit({
  normalizedAlias: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export const updateProductAliasSchema = createProductAliasSchema
  .omit({ id: true, storeId: true, productId: true })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "No alias changes supplied.",
  );

export type Product = z.infer<typeof productSchema>;
export type ProductIdentifier = z.infer<typeof productIdentifierSchema>;
export type ProductAlias = z.infer<typeof productAliasSchema>;
export type CreateProduct = z.infer<typeof createProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;
export type CreateProductIdentifier = z.infer<
  typeof createProductIdentifierSchema
>;
export type UpdateProductIdentifier = z.infer<
  typeof updateProductIdentifierSchema
>;
export type CreateProductAlias = z.infer<typeof createProductAliasSchema>;
export type UpdateProductAlias = z.infer<typeof updateProductAliasSchema>;

export function normalizeProductLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("fr-FR")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
