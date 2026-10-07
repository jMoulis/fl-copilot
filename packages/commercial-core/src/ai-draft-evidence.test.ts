import { describe, expect, it } from "vitest";
import type {
  CommercialAiPageOutput,
  CommercialPdfPage,
} from "@fl-copilot/domain";
import {
  anchorCommercialAiDraft,
  selectCommercialAiContext,
} from "./ai-draft-evidence";
const text = "TOMATE VRAC < 2,99 €/kg du 7 au 10 octobre ITM8 00001234";
const page: CommercialPdfPage = {
  pageNumber: 1,
  width: 600,
  height: 800,
  rotation: 0,
  text,
  warnings: [],
  spans: [
    {
      index: 0,
      text,
      transform: [1, 0, 0, 1, 10, 10],
      width: 300,
      height: 12,
      direction: "ltr",
      hasEndOfLine: true,
    },
  ],
};
const evidence = { pageNumber: 1, spanIndices: [0], quote: text };
function output(): CommercialAiPageOutput {
  return {
    blocks: [
      {
        kind: "OFFER",
        label: "TOMATE VRAC",
        evidence: [evidence],
        fields: [
          {
            name: "sellingPrice",
            rawValue: "2,99",
            confidence: 0.99,
            evidence: [evidence],
          },
          {
            name: "priceOperator",
            rawValue: "<",
            confidence: 0.99,
            evidence: [evidence],
          },
          {
            name: "productIdentifier",
            rawValue: "00001234",
            confidence: 0.99,
            evidence: [evidence],
          },
          {
            name: "saleStart",
            rawValue: "7",
            confidence: 0.99,
            evidence: [evidence],
          },
        ],
      },
    ],
    warnings: [],
  };
}
describe("commercial draft source evidence", () => {
  it("retains literal comma prices, strict operators, leading zeroes and date uncertainty without accepting them", () => {
    const result = anchorCommercialAiDraft(output(), 1, [page]);
    expect(result.blocks[0]?.fields.map((field) => field.rawValue)).toEqual([
      "2,99",
      "<",
      "00001234",
      "7",
    ]);
    expect(result.blocks[0]?.validationStatus).toBe("TO_VALIDATE");
    expect(
      result.blocks[0]?.fields.every(
        (field) => field.validationStatus === "TO_VALIDATE",
      ),
    ).toBe(true);
    expect(result.warnings).toContain("UNCERTAIN_DATE");
  });
  it("rejects invented quotes, unavailable span IDs and blocks from another target page", () => {
    for (const bad of [
      { ...evidence, quote: "BANANE 9,99" },
      { ...evidence, spanIndices: [999] },
      { ...evidence, pageNumber: 2 },
    ]) {
      const raw = output();
      raw.blocks[0]!.evidence = [bad];
      expect(anchorCommercialAiDraft(raw, 1, [page]).blocks).toEqual([]);
    }
  });
  it("does not turn a digit inside a price into another proposed amount", () => {
    const raw = output();
    raw.blocks[0]!.fields[0]!.rawValue = "9";
    const result = anchorCommercialAiDraft(raw, 1, [page]);
    expect(result.blocks[0]?.fields[0]).toMatchObject({
      rawValue: null,
      confidence: 0,
      evidence: [],
      validationStatus: "TO_VALIDATE",
    });
    expect(result.issues[0]?.code).toBe("UNSUPPORTED_FIELD");
  });
  it("nulls conflicting duplicate fields while preserving source identifiers as text", () => {
    const raw = output();
    raw.blocks[0]!.fields.push({ ...raw.blocks[0]!.fields[0]! });
    const result = anchorCommercialAiDraft(raw, 1, [page]);
    expect(
      result.blocks[0]?.fields
        .filter((field) => field.name === "sellingPrice")
        .every((field) => field.rawValue === null),
    ).toBe(true);
    expect(
      result.issues.filter((issue) => issue.code === "DUPLICATE_FIELD"),
    ).toHaveLength(2);
  });
  it("never reads context that was omitted by the request budget", () => {
    const context = selectCommercialAiContext(
      page,
      [page, { ...page, pageNumber: 2 }],
      300,
    );
    expect(context.map((item) => item.pageNumber)).toEqual([1]);
    expect(() => selectCommercialAiContext(page, [page], 1)).toThrow(
      "COMMERCIAL_AI_PAGE_SIZE_LIMIT",
    );
  });
});
