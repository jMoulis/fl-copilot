import { randomUUID } from "node:crypto";
import {
  productSchema,
  layoutScenarioInputSchema,
} from "../packages/domain/src/index";
import { layoutFixture, nextLayout } from "./test-store-layout-fixtures";
import { commercialChoiceFixture } from "./test-commercial-choice-fixtures";
export async function layoutScenarioFixture(storeId?: string) {
  const choice = await commercialChoiceFixture({ storeId });
  const first = layoutFixture(choice.storeId),
    id = randomUUID(),
    reference = nextLayout(first, {
      revisionId: id,
      referenceRevisionId: id,
      action: "ADOPT_REFERENCE",
    });
  const product = productSchema.parse({
      ...choice.product,
      id: randomUUID(),
      label: "BANANE VRAC",
    }),
    fixed = reference.content.furniture.find((f) => f.kind === "FIXED")!,
    tg = reference.content.furniture.find((f) => f.kind === "TG")!,
    surface = reference.content.surfaces.find(
      (s) => s.furnitureId === fixed.id && s.kind === "BAC",
    )!;
  const sources = {
    layout: { head: reference, reference },
    products: [choice.product, product],
    choices: [choice.choice],
  };
  const input = layoutScenarioInputSchema.parse({
    expectedRevisionId: reference.revisionId,
    weekStart: "2026-10-05",
    title: "Proposition du rayon",
    assignments: [
      {
        furnitureId: fixed.id,
        surfaceId: surface.id,
        items: [{ kind: "PRODUCT", id: product.id }],
        reason: "Conserver un repère simple pour les achats courants.",
      },
      {
        furnitureId: tg.id,
        surfaceId: null,
        items: [{ kind: "OFFER", id: choice.choice.id }],
        reason: "Rendre l’offre visible pendant ses dates de vente.",
      },
    ],
    assumptions: [
      "Proposition à adapter aux observations terrain, sans stock connu.",
    ],
  });
  return {
    input,
    sources,
    reference,
    first,
    choice,
    product,
    fixed,
    tg,
    surface,
  };
}
