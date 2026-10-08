import { describe, expect, it } from "vitest";
import { anchorCommercialVisualReading } from "./visual-reading-evidence";
import type {
  CommercialPdfPage,
  CommercialVisualPageOutput,
} from "@fl-copilot/domain";
const page: CommercialPdfPage = {
  pageNumber: 1,
  width: 800,
  height: 600,
  rotation: 0,
  text: "DRAMATISATION RAISIN Prix public : Moins de 2,20€ le kg Jours de vente : jeudi 8, vendredi 9 et samedi 10 octobre",
  spans: [],
  warnings: [],
};
function output(): CommercialVisualPageOutput {
  return {
    operations: [
      {
        kind: "DRAMAT",
        label: "RAISIN",
        summaryFr: "Offre de raisin à moins de 2,20€ le kg.",
        fields: [],
        evidence: [
          { pageNumber: 1, quote: "DRAMATISATION RAISIN", region: null },
        ],
        items: [
          {
            kind: "OFFER",
            label: "RAISIN",
            fields: [
              {
                name: "sellingPrice",
                rawValue: "Moins de 2,20€ le kg",
                confidence: 0.9,
                evidence: [
                  {
                    pageNumber: 1,
                    quote: "Prix public : Moins de 2,20€ le kg",
                    region: null,
                  },
                ],
              },
            ],
            evidence: [{ pageNumber: 1, quote: "RAISIN", region: null }],
          },
        ],
      },
    ],
    tgIdeas: [],
    otherInformation: [],
    warnings: [],
  };
}
describe("visual PDF source proposals", () => {
  it("retains operation-product hierarchy and strict price wording without publication", () => {
    const input = output(),
      before = JSON.stringify(input);
    const result = anchorCommercialVisualReading(input, 1, [page]);
    expect(result.operations[0]?.items[0]?.fields[0]).toMatchObject({
      rawValue: "Moins de 2,20€ le kg",
      validationStatus: "TO_VALIDATE",
      evidence: [{ verification: "TEXT_SUPPORTED" }],
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(result.operations[0]?.validationStatus).toBe("TO_VALIDATE");
  });
  it("retains an image-only identifier as an explicitly unverified visual reading", () => {
    const input = output();
    input.operations[0]!.items[0]!.fields = [
      {
        name: "productIdentifier",
        rawValue: "04274",
        confidence: 0.98,
        evidence: [
          {
            pageNumber: 1,
            quote: "PLU 04274",
            region: { left: 0.7, top: 0.1, right: 0.9, bottom: 0.3 },
          },
        ],
      },
    ];
    const field = anchorCommercialVisualReading(input, 1, [page]).operations[0]
      ?.items[0]?.fields[0];
    expect(field).toMatchObject({
      rawValue: "04274",
      validationStatus: "TO_VALIDATE",
      evidence: [{ verification: "VISUAL_TO_VERIFY" }],
    });
  });
  it("does not trust a value contradicted by its own citation", () => {
    const input = output();
    input.operations[0]!.items[0]!.fields[0]!.rawValue = "9";
    input.operations[0]!.items[0]!.fields[0]!.evidence[0]!.quote = "Prix 2,99€";
    const result = anchorCommercialVisualReading(input, 1, [page]);
    expect(result.operations[0]?.items[0]?.fields[0]).toMatchObject({
      rawValue: null,
      confidence: 0,
    });
    expect(result.warnings).toHaveLength(1);
  });
  it("preserves a shared printed month in a proposed date without inventing a year", () => {
    const input = output();
    input.operations[0]!.fields = [
      {
        name: "saleStart",
        rawValue: "jeudi 8 octobre",
        confidence: 0.9,
        evidence: [
          {
            pageNumber: 1,
            quote: "Jours de vente : jeudi 8, vendredi 9 et samedi 10 octobre",
            region: null,
          },
        ],
      },
    ];
    expect(
      anchorCommercialVisualReading(input, 1, [page]).operations[0]?.fields[0]
        ?.rawValue,
    ).toBe("jeudi 8 octobre");
    input.operations[0]!.fields[0]!.rawValue = "jeudi 8 octobre 2026";
    expect(
      anchorCommercialVisualReading(input, 1, [page]).operations[0]?.fields[0]
        ?.rawValue,
    ).toBeNull();
  });
  it("refuses references outside the source and reversed image regions", () => {
    const input = output();
    input.operations[0]!.evidence[0]!.pageNumber = 2;
    expect(() => anchorCommercialVisualReading(input, 1, [page])).toThrow();
    input.operations[0]!.evidence[0]!.pageNumber = 1;
    input.operations[0]!.evidence[0]!.region = {
      left: 0.9,
      right: 0.2,
      top: 0,
      bottom: 1,
    };
    expect(() => anchorCommercialVisualReading(input, 1, [page])).toThrow(
      "VISUAL_REFERENCE_REGION_INVALID",
    );
  });
});
