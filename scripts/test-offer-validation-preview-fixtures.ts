import { commercialChoiceFixture } from "./test-commercial-choice-fixtures";
import { projectCommercialSourceOffer } from "../packages/commercial-core/src/source-offer";
export async function offerValidationPreviewFixture(storeId?: string) {
  const f = await commercialChoiceFixture({ ...(storeId ? { storeId } : {}) });
  return {
    f,
    input: { choiceIds: [f.choice.id] },
    basis: {
      storeId: f.storeId,
      entries: [
        {
          choice: f.choice,
          product: f.product,
          offer: projectCommercialSourceOffer(f.reading, 0, 0),
          validation: null,
        },
      ],
    },
  };
}
