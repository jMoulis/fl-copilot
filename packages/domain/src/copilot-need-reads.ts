import { z } from "zod";
import { needUnitSchema } from "./need-unit";
import { needMembershipSchema } from "./need-membership";
import { productSchema } from "./products";
import { copilotEvidenceSchema } from "./copilot-candidate";
export const copilotNeedCatalogueInputSchema = z.strictObject({
  afterId: z.string().uuid().nullable(),
  limit: z.number().int().min(1).max(5),
});
export const copilotNeedCatalogueResultSchema = z.strictObject({
  needs: z.array(needUnitSchema).max(5),
  nextAfterId: z.string().uuid().nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(6),
});
export const copilotNeedMembershipInputSchema = z
  .strictObject({
    needUnitId: z.string().uuid().nullable(),
    productId: z.string().uuid().nullable(),
    afterId: z.string().uuid().nullable(),
    limit: z.number().int().min(1).max(10),
  })
  .refine((v) => v.needUnitId !== null || v.productId !== null);
export const copilotNeedMembershipResultSchema = z.strictObject({
  needUnitId: z.string().uuid().nullable(),
  productId: z.string().uuid().nullable(),
  memberships: z
    .array(
      z.strictObject({
        entity: needMembershipSchema,
        need: needUnitSchema.nullable(),
        product: productSchema.nullable(),
      }),
    )
    .max(10),
  nextAfterId: z.string().uuid().nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(11),
});
