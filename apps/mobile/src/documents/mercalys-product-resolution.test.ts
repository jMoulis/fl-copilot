import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProductMatchResult } from "@fl-copilot/domain";
import type { ParsedMercalysArticleRecord } from "./mercalys-article-parser";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";
import { validateMercalysImport } from "./mercalys-import-validation";
import type { ProductMasterRepository } from "../products/product-master-repository";
import {
  buildMercalysProductResolutions,
  confirmMercalysProductMapping,
  type MercalysProductResolution,
} from "./mercalys-product-resolution";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";

describe("Mercalys product resolution", () => {
  it("groups repeated rows by ITM8 and preserves leading zeroes", () => {
    const result = buildMercalysProductResolutions(
      summary([
        line(8, "00000042", "0000000000042", "Poire conférence"),
        line(9, "00000042", "0000000000042", "Poire conférence"),
      ]),
    );

    expect(result).toEqual([
      expect.objectContaining({
        key: "ITM8:00000042",
        label: "Poire conférence",
        identifiers: [
          { type: "ITM8", value: "00000042" },
          { type: "EAN", value: "0000000000042" },
        ],
        sourceIndexes: [8, 9],
        canCreate: true,
        canCreateAsDistinct: true,
      }),
    ]);
  });

  it("does not batch-create an ambiguous mapping or inconsistent labels", () => {
    const candidateId = "22222222-2222-4222-8222-222222222222";
    const result = buildMercalysProductResolutions(
      summary([
        line(8, "00000042", null, "Poire conférence"),
        line(9, "00000042", null, "Pomme Gala", match("REVIEW", candidateId)),
      ]),
    );

    expect(result[0]).toMatchObject({
      canCreate: false,
      canCreateAsDistinct: false,
      candidateProductIds: [candidateId],
    });
  });

  it("blocks batch creation when two products claim the same identifier", () => {
    const result = buildMercalysProductResolutions(
      summary([
        line(8, "00000041", "0000000000042", "Poire conférence"),
        line(9, "00000042", "0000000000042", "Pomme Gala"),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(result.every(({ canCreate }) => !canCreate)).toBe(true);
    expect(
      result.every(({ canCreateAsDistinct }) => !canCreateAsDistinct),
    ).toBe(true);
  });

  it("allows a human to create a distinct product after a fuzzy proposal", () => {
    const candidateId = "22222222-2222-4222-8222-222222222222";
    const result = buildMercalysProductResolutions(
      summary([
        line(
          8,
          "00000042",
          "0000000000042",
          "Tomate cerise duo 250g",
          match("REVIEW", candidateId),
        ),
      ]),
    );

    expect(result[0]).toMatchObject({
      canCreate: false,
      canCreateAsDistinct: true,
      candidateProductIds: [candidateId],
    });
  });

  it("removes competing identifiers when a human confirms one product", async () => {
    const chosenProductId = "22222222-2222-4222-8222-222222222222";
    const competingProductId = "33333333-3333-4333-8333-333333333333";
    const repository = productRepository({
      identifiers: [
        identifierRecord("identifier-chosen", chosenProductId, "ITM8", "42", 7),
        identifierRecord(
          "identifier-competing",
          competingProductId,
          "ITM8",
          "42",
          9,
        ),
        identifierRecord(
          "ean-competing",
          competingProductId,
          "EAN",
          "0000000000042",
          4,
        ),
      ],
    });

    await confirmMercalysProductMapping(
      repository.value,
      resolution([
        { type: "ITM8", value: "42" },
        { type: "EAN", value: "0000000000042" },
      ]),
      chosenProductId,
      resolutionOptions(),
    );

    expect(repository.delete).toHaveBeenCalledWith(
      "product_identifier",
      "identifier-competing",
      storeId,
      timestamp,
      expect.objectContaining({ expectedRemoteVersion: 9 }),
    );
    expect(repository.delete).toHaveBeenCalledWith(
      "product_identifier",
      "ean-competing",
      storeId,
      timestamp,
      expect.objectContaining({ expectedRemoteVersion: 4 }),
    );
    expect(repository.upsertIdentifier).toHaveBeenCalledTimes(1);
    expect(repository.upsertIdentifier).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: chosenProductId,
        type: "EAN",
        value: "0000000000042",
      }),
      expect.anything(),
    );
  });

  it("records a validated alias when a row has no stable identifier", async () => {
    const chosenProductId = "22222222-2222-4222-8222-222222222222";
    const repository = productRepository();

    await confirmMercalysProductMapping(
      repository.value,
      resolution([], "Poire Conférence"),
      chosenProductId,
      resolutionOptions(),
    );

    expect(repository.upsertAlias).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: chosenProductId,
        alias: "Poire Conférence",
        normalizedAlias: "POIRE CONFERENCE",
        source: "MERCALYS",
        status: "VALIDATED",
      }),
      expect.anything(),
    );
  });
});

const storeId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-10-04T20:00:00.000Z";

function resolution(
  identifiers: MercalysProductResolution["identifiers"],
  label = "Poire conférence",
): MercalysProductResolution {
  return {
    key: "resolution",
    label,
    identifiers,
    sourceIndexes: [8],
    candidateProductIds: [],
    canCreate: false,
    canCreateAsDistinct: false,
  };
}

function resolutionOptions() {
  let sequence = 0;
  return {
    storeId,
    deviceId: "44444444-4444-4444-8444-444444444444",
    now: () => timestamp,
    generateId: () => `generated-${++sequence}`,
  };
}

function identifierRecord(
  id: string,
  productId: string,
  type: "ITM8" | "EAN",
  value: string,
  remoteVersion: number,
) {
  return {
    entity: {
      id,
      storeId,
      productId,
      type,
      value,
      source: "MERCALYS" as const,
      status: "VALIDATED" as const,
      version: remoteVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    },
    syncState: "SYNCED" as const,
    remoteVersion,
    dirty: false,
  };
}

function productRepository(
  input: { identifiers?: ReturnType<typeof identifierRecord>[] } = {},
) {
  const methods = {
    listIdentifiersByStore: vi.fn(async () => input.identifiers ?? []),
    listAliasesByStore: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    upsertIdentifier: vi.fn(async (entity) => entity),
    upsertAlias: vi.fn(async (entity) => entity),
  };
  return {
    ...methods,
    value: methods as unknown as ProductMasterRepository,
  };
}

const dailySalesFixture = resolve(
  process.cwd(),
  "docs/files_examples/ventes_day_example.xlsx",
);
describe.skipIf(!existsSync(dailySalesFixture))(
  "real Mercalys product resolution",
  () => {
    it("can explicitly initialize an empty Product Master from the daily sales file", () => {
      const workbook = new SheetJsSpreadsheetParser().parse(
        readFileSync(dailySalesFixture),
      );
      const importSummary = validateMercalysImport(
        workbook,
        "11111111-1111-4111-8111-111111111111",
        { products: [], identifiers: [], aliases: [] },
      );
      const resolutions = buildMercalysProductResolutions(importSummary);

      expect(importSummary).toMatchObject({
        detectedLineCount: 147,
        readyCount: 0,
        productReviewCount: 147,
      });
      expect(resolutions).toHaveLength(147);
      expect(resolutions.every(({ canCreate }) => canCreate)).toBe(true);
    });
  },
);

function line(
  sourceIndex: number,
  itm8: string | null,
  ean: string | null,
  rawLabel: string,
  productMatch: ProductMatchResult = match("NO_MATCH"),
) {
  const record: ParsedMercalysArticleRecord = {
    sourceIndex,
    itm8,
    ean,
    rawLabel,
    businessDate: "2026-09-26",
    quantity: 1,
    purchaseValue: null,
    rceValue: null,
    salesValue: 2,
    vatValue: null,
    marginValue: null,
    marginRate: null,
    rawValues: {
      itm8,
      ean,
      rawLabel,
      businessDate: "2026-09-26",
      quantity: 1,
      purchaseValue: null,
      rceValue: null,
      salesValue: 2,
      vatValue: null,
      marginValue: null,
      marginRate: null,
    },
  };
  return { record, match: productMatch };
}

function match(
  state: ProductMatchResult["state"],
  candidateProductId?: string,
): ProductMatchResult {
  return {
    engineVersion: "test",
    state,
    matchedProductId: null,
    method: state === "REVIEW" ? "FUZZY_LABEL" : null,
    candidates: candidateProductId
      ? [
          {
            productId: candidateProductId,
            score: 0.85,
            method: "FUZZY_LABEL",
            reasons: ["FUZZY_LABEL"],
          },
        ]
      : [],
    conflict: null,
  };
}

function summary(
  lines: MercalysImportValidationSummary["lines"],
): MercalysImportValidationSummary {
  return {
    sourceType: "MERCALYS_SALES",
    parserVersion: "test",
    businessPeriodStart: "2026-09-26",
    businessPeriodEnd: "2026-09-26",
    detectedLineCount: lines.length,
    readyCount: 0,
    productReviewCount: lines.length,
    errorCount: 0,
    lines,
    issueCodes: [],
  };
}
