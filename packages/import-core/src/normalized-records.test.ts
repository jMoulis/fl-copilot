import { describe, expect, it } from "vitest";
import type { ParsedMercalysArticleRecord } from "./mercalys-article-parser";
import { fingerprintMercalysRecords } from "./normalized-records";

const record: ParsedMercalysArticleRecord = {
  sourceIndex: 4,
  itm8: "00001234",
  ean: "0000000003017",
  rawLabel: "POIRE CONFERENCE VRAC",
  businessDate: "2026-09-26",
  quantity: 1.82,
  purchaseValue: 2.1,
  rceValue: null,
  salesValue: 4.5,
  vatValue: 0.25,
  marginValue: 2.4,
  marginRate: 53.33,
  rawValues: {
    itm8: "00001234",
    ean: "0000000003017",
    rawLabel: "POIRE CONFERENCE VRAC",
    businessDate: "26/09/2026",
    quantity: "1,82",
    purchaseValue: "2,10",
    rceValue: null,
    salesValue: "4,50",
    vatValue: "0,25",
    marginValue: "2,40",
    marginRate: "53,33",
  },
};

describe("Mercalys normalized fingerprint", () => {
  it("is independent from workbook row order and raw formatting", () => {
    const second = {
      ...record,
      sourceIndex: 9,
      itm8: "00005678",
      rawValues: { ...record.rawValues, quantity: 1.82 },
    };
    expect(fingerprintMercalysRecords([record, second])).toBe(
      fingerprintMercalysRecords([second, record]),
    );
    expect(
      fingerprintMercalysRecords([
        { ...record, sourceIndex: 99, rawValues: second.rawValues },
      ]),
    ).toBe(fingerprintMercalysRecords([record]));
  });

  it("changes when a normalized business value changes", () => {
    expect(fingerprintMercalysRecords([{ ...record, quantity: 2 }])).not.toBe(
      fingerprintMercalysRecords([record]),
    );
  });
});
