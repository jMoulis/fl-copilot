import { describe, expect, it } from "vitest";
import { normalizeCommercialMechanisms as normalize } from "./mechanism-normalization";
describe("commercial mechanism normalization", () => {
  it("preserves strict and inclusive ceilings and decimal commas", () => {
    expect(normalize({ sellingPrice: "< 2,60 €/kg" }).mechanism).toEqual({
      type: "PRICE_CEILING",
      operator: "LESS_THAN",
      amount: 2.6,
      currency: "EUR",
      unit: "KG",
    });
    expect(
      normalize({ sellingPrice: "2,60 €/kg", priceOperator: "≤" }).mechanism,
    ).toMatchObject({ operator: "LESS_THAN_OR_EQUAL" });
    expect(normalize({ sellingPrice: "0 €/pièce" }).mechanism).toMatchObject({
      type: "FIXED_PRICE",
      amount: 0,
      unit: "PIECE",
    });
  });
  it("retains both threshold prices and the explicit quantity", () => {
    expect(
      normalize({ customerMechanism: "3,49 €/kg ; 2,99 €/kg à partir de 1 kg" })
        .mechanism,
    ).toEqual({
      type: "THRESHOLD_PRICE",
      basePrice: 3.49,
      thresholdPrice: 2.99,
      thresholdQuantity: 1,
      thresholdUnit: "KG",
      priceUnit: "KG",
    });
    expect(
      normalize({ customerMechanism: "3,49 €/kg ; 2,99 €/kg à partir de 0 kg" })
        .mechanism,
    ).toBeNull();
  });
  it("keeps supplier discounts separate and does not compute a card till price", () => {
    const result = normalize({
      sellingPrice: "2,99 €/kg",
      customerMechanism: "20% avantage carte",
      supplierCondition: "Remise fournisseur 10%",
      purchasePrice: "1,50 €/kg",
    });
    expect(result.mechanism).toEqual({
      type: "CARD_BENEFIT",
      benefitType: "PERCENT",
      value: 20,
      scope: null,
    });
    expect(result.purchaseCondition).toMatchObject({
      purchasePrice: 1.5,
      supplierDiscountPct: 10,
    });
    expect(result.raw.sellingPrice).toBe("2,99 €/kg");
    expect(
      normalize({ supplierCondition: "Remise fournisseur 20%" }).mechanism,
    ).toBeNull();
    expect(result.status).toBe("TO_VALIDATE");
  });
  it("never invents a lot unit price or turns missing values into zero", () => {
    expect(
      normalize({ customerMechanism: "Lot de 3 pièces pour 5,99 €" }).mechanism,
    ).toMatchObject({
      type: "LOT",
      lotQuantity: 3,
      totalPrice: 5.99,
      unitPrice: null,
    });
    expect(
      normalize({ customerMechanism: "Lot de 3 packs" }).mechanism,
    ).toMatchObject({ totalPrice: null, unitPrice: null, unit: "PACK" });
    expect(normalize({}).mechanism).toBeNull();
  });
  it.each([
    { sellingPrice: "< 2,60 €/kg", priceOperator: "=" },
    { sellingPrice: "2,60" },
    { sellingPrice: "2,60 €/kg et 3,20 €/pièce" },
    { sellingPrice: "2,60 €/kg", customerMechanism: "2 achetés 1 offert" },
    { customerMechanism: "120% carte" },
    { customerMechanism: "lot de 0 pièces" },
    { customerMechanism: "3,49 €/kg ; 2,99 €/pièce à partir de 1 kg" },
  ])("retains ambiguous content for review: %j", (input) => {
    const result = normalize(input);
    expect(result.mechanism).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.raw).toEqual(input);
  });
});

import { normalizeCommercialDraftMechanisms } from "./mechanism-normalization";
it("projects only anchored offers without mutating drafts or borrowing sales units for purchase prices", () => {
  const draft = {
    blocks: [
      {
        kind: "OFFER",
        sourceBlockIndex: 9,
        fields: [
          {
            name: "sellingPrice",
            rawValue: "2,99 €",
            validationStatus: "TO_VALIDATE" as const,
          },
          {
            name: "salesUnit",
            rawValue: "kg",
            validationStatus: "TO_VALIDATE" as const,
          },
          {
            name: "purchasePrice",
            rawValue: "1,50 €",
            validationStatus: "TO_VALIDATE" as const,
          },
        ],
      },
      { kind: "OPERATION", sourceBlockIndex: 10, fields: [] },
    ],
  };
  const original = JSON.stringify(draft);
  const result = normalizeCommercialDraftMechanisms(draft);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    sourceBlockIndex: 9,
    status: "TO_VALIDATE",
    mechanism: { type: "FIXED_PRICE", amount: 2.99, unit: "KG" },
    purchaseCondition: { purchasePrice: null },
  });
  expect(JSON.stringify(draft)).toBe(original);
});

it("supports explicit French source wording without changing ceiling meaning", () => {
  expect(
    normalize({
      sellingPrice: "Moins de 2,20€ le kg",
      priceOperator: "Moins de",
    }).mechanism,
  ).toMatchObject({
    type: "PRICE_CEILING",
    operator: "LESS_THAN",
    amount: 2.2,
    unit: "KG",
  });
  expect(
    normalize({
      sellingPrice: "1,89€ le kg",
      customerMechanism: "PVC à partir de 1 kg : 1,59€ le kg",
    }).mechanism,
  ).toMatchObject({
    type: "THRESHOLD_PRICE",
    basePrice: 1.89,
    thresholdPrice: 1.59,
    thresholdQuantity: 1,
    thresholdUnit: "KG",
  });
  const result = normalizeCommercialDraftMechanisms({
    blocks: [
      {
        kind: "OFFER",
        sourceBlockIndex: 1,
        fields: [
          {
            name: "sellingPrice",
            rawValue: "0,80€",
            validationStatus: "TO_VALIDATE",
          },
          {
            name: "salesUnit",
            rawValue: "la pièce",
            validationStatus: "TO_VALIDATE",
          },
        ],
      },
    ],
  });
  expect(result[0]?.mechanism).toMatchObject({
    type: "FIXED_PRICE",
    amount: 0.8,
    unit: "PIECE",
  });
  expect(
    normalize({ sellingPrice: "Moins de 1,80€ le filet de 3kg" }).mechanism,
  ).toBeNull();
});
