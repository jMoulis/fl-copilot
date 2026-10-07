import { describe, expect, it } from "vitest";
import type { SummaryPage, SummaryItem } from "./document-summary";
import {
  buildCommercialDocumentSummary as summary,
  commercialSummarySection,
} from "./document-summary";
const storeId = "11111111-1111-4111-8111-111111111111",
  sourceDocumentId = "22222222-2222-4222-8222-222222222222";
function block(
  index = 0,
  overrides: Partial<SummaryItem["block"]> = {},
): SummaryItem["block"] {
  return {
    kind: "EXECUTION_INSTRUCTION",
    label: "Préparer la mise en avant",
    sourceBlockIndex: index,
    validationStatus: "TO_VALIDATE",
    evidence: [
      { pageNumber: 1, spanIndices: [0], quote: "Préparer la mise en avant" },
    ],
    fields: [
      {
        name: "instruction",
        rawValue: "Préparer la mise en avant",
        confidence: 0.95,
        evidence: [
          {
            pageNumber: 1,
            spanIndices: [0],
            quote: "Préparer la mise en avant",
          },
        ],
        validationStatus: "TO_VALIDATE",
      },
    ],
    ...overrides,
  };
}
function page(
  blocks = [block()],
  overrides: Partial<SummaryPage> = {},
): SummaryPage {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    storeId,
    sourceDocumentId,
    checksum: "sha256:fixture",
    pageNumber: 1,
    pageCount: 1,
    blocks,
    warnings: [],
    issues: [],
    ...overrides,
  };
}
describe("source-based weekly document summary", () => {
  it("puts Dramat and prospectus first, then source TGs and weekly basics", () => {
    const result = summary([
      page([
        block(0, { kind: "OPERATION", label: "DRAMATISATION" }),
        block(1, { kind: "OPERATION", label: "PROSPECTUS ANNIVERSAIRE" }),
        block(2, { kind: "MERCHANDISING", label: "TG SPÉCIALE FRUITS" }),
        block(3, { kind: "OPERATION", label: "KITS À PRIX DÉGRESSIF" }),
        block(4, { kind: "OPERATION", label: "Préconisation de vente en lot" }),
      ]),
    ]);
    expect(
      result.sections.slice(0, 4).map((s) => [s.key, s.items.length]),
    ).toEqual([
      ["DRAMAT", 1],
      ["PROSPECTUS", 1],
      ["TG", 1],
      ["BASICS", 2],
    ]);
  });
  it("keeps four source TG ideas distinct without choosing four store locations", () => {
    const result = summary([
      page(
        ["FRUITS", "CRUDITÉS", "LÉGUMES À CUIRE", "POMMES"].map((name, i) =>
          block(i, { kind: "MERCHANDISING", label: `TG SPÉCIALE ${name}` }),
        ),
      ),
    ]);
    expect(result.tgCount).toBe(4);
    expect(result.sections.find((s) => s.key === "TG")?.items).toHaveLength(4);
    expect(
      summary([
        page([
          block(0, { kind: "MERCHANDISING", label: "TG SPÉCIALE FRUITS" }),
        ]),
      ]).tgCount,
    ).toBe(1);
  });
  it("does not attach every nearby offer to a prospectus or treat an affiche caption as an operation", () => {
    expect(
      commercialSummarySection(
        block(0, {
          kind: "COMMUNICATION",
          label: "AFFICHES PROSPECTUS / DRAMAT",
        }),
      ),
    ).toBe("INFORMATION");
    const result = summary([
      page([
        block(0, { kind: "OPERATION", label: "PROSPECTUS" }),
        block(1, { kind: "OFFER", label: "POIRE" }),
      ]),
    ]);
    expect(
      result.sections.find((s) => s.key === "PROSPECTUS")?.items,
    ).toHaveLength(1);
    expect(result.sections.find((s) => s.key === "OFFERS")?.items).toHaveLength(
      1,
    );
  });
  it("does not turn 140 informational extractions into 140 required reviews", () => {
    const pages = [
      page(
        Array.from({ length: 70 }, (_, i) => block(i)),
        { pageCount: 2 },
      ),
      page(
        Array.from({ length: 70 }, (_, i) => block(i)),
        {
          id: "44444444-4444-4444-8444-444444444444",
          pageNumber: 2,
          pageCount: 2,
        },
      ),
    ];
    const before = JSON.stringify(pages),
      result = summary(pages);
    expect(result.items).toHaveLength(140);
    expect(result.questions).toEqual([]);
    expect(JSON.stringify(pages)).toBe(before);
  });
  it("groups page date warnings once while retaining all affected pages", () => {
    const result = summary([
      page([block()], { warnings: ["UNCERTAIN_DATE"], pageCount: 2 }),
      page([block()], {
        id: "44444444-4444-4444-8444-444444444444",
        pageNumber: 2,
        pageCount: 2,
        warnings: ["UNCERTAIN_DATE"],
      }),
    ]);
    expect(result.questions).toEqual([
      {
        key: "date-year",
        reason: "DATE_YEAR",
        fieldName: null,
        itemKeys: [],
        pageNumbers: [1, 2],
      },
    ]);
  });
  it("keeps yearless dates and source-field ambiguities out of grouped acknowledgement", () => {
    const dateField = {
      name: "saleStart" as const,
      rawValue: "28 septembre",
      confidence: 0.99,
      evidence: [{ pageNumber: 1, spanIndices: [0], quote: "28 septembre" }],
      validationStatus: "TO_VALIDATE" as const,
    };
    const result = summary([
      page([block(0, { fields: [dateField] }), block(1)], {
        issues: [
          {
            blockIndex: 1,
            fieldName: "sellingPrice",
            code: "UNSUPPORTED_FIELD",
          },
        ],
      }),
    ]);
    expect(result.bulkEligible).toHaveLength(0);
    expect(result.questions.map((q) => q.reason)).toEqual([
      "DATE_YEAR",
      "SOURCE_FIELD",
    ]);
  });
  it("a page-wide applicability warning cannot become a blanket confirmation", () => {
    const result = summary([
      page([block()], { warnings: ["UNCERTAIN_APPLICABILITY"] }),
    ]);
    expect(result.bulkEligible).toEqual([]);
    expect(result.questions[0]?.reason).toBe("PAGE_WARNING");
  });
  it("never groups a low-confidence or unsupported field solely because its label is readable", () => {
    const low = block();
    low.fields[0]!.confidence = 0.5;
    const missing = block(1);
    missing.fields[0]!.rawValue = null;
    const unsupported = block(2);
    unsupported.fields[0]!.evidence = [];
    expect(summary([page([low, missing, unsupported])]).bulkEligible).toEqual(
      [],
    );
  });
  it("excludes already recorded choices and surfaces synchronization failures", () => {
    const p = page();
    const result = summary(
      [p],
      [
        {
          decision: {
            pageId: p.id,
            sourceBlockIndex: 0,
            decision: "CONFIRMED_TRANSCRIPTION",
          },
          state: "CONFLICT",
        },
      ],
    );
    expect(result.bulkEligible).toEqual([]);
    expect(result.questions[0]?.reason).toBe("SYNC_CONFLICT");
  });
  it("retains price conflicts even for high confidence offers", () => {
    const a = block(0, {
      kind: "OFFER",
      fields: [
        {
          name: "operationName",
          rawValue: "PROSPECTUS",
          confidence: 0.99,
          evidence: [{ pageNumber: 1, spanIndices: [0], quote: "PROSPECTUS" }],
          validationStatus: "TO_VALIDATE",
        },
        {
          name: "productLabel",
          rawValue: "POIRE",
          confidence: 0.99,
          evidence: [{ pageNumber: 1, spanIndices: [0], quote: "POIRE" }],
          validationStatus: "TO_VALIDATE",
        },
        {
          name: "sellingPrice",
          rawValue: "2,99 €/kg",
          confidence: 0.99,
          evidence: [{ pageNumber: 1, spanIndices: [0], quote: "2,99 €/kg" }],
          validationStatus: "TO_VALIDATE",
        },
      ],
    });
    const b = {
      ...a,
      fields: a.fields.map((f) => ({
        ...f,
        evidence: f.evidence.map((e) => ({
          ...e,
          spanIndices: [...e.spanIndices],
        })),
      })),
    };
    b.sourceBlockIndex = 1;
    b.fields[2]!.rawValue = "3,49 €/kg";
    b.fields[2]!.evidence[0]!.quote = "3,49 €/kg";
    const result = summary([page([a, b])]);
    expect(result.questions[0]?.reason).toBe("OFFER_CONFLICT");
    expect(result.bulkEligible).toEqual([]);
  });
  it("refuses mixed stores/documents/checksums and duplicate snapshot identities", () => {
    expect(() => summary([page(), page()])).toThrow(
      "COMMERCIAL_SUMMARY_DUPLICATE_PAGE",
    );
    for (const change of [
      { storeId: "55555555-5555-4555-8555-555555555555" },
      { sourceDocumentId: "55555555-5555-4555-8555-555555555555" },
      { checksum: "other" },
    ])
      expect(() =>
        summary([
          page(),
          page([block()], {
            ...change,
            id: "44444444-4444-4444-8444-444444444444",
            pageNumber: 2,
          }),
        ]),
      ).toThrow("COMMERCIAL_SUMMARY_SOURCE_MISMATCH");
  });
});

it.each(["2026-02-30", "31/04/2026", "du 28 septembre au 4 octobre 2026"])(
  "keeps an invalid or compound date out of grouped acknowledgement: %s",
  (rawValue) => {
    const result = summary([
      page([
        block(0, {
          fields: [
            {
              name: "saleStart",
              rawValue,
              confidence: 0.99,
              evidence: [{ pageNumber: 1, spanIndices: [0], quote: rawValue }],
              validationStatus: "TO_VALIDATE",
            },
          ],
        }),
      ]),
    ]);
    expect(result.bulkEligible).toEqual([]);
    expect(result.questions[0]?.fieldName).toBe("saleStart");
  },
);
it("can acknowledge a source-supported explicit date without changing its raw value", () => {
  const rawValue = "29/02/2028";
  const p = page([
    block(0, {
      fields: [
        {
          name: "saleStart",
          rawValue,
          confidence: 0.99,
          evidence: [{ pageNumber: 1, spanIndices: [0], quote: rawValue }],
          validationStatus: "TO_VALIDATE",
        },
      ],
    }),
  ]);
  const before = JSON.stringify(p);
  expect(summary([p]).bulkEligible).toHaveLength(1);
  expect(JSON.stringify(p)).toBe(before);
});

it("preserves multiple operation natures and source TG roles without double counting offers", () => {
  const result = summary([
    page([
      block(0, {
        kind: "MERCHANDISING",
        label: "TG SPÉCIALE FRUITS",
        fields: [
          {
            name: "operationNature",
            rawValue: "DRAMATISATION / PROSPECTUS",
            confidence: 0.95,
            evidence: [
              {
                pageNumber: 1,
                spanIndices: [0],
                quote: "DRAMATISATION / PROSPECTUS",
              },
            ],
            validationStatus: "TO_VALIDATE",
          },
        ],
      }),
    ]),
  ]);
  expect(
    result.sections.filter((s) => s.items.length).map((s) => s.key),
  ).toEqual(["DRAMAT", "PROSPECTUS", "TG"]);
  expect(result.items).toHaveLength(1);
  expect(result.tgCount).toBe(1);
});

it("an unclear price operator remains a question even at high model confidence", () => {
  const result = summary([
    page([
      block(0, {
        fields: [
          {
            name: "priceOperator",
            rawValue: "prix maximum indicatif",
            confidence: 0.99,
            evidence: [
              {
                pageNumber: 1,
                spanIndices: [0],
                quote: "prix maximum indicatif",
              },
            ],
            validationStatus: "TO_VALIDATE",
          },
        ],
      }),
    ]),
  ]);
  expect(result.bulkEligible).toEqual([]);
  expect(result.questions[0]?.fieldName).toBe("priceOperator");
});
