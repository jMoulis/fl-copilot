import { z } from "zod";
import { productSchema } from "./products";
import { productClassificationInputSchema } from "./copilot-product-mutations";
import { copilotEvidenceSchema } from "./copilot-candidate";
const changeSchema = productClassificationInputSchema.shape.changes.element;
export const copilotProductPreviewInputSchema = z.strictObject({
  productId: changeSchema.shape.productId,
  patch: changeSchema.shape.patch,
});
export const classificationFields = [
  "category",
  "nature",
  "salesUnit",
] as const;
/** Same comparison for read-only preparation and the trusted local writer. */
export function compareProductClassification(
  rawProduct: unknown,
  rawPatch: unknown,
) {
  const before = productSchema.parse(rawProduct);
  const patch = changeSchema.shape.patch.parse(rawPatch);
  const changedFields = classificationFields.filter(
    (key) => patch[key] !== undefined && patch[key] !== before[key],
  );
  return {
    before,
    proposed: productSchema.parse({ ...before, ...patch }),
    changedFields,
    reviewFields: changedFields.filter((key) => before[key] !== "UNKNOWN"),
  };
}
export const copilotProductPreviewResultSchema = z
  .strictObject({
    productId: z.string().uuid(),
    status: z.enum(["PREVIEW", "UNAVAILABLE"]),
    preview: z
      .strictObject({
        before: productSchema,
        proposed: productSchema,
        changedFields: z.array(z.enum(classificationFields)).max(3),
        reviewFields: z.array(z.enum(classificationFields)).max(3),
      })
      .nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(1),
  })
  .superRefine((value, ctx) => {
    if ((value.status === "PREVIEW") !== (value.preview !== null))
      ctx.addIssue({ code: "custom", message: "Invalid preview availability" });
  });
