import { makeCommercialChoiceFixture } from "./commercial-choice-fixture-data";
import {
  commercialValidatedOfferId,
  commercialWeekPreparationId,
  commercialOfferValidationSource,
  buildCommercialWeekPlan,
  type CommercialPlanContext,
} from "../packages/commercial-core/src/index";
import type {
  CommercialValidatedOffer,
  CommercialWeekPreparation,
} from "../packages/domain/src/index";
export async function makeCommercialPlanFixture(
  digest: (s: string) => Promise<string>,
  uuid: () => string,
) {
  const f = await makeCommercialChoiceFixture({}, digest, uuid);
  const validated: CommercialValidatedOffer = {
    id: await commercialValidatedOfferId(f.storeId, f.choice.id, 1, digest),
    storeId: f.storeId,
    choice: f.choice,
    ...commercialOfferValidationSource(f.choice, [f.reading]),
    status: "VALIDATED",
    sourceReviewed: true,
    version: 1,
    createdAt: f.choice.createdAt,
  };
  const preparation: CommercialWeekPreparation = {
    id: await commercialWeekPreparationId(f.storeId, "2026-10-05", digest),
    storeId: f.storeId,
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    status: "DRAFT",
    tgCapacity: 1,
    offerRefs: [{ choiceId: f.choice.id, choiceVersion: 1 }],
    placements: [
      {
        id: uuid(),
        label: "TG entrée",
        theme: "Raisin",
        offerIds: [f.choice.id],
        sourceIdea: null,
      },
    ],
    note: "",
    version: 1,
    createdAt: f.choice.createdAt,
    updatedAt: f.choice.updatedAt,
  };
  const context: CommercialPlanContext = {
    preparation,
    choices: [f.choice],
    validated: [validated],
    preferences: [],
    products: [
      { id: f.product.id, label: f.product.label, version: f.product.version },
    ],
    pages: [f.reading],
  };
  const plan = await buildCommercialWeekPlan(
    {
      preparation,
      version: 1,
      createdAt: f.choice.createdAt,
      validatedAt: f.choice.createdAt,
    },
    context,
    digest,
  );
  return { ...f, validated, preparation, context, plan };
}
