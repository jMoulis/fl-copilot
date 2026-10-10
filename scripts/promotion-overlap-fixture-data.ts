import { makeCommercialPlanFixture } from "./commercial-plan-fixture-data";
import {
  buildCommercialWeekPlan,
  commercialChoiceId,
  commercialValidatedOfferId,
  commercialOfferValidationSource,
} from "../packages/commercial-core/src/index";
export async function makePromotionPairFixture(
  digest: (s: string) => Promise<string>,
  uuid: () => string,
) {
  const f = await makeCommercialPlanFixture(digest, uuid),
    candidate = { ...f.product, id: uuid(), label: "Raisin rouge" },
    source = { ...f.choice.source, operationIndex: 1 };
  const choice = {
    ...f.choice,
    id: await commercialChoiceId(f.storeId, source, digest),
    source,
    productId: candidate.id,
    operationKind: "OTHER" as const,
    operationLabel: "Action locale raisin rouge",
    rawProductLabel: candidate.label,
    mechanism: {
      type: "LOT" as const,
      lotQuantity: 2,
      totalPrice: 4,
      unitPrice: 2,
      unit: "PACK" as const,
    },
  };
  const op = f.reading.reading!.operations[0]!;
  f.reading.reading!.operations.push({
    ...op,
    kind: "OTHER",
    label: choice.operationLabel,
    fields: [
      ...op.fields,
      {
        name: "operationNature",
        rawValue: "LOCAL_ACTION",
        confidence: 1,
        validationStatus: "TO_VALIDATE",
        evidence: [
          {
            pageNumber: 1,
            quote: "Action locale raisin rouge",
            region: null,
            verification: "VISUAL_TO_VERIFY",
          },
        ],
      },
    ],
    items: [{ ...op.items[0]!, label: candidate.label }],
  });
  const validation = {
    ...f.validated,
    id: await commercialValidatedOfferId(f.storeId, choice.id, 1, digest),
    choice,
    ...commercialOfferValidationSource(choice, [f.reading]),
  };
  const preparation = {
    ...f.preparation,
    offerRefs: [
      ...f.preparation.offerRefs,
      { choiceId: choice.id, choiceVersion: 1 },
    ],
  };
  const context = {
    ...f.context,
    preparation,
    choices: [f.choice, choice],
    validated: [f.validated, validation],
    pages: [f.reading],
    products: [f.product, candidate].map(({ id, label, version }) => ({
      id,
      label,
      version,
    })),
  };
  const plan = await buildCommercialWeekPlan(
    {
      preparation,
      version: 1,
      createdAt: f.plan.createdAt,
      validatedAt: f.plan.validatedAt,
    },
    context,
    digest,
  );
  return {
    ...f,
    candidate,
    secondChoice: choice,
    secondValidation: validation,
    preparation,
    context,
    plan,
  };
}
