import { it, expect } from "vitest";
import { makeCommercialChoiceFixture } from "../../../scripts/commercial-choice-fixture-data";
import {
  commercialValidatedOfferSchema,
  type CommercialWeekPreparation,
  type CommercialValidatedOffer,
} from "@fl-copilot/domain";
import {
  commercialValidatedOfferId,
  commercialOfferValidationSource,
  commercialOfferValidationCurrent,
  commercialPreparationReadiness,
} from "./offer-validation";
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  digest = async (s: string) =>
    JSON.parse(s).at(-1) === 2 ? "b".repeat(64) : "a".repeat(64);
async function fixture() {
  const f = await makeCommercialChoiceFixture({}, digest, uuid);
  const v: CommercialValidatedOffer = {
    id: await commercialValidatedOfferId(f.storeId, f.choice.id, 1, digest),
    storeId: f.storeId,
    choice: f.choice,
    ...commercialOfferValidationSource(f.choice, [f.reading]),
    status: "VALIDATED",
    sourceReviewed: true,
    version: 1,
    createdAt: f.choice.createdAt,
  };
  const plan: CommercialWeekPreparation = {
    id: uuid(),
    storeId: f.storeId,
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    status: "DRAFT",
    tgCapacity: 1,
    offerRefs: [{ choiceId: f.choice.id, choiceVersion: 1 }],
    placements: [],
    note: "",
    version: 1,
    createdAt: f.choice.createdAt,
    updatedAt: f.choice.createdAt,
  };
  return { f, v, plan };
}
it("pins one choice revision without turning a strict ceiling into a fixed price or supplier terms into customer prices", async () => {
  const { f, v } = await fixture();
  expect(commercialValidatedOfferSchema.parse(v).choice.mechanism).toEqual(
    f.choice.mechanism,
  );
  expect(
    await commercialValidatedOfferId(f.storeId, f.choice.id, 2, digest),
  ).not.toBe(v.id);
  expect(commercialOfferValidationCurrent(v, { ...f.choice, version: 2 })).toBe(
    false,
  );
  expect(
    commercialOfferValidationCurrent(v, { ...f.choice, status: "WITHDRAWN" }),
  ).toBe(false);
  expect(
    commercialValidatedOfferSchema.safeParse({ ...v, status: "EXECUTED" })
      .success,
  ).toBe(false);
  expect(commercialOfferValidationCurrent(v, f.choice)).toBe(true);
});
it("keeps null source conditions/citations and rejects source/store mismatches", async () => {
  const { f } = await fixture();
  f.reading.reading!.operations[0]!.fields.push({
    name: "supplierCondition",
    rawValue: null,
    confidence: 0,
    evidence: [],
    validationStatus: "TO_VALIDATE",
  });
  const s = commercialOfferValidationSource(f.choice, [f.reading]);
  expect(
    s.sourceFields.find((f) => f.name === "supplierCondition")?.rawValue,
  ).toBeNull();
  expect(s.evidence.length).toBeGreaterThan(0);
  expect(() =>
    commercialOfferValidationSource({ ...f.choice, storeId: uuid() }, [
      f.reading,
    ]),
  ).toThrow("SOURCE_INVALID");
});
it("identifies stale/withdrawn offers, unvalidated revisions and empty TGs without altering the draft", async () => {
  const { f, v, plan } = await fixture(),
    before = JSON.stringify(plan);
  expect(
    commercialPreparationReadiness(plan, [f.choice], []).map((i) => i.code),
  ).toEqual(["NOT_VALIDATED"]);
  expect(commercialPreparationReadiness(plan, [f.choice], [v])).toEqual([]);
  expect(
    commercialPreparationReadiness(plan, [{ ...f.choice, version: 2 }], [v])[0]
      ?.code,
  ).toBe("CHANGED");
  expect(
    commercialPreparationReadiness(
      {
        ...plan,
        placements: [
          {
            id: uuid(),
            label: "TG entrée",
            theme: "",
            offerIds: [],
            sourceIdea: null,
          },
        ],
      },
      [f.choice],
      [v],
    )[0]?.code,
  ).toBe("EMPTY_TG");
  expect(JSON.stringify(plan)).toBe(before);
});
it("surfaces preferred-source differences and genuinely competing fixed prices without comparing incompatible units or ceilings", async () => {
  const { f, v, plan } = await fixture();
  const preference = {
    id: uuid(),
    storeId: f.storeId,
    before: {
      documentId: f.sourceDocumentId,
      checksum: f.reading.checksum,
      readingIds: [f.reading.id],
    },
    after: { documentId: uuid(), checksum: "new", readingIds: [uuid()] },
    preference: "PREFER_NEW" as const,
    comparisonReviewed: true as const,
    note: "",
    version: 1,
    createdAt: f.choice.createdAt,
    updatedAt: f.choice.updatedAt,
  };
  expect(
    commercialPreparationReadiness(plan, [f.choice], [v], [preference])[0]
      ?.code,
  ).toBe("SOURCE_REFERENCE_REVIEW");
  const a = {
      ...f.choice,
      mechanism: {
        type: "FIXED_PRICE" as const,
        amount: 2,
        currency: "EUR" as const,
        unit: "KG" as const,
      },
    },
    b = { ...a, id: uuid(), mechanism: { ...a.mechanism, amount: 3 } },
    p = {
      ...plan,
      offerRefs: [...plan.offerRefs, { choiceId: b.id, choiceVersion: 1 }],
    };
  expect(
    commercialPreparationReadiness(p, [a, b], []).filter(
      (i) => i.code === "CONFLICTING_FIXED_PRICE",
    ),
  ).toHaveLength(2);
  expect(
    commercialPreparationReadiness(
      p,
      [a, { ...b, mechanism: { ...b.mechanism, unit: "PIECE" } }],
      [],
    ).filter((i) => i.code === "CONFLICTING_FIXED_PRICE"),
  ).toHaveLength(0);
  expect(
    commercialPreparationReadiness(
      p,
      [
        f.choice,
        {
          ...b,
          mechanism: {
            type: "PRICE_CEILING",
            currency: "EUR",
            unit: "KG",
            operator: "LESS_THAN",
            amount: 3,
          },
        },
      ],
      [],
    ).filter((i) => i.code === "CONFLICTING_FIXED_PRICE"),
  ).toHaveLength(0);
});
