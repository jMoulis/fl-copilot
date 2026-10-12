import { it, expect } from "vitest";
import { commercialMechanismDescription as describe } from "./mechanism-description";
it("keeps price ceilings, card benefit, threshold units and lots distinct", () => {
  expect(
    describe({
      type: "PRICE_CEILING",
      amount: 2,
      currency: "EUR",
      unit: "KG",
      operator: "LESS_THAN",
    }),
  ).toBe("Moins de 2 €/kg");
  expect(
    describe({
      type: "PRICE_CEILING",
      amount: 2,
      currency: "EUR",
      unit: "PIECE",
      operator: "LESS_THAN_OR_EQUAL",
    }),
  ).toBe("Au plus 2 €/pièce");
  expect(
    describe({ type: "FIXED_PRICE", amount: 2, currency: "EUR", unit: "PACK" }),
  ).toBe("2 €/unité conditionnée");
  expect(
    describe({
      type: "CARD_BENEFIT",
      benefitType: "PERCENT",
      value: 10,
      scope: null,
    }),
  ).toBe("10 % avantage carte");
  expect(
    describe({
      type: "THRESHOLD_PRICE",
      basePrice: 3,
      thresholdPrice: 2,
      thresholdQuantity: 2,
      thresholdUnit: "PIECE",
      priceUnit: "KG",
    }),
  ).toBe("3 puis 2 €/kg dès 2 pièce");
  expect(
    describe({
      type: "LOT",
      lotQuantity: 2,
      totalPrice: 3,
      unitPrice: null,
      unit: "PIECE",
    }),
  ).toBe("Lot de 2 pièce · 3 € le lot");
  expect(
    describe({
      type: "LOT",
      lotQuantity: 2,
      totalPrice: 3,
      unitPrice: 1.5,
      unit: "PACK",
    }),
  ).toBe("Lot de 2 unité conditionnée · 3 € le lot · 1,5 € par unité");
});
