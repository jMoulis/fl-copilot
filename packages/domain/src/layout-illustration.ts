import { z } from "zod";
export const LAYOUT_ILLUSTRATION_RENDERER = "layout-topdown-v1";
const id = z.uuid(),
  hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
/** Immutable user-owned preparation. It grants no provider/billing authorization. */
export const layoutIllustrationPreparationSchema = z.strictObject({
  id,
  storeId: id,
  ownerId: id,
  conversationId: id,
  version: z.literal(1),
  intent: z.literal("PREPARATION_ONLY"),
  renderer: z.literal(LAYOUT_ILLUSTRATION_RENDERER),
  scenarioMessageId: id,
  assistantMessageId: id,
  scenarioHash: hash,
  physicalRevisionId: id,
  physicalVersion: z.number().int().positive(),
  physicalHash: hash,
  createdAt: z.iso.datetime(),
});
export type LayoutIllustrationPreparation = z.infer<
  typeof layoutIllustrationPreparationSchema
>;
export function sameLayoutIllustrationPreparation(
  a: LayoutIllustrationPreparation,
  b: LayoutIllustrationPreparation,
) {
  return (
    JSON.stringify(layoutIllustrationPreparationSchema.parse(a)) ===
    JSON.stringify(layoutIllustrationPreparationSchema.parse(b))
  );
}
