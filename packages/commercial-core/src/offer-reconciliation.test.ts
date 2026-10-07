import { describe, expect, it } from "vitest";
import type { CommercialOfferCandidate } from "@fl-copilot/domain";
import { reconcileCommercialOffers as reconcile } from "./offer-reconciliation";
const source = "514f6959-9bcb-4221-aa57-13bce04f055c";
const store = "12345678-1234-4234-8234-123456789012";
function offer(
  pageNumber = 1,
  overrides: Partial<CommercialOfferCandidate> = {},
): CommercialOfferCandidate {
  return {
    storeId: store,
    sourceDocumentId: source,
    pageNumber,
    sourceBlockIndex: 0,
    operationKey: "Semaine 40",
    productId: null,
    rawProductLabel: "POIRE CONFERENCE VRAC",
    productIdentifiers: ["00012345"],
    saleStart: "26/09/2026",
    saleEnd: "02/10/2026",
    mechanism: {
      type: "FIXED_PRICE",
      amount: 2.99,
      currency: "EUR",
      unit: "KG",
    },
    purchaseCondition: null,
    rawMechanism: null,
    rawPriceOperator: null,
    rawSalesUnit: null,
    rawPurchasePrice: null,
    rawSellingPrice: "2,99 €/kg",
    evidence: [
      {
        pageNumber,
        spanIndices: [0],
        quote: "POIRE CONFERENCE VRAC 2,99 €/kg",
      },
    ],
    ...overrides,
  };
}
describe("document offer reconciliation", () => {
  it("detail and recap become one draft variant with both source references", () => {
    const result = reconcile([offer(), offer(8)]);
    expect(result).toHaveLength(1);
    expect(result[0]?.variants).toHaveLength(1);
    expect(
      result[0]?.variants[0]?.sourceReferences.map((ref) => ref.pageNumber),
    ).toEqual([1, 8]);
    expect(result[0]?.status).toBe("TO_VALIDATE");
    expect(result[0]?.conflicts).toEqual([]);
  });
  it("preserves both price variants and reports a conflict", () => {
    const result = reconcile([
      offer(),
      offer(8, {
        mechanism: {
          type: "FIXED_PRICE",
          amount: 3.49,
          currency: "EUR",
          unit: "KG",
        },
      }),
    ]);
    expect(result[0]?.variants).toHaveLength(2);
    expect(result[0]?.conflicts).toEqual(["SELLING_MECHANISM_CONFLICT"]);
  });
  it("does not collapse strict ceiling into fixed price or inclusive ceiling", () => {
    for (const operator of ["LESS_THAN", "LESS_THAN_OR_EQUAL"] as const) {
      const result = reconcile([
        offer(),
        offer(8, {
          mechanism: {
            type: "PRICE_CEILING",
            operator,
            amount: 2.99,
            currency: "EUR",
            unit: "KG",
          },
        }),
      ]);
      expect(result[0]?.conflicts).toContain("SELLING_MECHANISM_CONFLICT");
    }
  });
  it("date differences remain conflicting without assigning a missing year", () => {
    const result = reconcile([
      offer(),
      offer(8, { saleStart: "27/09/2026" }),
      offer(5, { saleStart: null }),
    ]);
    expect(result[0]?.variants).toHaveLength(3);
    expect(result[0]?.conflicts).toEqual(["SALE_PERIOD_CONFLICT"]);
  });
  it("card benefit and independent selling price both matter", () => {
    const mechanism = {
      type: "CARD_BENEFIT" as const,
      benefitType: "PERCENT" as const,
      value: 20,
      scope: null,
    };
    const result = reconcile([
      offer(1, { mechanism }),
      offer(8, { mechanism, rawSellingPrice: "3,49 €/kg" }),
    ]);
    expect(result[0]?.conflicts).toContain("SELLING_MECHANISM_CONFLICT");
  });
  it("supplier conditions cannot overwrite each other", () => {
    const condition = {
      purchasePrice: 1.5,
      unit: "KG" as const,
      supplierDiscountPct: 10,
      minimumPurchaseQuantity: null,
      rawLabel: "Remise fournisseur 10%",
    };
    const result = reconcile([
      offer(1, { purchaseCondition: condition }),
      offer(8, {
        purchaseCondition: { ...condition, supplierDiscountPct: 20 },
      }),
    ]);
    expect(result[0]?.conflicts).toEqual(["PURCHASE_CONDITION_CONFLICT"]);
  });
  it("unsupported mechanisms are not matched through a null value", () => {
    const result = reconcile([
      offer(1, { mechanism: null, rawMechanism: "2 achetés 1 offert" }),
      offer(8, { mechanism: null, rawMechanism: "3 achetés 1 offert" }),
    ]);
    expect(result[0]?.conflicts).toEqual(["UNRESOLVED_MECHANISM_CONFLICT"]);
  });
  it("does not merge across stores, documents, operations or product identities", () => {
    for (const overrides of [
      { storeId: "22345678-1234-4234-8234-123456789012" },
      { sourceDocumentId: "22345678-1234-4234-8234-123456789012" },
      { operationKey: "Semaine 41" },
      { productIdentifiers: ["12345"] },
    ])
      expect(reconcile([offer(), offer(8, overrides)])).toHaveLength(2);
  });
  it("exact labels are a fallback, never fuzzy aliases or inferred identities", () => {
    expect(
      reconcile([
        offer(1, { productIdentifiers: [] }),
        offer(8, {
          productIdentifiers: [],
          rawProductLabel: " poire  conference vrac ",
        }),
      ]),
    ).toHaveLength(1);
    expect(
      reconcile([
        offer(1, { productIdentifiers: [] }),
        offer(8, {
          productIdentifiers: [],
          rawProductLabel: "POIRE QTEE VRAC",
        }),
      ]),
    ).toHaveLength(2);
    expect(
      reconcile([
        offer(1, { operationKey: null }),
        offer(8, { operationKey: null }),
      ]),
    ).toHaveLength(2);
    expect(
      reconcile([
        offer(1, { productIdentifiers: [], rawProductLabel: null }),
        offer(8, { productIdentifiers: [], rawProductLabel: null }),
      ]),
    ).toHaveLength(2);
  });
  it("is idempotent, order independent and does not mutate input", () => {
    const a = offer(),
      b = offer(8);
    const before = JSON.stringify([a, b]);
    expect(reconcile([b, a, a])).toEqual(reconcile([a, b]));
    expect(JSON.stringify([a, b])).toBe(before);
  });
  it("refuses contradictory payloads for the same source occurrence", () => {
    expect(() => reconcile([offer(), offer(1, { saleStart: null })])).toThrow(
      "COMMERCIAL_SOURCE_OCCURRENCE_CONFLICT",
    );
  });
});

import { reconcileCommercialDraftPages } from "./offer-reconciliation";
import type { AnchoredCommercialDraft } from "./ai-draft-evidence";
it("projects anchored page caches without declaring a matched product or editing source blocks", () => {
  const draft = (pageNumber: number): AnchoredCommercialDraft => ({
    warnings: [],
    issues: [],
    blocks: [
      {
        kind: "OFFER",
        label: "POIRE",
        sourceBlockIndex: 4,
        validationStatus: "TO_VALIDATE",
        evidence: [{ pageNumber, spanIndices: [0], quote: "POIRE 2,99 €/kg" }],
        fields: [
          {
            name: "productLabel",
            rawValue: "POIRE",
            confidence: 0.9,
            evidence: [],
            validationStatus: "TO_VALIDATE",
          },
          {
            name: "operationName",
            rawValue: "Semaine 40",
            confidence: 0.9,
            evidence: [],
            validationStatus: "TO_VALIDATE",
          },
          {
            name: "sellingPrice",
            rawValue: "2,99 €/kg",
            confidence: 0.9,
            evidence: [],
            validationStatus: "TO_VALIDATE",
          },
        ],
      },
    ],
  });
  const input = {
    storeId: store,
    sourceDocumentId: source,
    pages: [
      { pageNumber: 1, draft: draft(1) },
      { pageNumber: 8, draft: draft(8) },
    ],
  };
  const before = JSON.stringify(input);
  const result = reconcileCommercialDraftPages(input);
  expect(result).toHaveLength(1);
  expect(result[0]?.variants[0]?.sourceReferences).toHaveLength(2);
  expect(result[0]?.variants[0]?.occurrences[0]?.productId).toBeNull();
  expect(JSON.stringify(input)).toBe(before);
});

it("preserves distinct unsupported operators, units and supplier prices", () => {
  expect(
    reconcile([
      offer(1, { mechanism: null, rawPriceOperator: "<" }),
      offer(8, { mechanism: null, rawPriceOperator: "=" }),
    ])[0]?.conflicts,
  ).toContain("UNRESOLVED_MECHANISM_CONFLICT");
  expect(
    reconcile([
      offer(1, { mechanism: null, rawSalesUnit: "kg" }),
      offer(8, { mechanism: null, rawSalesUnit: "pièce" }),
    ])[0]?.conflicts,
  ).toContain("UNRESOLVED_MECHANISM_CONFLICT");
  expect(
    reconcile([
      offer(1, { rawPurchasePrice: "1,50 €" }),
      offer(8, { rawPurchasePrice: "2,50 €" }),
    ])[0]?.conflicts,
  ).toContain("PURCHASE_CONDITION_CONFLICT");
});
