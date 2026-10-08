import { describe, it, expect } from "vitest";
import {
  commercialChoiceId,
  commercialChoiceDuplicateKey,
  commercialOfferProposal,
  commercialChoiceProductUnitMatches,
} from "./offer-choice";
import { commercialOfferChoiceSchema } from "@fl-copilot/domain";
import { makeCommercialChoiceFixture } from "../../../scripts/commercial-choice-fixture-data";
let ordinal = 0;
const testChoiceDigest = async (text: string) =>
  JSON.parse(text).at(-1) === 0 ? "a".repeat(64) : "b".repeat(64);
const commercialChoiceFixture = () =>
  makeCommercialChoiceFixture(
    {},
    testChoiceDigest,
    () => `00000000-0000-4000-8000-${String(++ordinal).padStart(12, "0")}`,
  );
describe("retained commercial offer choices", () => {
  it("keeps the same stable source UUID across devices and revisions, with distinct source items", async () => {
    const f = await commercialChoiceFixture();
    expect(
      await commercialChoiceId(f.storeId, f.choice.source, testChoiceDigest),
    ).toBe(f.choice.id);
    expect(
      await commercialChoiceId(
        f.storeId,
        { ...f.choice.source, itemIndex: 1 },
        testChoiceDigest,
      ),
    ).not.toBe(f.choice.id);
    expect(
      commercialOfferChoiceSchema.parse({
        ...f.choice,
        status: "WITHDRAWN",
        version: 2,
      }).id,
    ).toBe(f.choice.id);
  });
  it("proposes cited dates and a strict ceiling without changing source facts or choosing a product", async () => {
    const f = await commercialChoiceFixture(),
      before = JSON.stringify(f.raw);
    const proposal = commercialOfferProposal(
      f.raw.operations[0]!,
      f.raw.operations[0]!.items[0]!,
    );
    expect(proposal).toMatchObject({
      saleStart: "2026-10-08",
      saleEnd: "2026-10-10",
      mechanism: {
        type: "PRICE_CEILING",
        operator: "LESS_THAN",
        amount: 2.2,
        unit: "KG",
      },
    });
    expect(JSON.stringify(f.raw)).toBe(before);
    f.raw.operations[0]!.fields = [];
    expect(
      commercialOfferProposal(
        f.raw.operations[0]!,
        f.raw.operations[0]!.items[0]!,
      ).saleStart,
    ).toBe("");
  });
  it("requires explicit applicability and critical-field confirmations and real dates", async () => {
    const { choice } = await commercialChoiceFixture();
    for (const patch of [
      { applicabilityConfirmed: false },
      { criticalFieldsConfirmed: false },
      { saleStart: "2026-02-31" },
      { saleEnd: "2026-10-01" },
      { productId: "" },
    ])
      expect(
        commercialOfferChoiceSchema.safeParse({ ...choice, ...patch }).success,
      ).toBe(false);
  });
  it("preserves all five mechanics, rejects impossible card rates and missing lot prices", async () => {
    const { choice } = await commercialChoiceFixture();
    for (const mechanism of [
      { type: "FIXED_PRICE", amount: 0, currency: "EUR", unit: "PIECE" },
      {
        type: "PRICE_CEILING",
        amount: 2.2,
        currency: "EUR",
        unit: "KG",
        operator: "LESS_THAN_OR_EQUAL",
      },
      { type: "CARD_BENEFIT", benefitType: "PERCENT", value: 20, scope: null },
      {
        type: "THRESHOLD_PRICE",
        basePrice: 2,
        thresholdPrice: 1.5,
        thresholdQuantity: 2,
        thresholdUnit: "KG",
        priceUnit: "KG",
      },
      {
        type: "LOT",
        lotQuantity: 3,
        totalPrice: 5,
        unitPrice: null,
        unit: "PIECE",
      },
    ])
      expect(
        commercialOfferChoiceSchema.safeParse({ ...choice, mechanism }).success,
      ).toBe(true);
    expect(
      commercialOfferChoiceSchema.safeParse({
        ...choice,
        mechanism: {
          type: "CARD_BENEFIT",
          benefitType: "PERCENT",
          value: 101,
          scope: null,
        },
      }).success,
    ).toBe(false);
    expect(
      commercialOfferChoiceSchema.safeParse({
        ...choice,
        mechanism: {
          type: "LOT",
          lotQuantity: 3,
          totalPrice: null,
          unitPrice: null,
          unit: "PIECE",
        },
      }).success,
    ).toBe(false);
  });
  it("detects equal detail/recap terms without merging different price operators or periods", async () => {
    const { choice } = await commercialChoiceFixture();
    const recap = {
      ...choice,
      source: { ...choice.source, itemIndex: 1 },
      version: 2,
    };
    expect(commercialChoiceDuplicateKey(recap)).toBe(
      commercialChoiceDuplicateKey(choice),
    );
    expect(
      commercialChoiceDuplicateKey({
        ...choice,
        operationLabel: "Another explicit campaign",
      }),
    ).not.toBe(commercialChoiceDuplicateKey(choice));
    expect(
      commercialChoiceDuplicateKey({
        ...choice,
        mechanism: {
          type: "FIXED_PRICE",
          amount: 2.2,
          currency: "EUR",
          unit: "KG",
        },
      }),
    ).not.toBe(commercialChoiceDuplicateKey(choice));
    expect(
      commercialChoiceDuplicateKey({ ...choice, saleEnd: "2026-10-11" }),
    ).not.toBe(commercialChoiceDuplicateKey(choice));
  });
  it("identifies different source/product units without demanding missing product metadata", async () => {
    const { choice } = await commercialChoiceFixture();
    expect(commercialChoiceProductUnitMatches(choice, "UNKNOWN")).toBe(true);
    expect(commercialChoiceProductUnitMatches(choice, "KG")).toBe(true);
    expect(commercialChoiceProductUnitMatches(choice, "PIECE")).toBe(false);
    expect(
      commercialOfferChoiceSchema.safeParse({
        ...choice,
        mechanism: {
          type: "LOT",
          lotQuantity: 3,
          totalPrice: 5,
          unitPrice: 2,
          unit: "PIECE",
        },
      }).success,
    ).toBe(false);
    expect(
      commercialOfferChoiceSchema.safeParse({
        ...choice,
        mechanism: {
          type: "LOT",
          lotQuantity: 3,
          totalPrice: 5,
          unitPrice: 1.67,
          unit: "PIECE",
        },
      }).success,
    ).toBe(true);
  });
  it("does not replace an explicitly unknown child date or operator with a parent/default value", async () => {
    const f = await commercialChoiceFixture(),
      op = f.raw.operations[0]!,
      item = op.items[0]!;
    item.fields.push({
      name: "saleStart",
      rawValue: null,
      confidence: 0,
      evidence: [],
    });
    item.fields.find((field) => field.name === "priceOperator")!.rawValue =
      null;
    const proposal = commercialOfferProposal(op, item);
    expect(proposal.saleStart).toBe("");
    expect(proposal.mechanism).toBeNull();
  });
});
